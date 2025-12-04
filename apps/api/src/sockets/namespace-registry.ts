import type { GameNamespace } from './types.js';

/**
 * A tiny process-singleton holding the live `/game` namespace so the REST
 * `/v1/admin/stats` route can read the current local socket count
 * (`namespace.sockets.size`) without the socket layer and the route layer
 * importing each other. Set in `registerSockets`, cleared on shutdown.
 */
let gameNamespace: GameNamespace | undefined;

export function setGameNamespace(namespace: GameNamespace | undefined): void {
  gameNamespace = namespace;
}

/** The live `/game` namespace, or `undefined` before boot / after shutdown.
 * Used by the matchmaking matcher's interval (which is handed the namespace at
 * start) and by tests that need to drive a deterministic `runMatchTick`. */
export function getGameNamespace(): GameNamespace | undefined {
  return gameNamespace;
}

export function socketsConnected(): number {
  return gameNamespace?.sockets.size ?? 0;
}
