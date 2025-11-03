import { getRedis } from '../db/client.js';
import { chatLogKey, loadRoom } from '../rooms/room-store.js';

/**
 * Server-side recent-context capture for a report: the last 20 chat/clue
 * lines from the reporter's room, captured server-side.
 * Captured by the SERVER — never taken from the client, which can't be trusted
 * to report faithfully what was said. Stored verbatim in `reports.context`
 * (jsonb) for the admin queue to render.
 *
 * - Clues come from the live `GameState.clues` log (public by construction —
 *   never a secret word/role), the last 20, with player names resolved.
 * - Chat comes from the `room:{code}:chatlog` ring buffer (`handleChatSend`),
 *   the only place ephemeral chat is retained server-side.
 */
const MAX_LINES = 20;

export interface ReportContext {
  capturedAt: number;
  clues: { round: number; playerName: string; text: string }[];
  chat: { name: string; text: string; at: number }[];
}

export async function captureReportContext(code: string): Promise<ReportContext | null> {
  const room = await loadRoom(code);
  if (!room) {
    return null;
  }

  const nameById = new Map(room.state.players.map((p) => [p.id, p.name]));
  const clues = room.state.clues.slice(-MAX_LINES).map((clue) => ({
    round: clue.round,
    playerName: nameById.get(clue.playerId) ?? 'unknown',
    text: clue.text,
  }));

  const chat: ReportContext['chat'] = [];
  try {
    const raw = await getRedis().lrange(chatLogKey(code), -MAX_LINES, -1);
    for (const line of raw) {
      try {
        const parsed = JSON.parse(line) as { name?: string; text?: string; at?: number };
        chat.push({
          name: typeof parsed.name === 'string' ? parsed.name : 'unknown',
          text: typeof parsed.text === 'string' ? parsed.text : '',
          at: typeof parsed.at === 'number' ? parsed.at : 0,
        });
      } catch {
        // Skip a malformed chat-log line rather than fail the whole capture.
      }
    }
  } catch {
    // Chatlog unavailable (Redis blip) — a report with clue context but no chat
    // context is still worth filing.
  }

  return { capturedAt: Date.now(), clues, chat };
}
