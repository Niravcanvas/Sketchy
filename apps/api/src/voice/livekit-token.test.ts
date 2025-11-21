import { TokenVerifier } from 'livekit-server-sdk';
import { describe, expect, it } from 'vitest';
import { getEnv } from '../env.js';
import { mintVoiceToken } from './livekit-token.js';

describe('mintVoiceToken', () => {
  it('signs an audio-only, room-scoped, identity-bound token', async () => {
    const result = await mintVoiceToken({
      roomCode: 'AB2CD',
      playerId: '123e4567-e89b-12d3-a456-426614174000',
      playerName: 'Priya',
    });

    expect(result.token.split('.')).toHaveLength(3);
    expect(result.url).toBe(getEnv().livekitUrl);

    const env = getEnv();
    const verifier = new TokenVerifier(env.livekitApiKey, env.livekitApiSecret);
    const claims = await verifier.verify(result.token);

    expect(claims.sub).toBe('123e4567-e89b-12d3-a456-426614174000');
    expect(claims.name).toBe('Priya');
    expect(claims.video?.room).toBe('AB2CD');
    expect(claims.video?.roomJoin).toBe(true);
    expect(claims.video?.canPublish).toBe(true);
    expect(claims.video?.canSubscribe).toBe(true);
    expect(claims.video?.canPublishData).toBe(false);
    // Audio-only publish, enforced at the grant level (livekit-token.ts doc comment):
    // canPublishSources supersedes the broader canPublish flag.
    expect(claims.video?.canPublishSources).toEqual(['microphone']);
  });

  it('mints a distinct token per player (identity varies)', async () => {
    const a = await mintVoiceToken({ roomCode: 'AB2CD', playerId: 'p1', playerName: 'A' });
    const b = await mintVoiceToken({ roomCode: 'AB2CD', playerId: 'p2', playerName: 'B' });
    expect(a.token).not.toBe(b.token);
  });
});
