import { describe, expect, it } from 'vitest';
import { renderMagicLinkEmail } from './magic-link-email.js';

const LINK = 'https://app.sketchy.example/link?token=abc123DEF-_';

describe('renderMagicLinkEmail', () => {
  it('produces a subject, a plain-text body, and an HTML body', () => {
    const email = renderMagicLinkEmail(LINK);
    expect(email.subject).toContain('Sketchy');
    expect(email.text.length).toBeGreaterThan(0);
    expect(email.html.length).toBeGreaterThan(0);
  });

  it('puts the link in the plain-text body along with the single-use / expiry note', () => {
    const { text } = renderMagicLinkEmail(LINK);
    expect(text).toContain(LINK);
    expect(text).toContain('15 minutes');
    expect(text).toContain('once');
  });

  it('links the button and the fallback URL to the magic link', () => {
    const { html } = renderMagicLinkEmail(LINK);
    // Both the CTA and the copy-paste fallback point at the link.
    expect(html).toContain(`href="${LINK}"`);
    expect(
      html.match(new RegExp(`href="${LINK.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`, 'g')),
    ).toHaveLength(2);
    // Brand + CTA + tagline are present.
    expect(html).toContain('Sign in');
    expect(html).toContain('Sketchy');
    expect(html).toContain("Everyone's a little sketchy.");
  });

  it('uses email-safe construction (table layout, inline styles, no external CSS/webfont fetch)', () => {
    const { html } = renderMagicLinkEmail(LINK);
    expect(html).toContain('<table');
    expect(html).toContain('style="');
    // No <style> block and no external resource loads that inboxes would strip.
    expect(html).not.toContain('<style');
    expect(html).not.toContain('<link');
    expect(html).not.toMatch(/https?:\/\/fonts\./);
  });

  it('HTML-escapes the link so a hostile query string cannot inject markup', () => {
    const nasty = 'https://app.sketchy.example/link?token=a&b=<script>"x"';
    const { html } = renderMagicLinkEmail(nasty);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&amp;b=');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&quot;x&quot;');
  });
});
