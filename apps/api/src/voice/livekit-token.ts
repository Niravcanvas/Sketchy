import { AccessToken, TrackSource } from 'livekit-server-sdk';
import { getEnv } from '../env.js';

/**
 * Token TTL (system-design.md §8 "short-lived LiveKit tokens", api-contract.md
 * §1). "Short" relative to the 180-day player JWT (system-design.md §6), not
 * razor-thin: LiveKit only re-validates this token on a full reconnect (a
 * transient blip resumes the existing session without re-presenting it), and
 * a table can realistically sit in a lobby chatting before the game even
 * starts. 6h comfortably outlives any single sitting. The other half of
 * reconnect resilience — recovering from a LiveKit outage that outlasts this
 * TTL — is the web client's own retry loop (`apps/web/src/lib/voice.ts`),
 * which always re-fetches a FRESH token per join attempt rather than reusing
 * a stale one, so this TTL is not the only thing standing between a long
 * outage and "voice never comes back without a page reload".
 */
const VOICE_TOKEN_TTL_SECONDS = 6 * 60 * 60;

export interface VoiceTokenResult {
  token: string;
  url: string;
}

/**
 * Mints a signed, audio-only LiveKit access token (api-contract.md §1 `GET
 * /rooms/:code/voice-token`): `identity` = playerId (so LiveKit's own
 * `Participant.identity` maps 1:1 onto our player ids — `apps/web/src/lib/voice.ts`
 * relies on this for the speaking-ring lookup), `room` = the room code (the
 * LiveKit room name PERSISTS across rematches for the same code — for
 * session continuity; nothing here ever rotates it).
 * Pure JWT signing — no network call to LiveKit itself, so this never fails
 * because the LiveKit server happens to be down (the token is still valid;
 * the CLIENT's own connect attempt is what surfaces "voice unavailable").
 *
 * Audio-only is enforced at the GRANT level, not by convention:
 * `canPublishSources: [TrackSource.MICROPHONE]` supersedes the broader
 * `canPublish` flag (livekit-server-sdk's own doc comment: "When set, it
 * supersedes CanPublish. Only sources explicitly set here can be
 * published") — a client holding this token cannot publish a camera or
 * screen-share track even if it tried, closing off the "voice chat becomes
 * a video call" concern without needing a separate server-side policy.
 */
export async function mintVoiceToken(params: {
  roomCode: string;
  playerId: string;
  playerName: string;
}): Promise<VoiceTokenResult> {
  const env = getEnv();
  const at = new AccessToken(env.livekitApiKey, env.livekitApiSecret, {
    identity: params.playerId,
    name: params.playerName,
    ttl: VOICE_TOKEN_TTL_SECONDS,
  });
  at.addGrant({
    room: params.roomCode,
    roomJoin: true,
    canPublish: true,
    canPublishSources: [TrackSource.MICROPHONE],
    canSubscribe: true,
    canPublishData: false,
  });
  const token = await at.toJwt();
  return { token, url: env.livekitUrl };
}
