/**
 * Single accessor for the web app's own public URL (conventions.md §4 —
 * `PUBLIC_WEB_URL`). Used only by server-only SEO surfaces (root layout's
 * `metadataBase`, `app/sitemap.ts`, `app/robots.ts`, OG image absolute
 * references) — never bundled to the client. Falls back to the local dev
 * port so a freshly cloned repo with no `.env` still produces valid
 * (if locally-scoped) sitemap/canonical URLs.
 */
export function getSiteUrl(): string {
  const base = process.env.PUBLIC_WEB_URL ?? 'http://localhost:3000';
  return base.replace(/\/+$/, '');
}
