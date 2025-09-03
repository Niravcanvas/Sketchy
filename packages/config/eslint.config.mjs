import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

const NODE_BUILTIN_PATHS = [
  'fs',
  'path',
  'os',
  'crypto',
  'child_process',
  'http',
  'https',
  'net',
  'util',
  'events',
  'stream',
  'buffer',
  'worker_threads',
];

const ENGINE_PURITY_MESSAGE =
  'packages/engine must be pure TS with zero platform deps (arch/system-design.md §2)';

const SHARED_PURITY_MESSAGE =
  'packages/shared must build for a React Native target with zero patches ' +
  '(arch/mobile-notes.md); no Node built-ins ' +
  '(a platform capability the RN app lacks needs an injected abstraction instead, ' +
  'not a direct import — see mobile-notes.md).';

const config = tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      '**/next-env.d.ts',
      '**/*.config.*',
      'deploy/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    // Base project-wide rules.
    rules: {
      // TS handles undefined-variable detection far better than eslint's
      // syntactic check, which false-positives on ambient/global types.
      'no-undef': 'off',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    // conventions.md §1: "No `any` outside test fixtures".
    files: ['**/*.test.ts', '**/*.test.tsx', '**/test/**'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    // packages/engine: pure TS, zero platform deps (arch/system-design.md §2).
    files: ['packages/engine/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['@sketchy/*'], message: ENGINE_PURITY_MESSAGE },
            { group: ['node:*'], message: ENGINE_PURITY_MESSAGE },
          ],
          paths: NODE_BUILTIN_PATHS.map((name) => ({
            name,
            message: ENGINE_PURITY_MESSAGE,
          })),
        },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message: 'Engine RNG must be the injected seeded PRNG (conventions §4)',
        },
      ],
    },
  },
  {
    // shared may only depend on @sketchy/engine (conventions.md §1 dependency rule).
    // Node-built-in ban is scoped to `src/` only — `examples/headless-client.ts`
    // is a deliberately Node-only script (packages/shared/examples/ isn't part of the
    // portable `./*` export surface an RN app would import) and legitimately may need them.
    files: ['packages/shared/src/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@sketchy/web*', '@sketchy/api*', '@sketchy/config*'],
              message: 'shared may only import @sketchy/engine',
            },
            { group: ['node:*'], message: SHARED_PURITY_MESSAGE },
          ],
          paths: NODE_BUILTIN_PATHS.map((name) => ({
            name,
            message: SHARED_PURITY_MESSAGE,
          })),
        },
      ],
    },
  },
  {
    // apps never import from each other; web never imports server-only modules.
    files: ['apps/web/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@sketchy/api', '@sketchy/api/*'],
              message: 'apps never import from each other',
            },
            {
              group: ['pg', 'ioredis', 'drizzle-orm', 'fastify'],
              message: 'web never imports server-only modules',
            },
          ],
        },
      ],
    },
  },
  {
    // apps/api never imports web-only modules.
    files: ['apps/api/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@sketchy/web*', 'next', 'next/*', 'react', 'react-dom'],
              message: 'apps never import from each other',
            },
          ],
        },
      ],
    },
  },
  {
    // React rules for the web app only.
    files: ['apps/web/**/*.tsx'],
    ...react.configs.flat.recommended,
    settings: {
      react: {
        version: 'detect',
      },
    },
    languageOptions: {
      ...react.configs.flat.recommended.languageOptions,
      globals: {
        ...globals.browser,
      },
    },
  },
  {
    files: ['apps/web/**/*.tsx'],
    ...reactHooks.configs.flat.recommended,
  },
  {
    // Overrides layered on top of the two recommended configs above.
    files: ['apps/web/**/*.tsx'],
    rules: {
      'react/react-in-jsx-scope': 'off',
      // conventions.md §4: "No string literals in JSX" — CI fails via --max-warnings 0.
      'react/jsx-no-literals': 'warn',
    },
  },
);

export default config;
