import { afterEach, describe, expect, it } from 'vitest';
import type { Env } from './env.js';
import { assertProductionSecretsConfigured } from './startup-guards.js';

// The guard only reads `jwtSecret`/`adminToken`, so a minimal object cast to
// `Env` exercises it without booting the server or touching Postgres/Redis.
function envWith(overrides: Partial<Env>): Env {
  return { jwtSecret: 'set', adminToken: 'set', ...overrides } as Env;
}

describe('assertProductionSecretsConfigured', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it('throws when JWT_SECRET is unset in production', () => {
    process.env.NODE_ENV = 'production';
    expect(() => assertProductionSecretsConfigured(envWith({ jwtSecret: undefined }))).toThrow(
      /JWT_SECRET/,
    );
  });

  it('throws when ADMIN_TOKEN is unset in production (JWT_SECRET present)', () => {
    process.env.NODE_ENV = 'production';
    expect(() => assertProductionSecretsConfigured(envWith({ adminToken: undefined }))).toThrow(
      /ADMIN_TOKEN/,
    );
  });

  it('does not throw when both secrets are set in production', () => {
    process.env.NODE_ENV = 'production';
    expect(() => assertProductionSecretsConfigured(envWith({}))).not.toThrow();
  });

  it('throws when Google sign-in is enabled in production without a client ID', () => {
    process.env.NODE_ENV = 'production';
    expect(() =>
      assertProductionSecretsConfigured(
        envWith({ googleSigninEnabled: true, googleClientId: undefined }),
      ),
    ).toThrow(/GOOGLE_CLIENT_ID/);
  });

  it('does not throw when Google sign-in is enabled WITH a client ID in production', () => {
    process.env.NODE_ENV = 'production';
    expect(() =>
      assertProductionSecretsConfigured(
        envWith({ googleSigninEnabled: true, googleClientId: 'client-123.apps.googleusercontent.com' }),
      ),
    ).not.toThrow();
  });

  it('does not throw when Google sign-in is DISABLED and unconfigured (the dormant default)', () => {
    process.env.NODE_ENV = 'production';
    expect(() =>
      assertProductionSecretsConfigured(
        envWith({ googleSigninEnabled: false, googleClientId: undefined }),
      ),
    ).not.toThrow();
  });

  it('does not throw outside production even when both secrets are unset', () => {
    process.env.NODE_ENV = 'test';
    expect(() =>
      assertProductionSecretsConfigured(envWith({ jwtSecret: undefined, adminToken: undefined })),
    ).not.toThrow();
  });
});
