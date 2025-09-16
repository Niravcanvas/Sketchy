import { describe, expect, it } from 'vitest';
import {
  deleteAccountResponseSchema,
  googleSignInRequestSchema,
  googleSignInResponseSchema,
  linkRequestResponseSchema,
  linkRequestSchema,
  linkVerifyRequestSchema,
  linkVerifyResponseSchema,
} from './accounts.js';

const UUID = '123e4567-e89b-12d3-a456-426614174000';

describe('accounts contract (phase 16)', () => {
  it('validates the link request (email) and its enumeration-safe ack', () => {
    expect(linkRequestSchema.parse({ email: 'a@b.com' })).toEqual({ email: 'a@b.com' });
    expect(() => linkRequestSchema.parse({ email: 'not-an-email' })).toThrow();
    expect(linkRequestResponseSchema.parse({ ok: true })).toEqual({ ok: true });
  });

  it('validates verify request/response', () => {
    expect(linkVerifyRequestSchema.parse({ token: 'abc' })).toEqual({ token: 'abc' });
    expect(() => linkVerifyRequestSchema.parse({ token: '' })).toThrow();
    const parsed = linkVerifyResponseSchema.parse({
      token: 'jwt',
      player: {
        id: UUID,
        displayName: 'Ada',
        avatar: { head: 'round', face: 'smile', accessory: 'none', inkColor: 'ink' },
        isGuest: false,
        createdAt: 1,
      },
    });
    expect(parsed.player.isGuest).toBe(false);
  });

  it('validates the Google sign-in request (idToken) and reuses the verify response shape', () => {
    expect(googleSignInRequestSchema.parse({ idToken: 'header.payload.sig' })).toEqual({
      idToken: 'header.payload.sig',
    });
    expect(() => googleSignInRequestSchema.parse({ idToken: '' })).toThrow();
    // Same `{ token, player }` shape as the magic-link verify — an upgraded (non-guest) account.
    const parsed = googleSignInResponseSchema.parse({
      token: 'jwt',
      player: {
        id: UUID,
        displayName: 'Grace',
        avatar: { head: 'round', face: 'smile', accessory: 'none', inkColor: 'ink' },
        isGuest: false,
        createdAt: 1,
      },
    });
    expect(parsed.player.isGuest).toBe(false);
  });

  it('validates the account-deletion ok envelope (DELETE /account)', () => {
    expect(deleteAccountResponseSchema.parse({ ok: true })).toEqual({ ok: true });
    expect(() => deleteAccountResponseSchema.parse({ ok: false })).toThrow();
  });
});
