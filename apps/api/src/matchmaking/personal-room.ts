/**
 * Per-player Socket.IO room name. Every `/game` socket joins its
 * player's personal room on connect (`sockets/index.ts`), so the matcher can
 * push `mm:matched` to a queued player who isn't in any GAME room yet — and to
 * every open tab that player has. Prefixed `mm:u:` and keyed by the playerId
 * (a UUID), so it can never collide with a 5-char uppercase room code.
 */
export function personalRoom(playerId: string): string {
  return `mm:u:${playerId}`;
}
