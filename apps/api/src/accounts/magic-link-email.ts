/**
 * The magic-link email content (subject + plain-text + themed HTML), rendered in
 * ONE place so both real providers (email-provider.ts) send an identical message
 * and it's unit-testable without any provider credentials.
 *
 * Design: the "Party Pop" look (arch/design-party-pop.md, packages/config/
 * tailwind-preset.mjs) — ink-black hard borders, a lilac ground, a white card,
 * a blue CTA, a yellow tagline chip — rebuilt with EMAIL-SAFE techniques, NOT a
 * copy of the web CSS:
 *  - table layout + fully inline styles (no <style> block, no external CSS): the
 *    web app's Tailwind classes and CSS vars don't exist in an inbox.
 *  - web-safe font STACKS: 'Archivo Black'/'Space Grotesk' are self-hosted via
 *    next/font on the web and won't load in mail clients, so the first available
 *    fallback (Arial Black / Helvetica) is what actually renders.
 *  - the signature hard offset-shadow is faked with a thick bottom/right BORDER
 *    (widely supported, incl. Outlook's Word engine) rather than `box-shadow`
 *    (which Outlook drops entirely).
 *
 * The only dynamic value is `link`; the brand name and 15-minute expiry are the
 * same literals the flow has always used (link-only — there is no OTP code).
 */

export interface MagicLinkEmail {
  subject: string;
  text: string;
  html: string;
}

const BRAND = 'Sketchy';
const TAGLINE = "Everyone's a little sketchy.";
const EXPIRY_MINUTES = 15;

// Party Pop palette (tailwind-preset.mjs), inlined as literal hex.
const INK = '#14120B';
const PAPER = '#EFEAFF';
const PAPER_2 = '#FFFFFF';
const HIGHLIGHT = '#FFD23F';
const CIVILIAN = '#2F6FF2';
const GRAPHITE = '#5C5647';

// Approximations of Archivo Black (display) / Space Grotesk (ui) — the first
// installed family is what the client actually paints.
const DISPLAY_FONT = "'Archivo Black', 'Arial Black', Arial, sans-serif";
const UI_FONT = "'Space Grotesk', 'Helvetica Neue', Helvetica, Arial, sans-serif";

/** Escape the five HTML-significant characters. The link is our own URL (base64url
 * token, no metacharacters today) but we escape it defensively so it's always a
 * well-formed attribute value and visible-text run. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderMagicLinkEmail(link: string): MagicLinkEmail {
  const subject = `Your ${BRAND} sign-in link`;

  const text = [
    `Sign in to ${BRAND}`,
    '',
    "Tap the link below to sign in — or to finish setting up your account if you're new:",
    '',
    link,
    '',
    `This link expires in ${EXPIRY_MINUTES} minutes and can be used once. If you didn't request it, just ignore this email — nothing will change.`,
    '',
    TAGLINE,
  ].join('\n');

  const safeLink = escapeHtml(link);

  const html = `<!-- preheader: shown in the inbox list, hidden in the body -->
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;opacity:0;color:transparent;">Your ${BRAND} sign-in link — expires in ${EXPIRY_MINUTES} minutes.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0;padding:0;background-color:${PAPER};">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table role="presentation" width="480" cellpadding="0" cellspacing="0" border="0" style="width:480px;max-width:480px;">
        <tr>
          <td align="center" style="padding-bottom:20px;font-family:${DISPLAY_FONT};font-size:30px;line-height:1;letter-spacing:2px;color:${INK};text-transform:uppercase;font-weight:bold;">
            ${BRAND}
          </td>
        </tr>
        <tr>
          <td style="background-color:${PAPER_2};border:3px solid ${INK};border-right-width:6px;border-bottom-width:6px;padding:32px 28px;">
            <h1 style="margin:0 0 12px;font-family:${DISPLAY_FONT};font-size:22px;line-height:1.2;letter-spacing:0.5px;color:${INK};text-transform:uppercase;font-weight:bold;">Sign in to ${BRAND}</h1>
            <p style="margin:0 0 24px;font-family:${UI_FONT};font-size:16px;line-height:1.5;color:${GRAPHITE};">Tap the button to sign in — or to finish setting up your account if you're new here.</p>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px;">
              <tr>
                <td align="center" bgcolor="${CIVILIAN}" style="background-color:${CIVILIAN};border:3px solid ${INK};border-right-width:5px;border-bottom-width:5px;">
                  <a href="${safeLink}" style="display:inline-block;padding:14px 30px;font-family:${DISPLAY_FONT};font-size:16px;line-height:1;letter-spacing:0.5px;color:#FFFFFF;text-decoration:none;text-transform:uppercase;font-weight:bold;">Sign in</a>
                </td>
              </tr>
            </table>
            <p style="margin:0 0 12px;font-family:${UI_FONT};font-size:13px;line-height:1.5;color:${GRAPHITE};">This link expires in ${EXPIRY_MINUTES} minutes and can be used once.</p>
            <p style="margin:0;font-family:${UI_FONT};font-size:13px;line-height:1.5;color:${GRAPHITE};">Button not working? Paste this link into your browser:<br>
              <a href="${safeLink}" style="color:${CIVILIAN};word-break:break-all;">${safeLink}</a>
            </p>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding-top:20px;">
            <span style="display:inline-block;background-color:${HIGHLIGHT};border:3px solid ${INK};padding:6px 14px;font-family:${DISPLAY_FONT};font-size:12px;line-height:1.2;letter-spacing:1px;color:${INK};text-transform:uppercase;font-weight:bold;">${TAGLINE}</span>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:20px 8px 0;font-family:${UI_FONT};font-size:12px;line-height:1.5;color:${GRAPHITE};">
            If you didn't request this, just ignore this email — nothing will change.
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;

  return { subject, text, html };
}
