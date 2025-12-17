/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  transpilePackages: ['@sketchy/shared', '@sketchy/engine'],
  // conventions.md §4 documents `PUBLIC_API_URL` (not `NEXT_PUBLIC_*`) as the
  // env var name. Next only auto-inlines `NEXT_PUBLIC_*` vars into the
  // client bundle, so the documented name has to be threaded through `env`
  // explicitly to be readable from client components too. See src/lib/api-url.ts.
  env: {
    PUBLIC_API_URL: process.env.PUBLIC_API_URL ?? 'http://localhost:4000',
    // Shared with the API (conventions.md §4). Threaded through `env` (not
    // NEXT_PUBLIC_*) for the same reason as PUBLIC_API_URL — see src/lib/observability.ts.
    SENTRY_DSN: process.env.SENTRY_DSN ?? '',
  },
  // `@sketchy/shared`'s internal relative imports use the NodeNext-style
  // explicit `.js` extension pointing at sibling `.ts` files (e.g.
  // `./contract/players.js` for `contract/players.ts`) — `tsc` resolves that
  // by design, but webpack doesn't know to try `.ts` for a `.js` specifier.
  // `transpilePackages` alone doesn't add that resolution; this does.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },
};

export default nextConfig;
