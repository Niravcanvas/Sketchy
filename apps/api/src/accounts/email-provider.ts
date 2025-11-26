import type { FastifyBaseLogger } from 'fastify';
import { getEnv } from '../env.js';
import { renderMagicLinkEmail } from './magic-link-email.js';

/**
 * Transactional-email provider abstraction for magic-link account
 * linking (system-design.md §6). One tiny interface, three implementations
 * selected by `EMAIL_PROVIDER` (env.ts):
 *
 * - `'log'` (dev/default): NEVER sends a real email. It writes the magic link
 *   to the API log (clearly labeled `MAGIC-LINK (dev, not emailed)`) and to a
 *   small in-process dev sink (below) so the whole link → verify flow is
 *   testable end-to-end with zero credentials — dev must LOG the magic link,
 *   never claim an email was sent.
 * - `'resend'` / `'postmark'`: the real HTTP-provider shape (a single POST to
 *   the provider's send API). Wired but not usable yet — there are no
 *   provider credentials in this environment, so with `EMAIL_API_KEY` unset the
 *   provider throws a clear, labeled error rather than pretending to send.
 */
export interface EmailProvider {
  readonly kind: 'log' | 'resend' | 'postmark';
  sendMagicLink(to: string, link: string): Promise<void>;
}

export interface DevMagicLink {
  to: string;
  link: string;
  at: number;
}

/**
 * In-process ring buffer of dev magic links (the `'log'` provider's sink). Lets
 * integration tests and the guarded dev-inbox endpoint (routes/accounts.ts)
 * retrieve the link a real email would have carried. NEVER populated by the
 * real providers, and the dev-inbox endpoint that exposes it is registered only
 * outside production with `EMAIL_PROVIDER=log` (routes/accounts.ts).
 */
const DEV_SINK_MAX = 50;
const devSink: DevMagicLink[] = [];

export function recordDevMagicLink(entry: DevMagicLink): void {
  devSink.push(entry);
  if (devSink.length > DEV_SINK_MAX) {
    devSink.splice(0, devSink.length - DEV_SINK_MAX);
  }
}

/** Most-recent dev magic links, newest first (bounded copy). */
export function getRecentDevMagicLinks(limit = 10): DevMagicLink[] {
  return devSink.slice(-limit).reverse();
}

/** The single most-recent dev magic link for `to` (case-insensitive), if any —
 * the shape integration tests actually use to grab the token. */
export function findDevMagicLinkFor(to: string): DevMagicLink | undefined {
  const needle = to.trim().toLowerCase();
  for (let i = devSink.length - 1; i >= 0; i -= 1) {
    if (devSink[i]?.to.toLowerCase() === needle) {
      return devSink[i];
    }
  }
  return undefined;
}

class LogEmailProvider implements EmailProvider {
  readonly kind = 'log' as const;
  constructor(private readonly logger: FastifyBaseLogger) {}
  async sendMagicLink(to: string, link: string): Promise<void> {
    recordDevMagicLink({ to, link, at: Date.now() });
    // The link itself is a credential — logged only under the dev provider,
    // which by construction never runs in a real send path.
    this.logger.info({ to, link }, 'MAGIC-LINK (dev, not emailed) — copy this URL to finish linking');
  }
}

/**
 * Shared shape for the two real HTTP providers. The actual send is a single
 * POST; the request body differs per provider. With no `EMAIL_API_KEY` it
 * throws immediately (never a silent no-op that would let a route falsely claim
 * a link was sent). Reaching this path at all requires an operator to have set
 * `EMAIL_PROVIDER=resend|postmark`.
 */
class HttpEmailProvider implements EmailProvider {
  constructor(
    readonly kind: 'resend' | 'postmark',
    private readonly apiKey: string | undefined,
    private readonly from: string,
    private readonly logger: FastifyBaseLogger,
  ) {}

  async sendMagicLink(to: string, link: string): Promise<void> {
    if (!this.apiKey) {
      throw new Error(
        `EMAIL_PROVIDER=${this.kind} but EMAIL_API_KEY is unset — real email sending is deferred to phase 9 (plan/phase16-handoff.md).`,
      );
    }
    const { subject, text, html } = renderMagicLinkEmail(link);
    const { url, headers, body } = this.buildRequest(to, subject, text, html);
    const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      this.logger.error({ status: response.status, detail }, 'email provider send failed');
      throw new Error(`Email provider ${this.kind} responded ${response.status}`);
    }
  }

  private buildRequest(
    to: string,
    subject: string,
    text: string,
    html: string,
  ): { url: string; headers: Record<string, string>; body: Record<string, unknown> } {
    if (this.kind === 'resend') {
      return {
        url: 'https://api.resend.com/emails',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        // `text` rides along as the plain-text alternative for clients that
        // can't (or won't) render the HTML part.
        body: { from: this.from, to: [to], subject, html, text },
      };
    }
    // postmark
    return {
      url: 'https://api.postmarkapp.com/email',
      headers: {
        'X-Postmark-Server-Token': this.apiKey ?? '',
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: {
        From: this.from,
        To: to,
        Subject: subject,
        HtmlBody: html,
        TextBody: text,
        MessageStream: 'outbound',
      },
    };
  }
}

/** Builds the configured provider. Defaults to the credential-free dev `'log'`
 * provider (env.ts already coerces any unknown `EMAIL_PROVIDER` to `'log'`). */
export function getEmailProvider(logger: FastifyBaseLogger): EmailProvider {
  const env = getEnv();
  if (env.emailProvider === 'resend' || env.emailProvider === 'postmark') {
    return new HttpEmailProvider(env.emailProvider, env.emailApiKey, env.emailFrom, logger);
  }
  return new LogEmailProvider(logger);
}
