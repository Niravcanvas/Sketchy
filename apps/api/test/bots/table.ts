import { randomUUID } from 'node:crypto';
import type { RedactedGameState } from '@sketchy/engine/redact-for';
import { suggestRoleCounts } from '@sketchy/engine/suggest-role-counts';
import type { SpecialRole } from '@sketchy/engine/types';
import type { FastifyInstance } from 'fastify';
import { getDb } from '../../src/db/client.js';
import { wordPacks, wordPairs } from '../../src/db/schema.js';
import { createGuest, uniqueIp } from '../../src/test-support.js';
import { SocketBot, sleep } from './socket-bot.js';

/**
 * A full table of bots around one room — the orchestration
 * layer over `SocketBot`. `createTable` spins up N guests, a REST-created room, N
 * connected+ready bots, starts the game, and deals; `playToGameOver` then drives the
 * whole loop to a chosen faction win.
 *
 * The driver is a PHASE-POLLING loop, not a fixed script: each tick it reads the
 * current phase and nudges the appropriate CONNECTED bots, keyed so it acts once per
 * transition (respecting the 60/min action rate limit). This is deliberately
 * chaos-tolerant — a disconnected clue-giver gets host-skipped, a disconnected voter
 * abstains at the (short) vote timer, and every engine action is idempotent, so a
 * timer-driven transition the driver didn't cause is simply observed on the next tick
 * rather than fought. The `onTick` hook lets a test inject disconnect/reconnect chaos.
 */

type BaseRole = 'civilian' | 'undercover' | 'mrwhite';

export interface TableSettings {
  undercoverCount?: number;
  mrWhiteCount?: number;
  clueTimerSec?: number | null;
  discussionTimerSec?: number | null;
  voteTimerSec?: number | null;
  /** Special roles (Judge/Ghost/Jester wave 1) — empty/omitted by default. */
  specialRoles?: SpecialRole[];
}

export interface CreateTableOptions {
  /** Player count (host is index 0). */
  n: number;
  /** Word pairs to seed a private pack from (defaults to one Coffee/Tea pair). */
  pairs?: Array<{ wordA: string; wordB: string }>;
  settings?: TableSettings;
  namePrefix?: string;
  /** Whether bots auto-reconnect on drop (default false — the harness drives it). */
  reconnection?: boolean;
}

export interface Table {
  server: FastifyInstance;
  baseUrl: string;
  code: string;
  bots: SocketBot[];
  host: SocketBot;
}

async function insertPrivatePack(
  ownerId: string,
  pairs: Array<{ wordA: string; wordB: string }>,
): Promise<string> {
  const db = getDb();
  const [pack] = await db
    .insert(wordPacks)
    .values({
      name: `Bots ${randomUUID().slice(0, 8)}`,
      isOfficial: false,
      ownerId,
      visibility: 'private',
    })
    .returning();
  if (!pack) throw new Error('pack insert failed');
  await db.insert(wordPairs).values(
    pairs.map((p) => ({ packId: pack.id, wordA: p.wordA, wordB: p.wordB, difficulty: 'easy' as const })),
  );
  return pack.id;
}

async function createRoomViaRest(
  server: FastifyInstance,
  token: string,
  settings: Record<string, unknown>,
): Promise<string> {
  const res = await server.inject({
    method: 'POST',
    url: '/v1/rooms',
    headers: { authorization: `Bearer ${token}` },
    payload: { settings },
    remoteAddress: uniqueIp(),
  });
  if (res.statusCode !== 200) {
    throw new Error(`room create failed: ${res.statusCode} ${res.body}`);
  }
  return (res.json() as { code: string }).code;
}

/** Stands up a ready-to-start (dealt) table: bots joined, all ready, game started,
 * every bot has acked their deal → the room sits in `dealing`→`clue` on return. */
export async function createTable(
  server: FastifyInstance,
  baseUrl: string,
  options: CreateTableOptions,
): Promise<Table> {
  const { n } = options;
  const pairs = options.pairs ?? [{ wordA: 'Coffee', wordB: 'Tea' }];
  const prefix = options.namePrefix ?? 'Bot';

  const sessions = [];
  for (let i = 0; i < n; i += 1) {
    sessions.push(await createGuest(server, { displayName: `${prefix}${i}`, ip: uniqueIp() }));
  }
  const hostSession = sessions[0]!;
  const packId = await insertPrivatePack(hostSession.playerId, pairs);

  const s = options.settings ?? {};
  // Role counts default to the engine's own suggestion for `n`, which always
  // satisfies the role-math bound (civilians must outnumber the rest); a caller
  // wanting a Mr. White in a small game overrides explicitly.
  const suggested = suggestRoleCounts(n);
  const code = await createRoomViaRest(server, hostSession.token, {
    maxPlayers: n,
    undercoverCount: s.undercoverCount ?? suggested.undercoverCount,
    mrWhiteCount: s.mrWhiteCount ?? suggested.mrWhiteCount,
    packIds: [packId],
    clueTimerSec: s.clueTimerSec ?? null,
    discussionTimerSec: s.discussionTimerSec ?? null,
    voteTimerSec: s.voteTimerSec ?? null,
    specialRoles: s.specialRoles ?? [],
  });

  const bots: SocketBot[] = [];
  for (const session of sessions) {
    const bot = new SocketBot(baseUrl, session, { reconnection: options.reconnection });
    await bot.connect();
    const ack = await bot.join(code);
    if (!ack.ok) throw new Error(`bot ${session.displayName} join failed: ${ack.error}`);
    bots.push(bot);
  }

  for (const bot of bots) await bot.ready(true);
  const host = bots[0]!;
  await host.waitForSnapshot((snap) => snap.state.players.every((p) => p.isReady), 'all ready');

  const startAck = await host.start();
  if (!startAck.ok) throw new Error(`start failed: ${startAck.error}`);
  await host.waitForPhase('dealing');

  for (const bot of bots) await bot.dealAck();

  return { server, baseUrl, code, host, bots };
}

/** Freshest public state seen by ANY connected bot (the host may be disconnected). */
export function freshestState(table: Table): RedactedGameState {
  let best: { ver: number; state: RedactedGameState } | undefined;
  for (const bot of table.bots) {
    const snap = bot.latest();
    if (snap && (!best || snap.ver > best.ver)) best = { ver: snap.ver, state: snap.state };
  }
  if (!best) throw new Error('no bot has a snapshot yet');
  return best.state;
}

export function botFor(table: Table, playerId: string): SocketBot | undefined {
  return table.bots.find((b) => b.playerId === playerId);
}

/** playerId → base role, read from each bot's OWN you-slice (never another's secret). */
export function roleMap(table: Table): Map<string, BaseRole> {
  const map = new Map<string, BaseRole>();
  for (const bot of table.bots) {
    const role = bot.latest()?.you.role;
    if (role) map.set(bot.playerId, role);
  }
  return map;
}

export interface PlayOptions {
  /** Lower = eliminated earlier — steers which faction wins (as engine test-support). */
  priority: (role: BaseRole | null) => number;
  /** Mr. White's guess correctness if the loop reaches `mrwhite_guess`. */
  mrWhiteGuessCorrect?: boolean;
  /** Injected each tick for chaos (disconnect/reconnect). */
  onTick?: (table: Table, state: RedactedGameState) => void | Promise<void>;
  /** Stop early (return the state) the moment this predicate holds, BEFORE acting
   * on that phase — e.g. `s => s.phase === 'voting'` drives clue+discussion then
   * halts at an un-voted voting phase (used by the timer-restart proof). */
  until?: (state: RedactedGameState) => boolean;
  timeoutMs?: number;
  pollMs?: number;
}

function isConnected(bot: SocketBot): boolean {
  return bot.socket.connected;
}

/**
 * Drives the room to `game_over`. Idempotent nudging keyed by a per-transition
 * signature (`phase:round:turnSeat:pending`) keeps it under the action rate limit
 * and lets timer-driven transitions during chaos resolve themselves.
 */
export async function playToGameOver(table: Table, options: PlayOptions): Promise<RedactedGameState> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const pollMs = options.pollMs ?? 120;
  const priority = options.priority;
  const acted = new Set<string>();
  const start = Date.now();

  const once = async (key: string, fn: () => Promise<unknown>): Promise<void> => {
    if (acted.has(key)) return;
    acted.add(key);
    await fn();
  };

  for (;;) {
    const state = freshestState(table);
    if (state.phase === 'game_over') return state;
    if (options.until && options.until(state)) return state;
    if (Date.now() - start > timeoutMs) {
      throw new Error(`playToGameOver timed out in phase ${state.phase} (round ${state.round})`);
    }

    if (options.onTick) await options.onTick(table, state);

    const host = table.host;
    const sig = `${state.phase}:${state.round}:${state.turnSeat}:${state.pendingElimination}`;

    switch (state.phase) {
      case 'dealing': {
        for (const bot of table.bots) {
          if (isConnected(bot)) await bot.dealAck();
        }
        break;
      }
      case 'clue':
      case 'tiebreak_clue': {
        const order = clueOrder(state);
        const holder = state.turnSeat !== null ? order[state.turnSeat] : undefined;
        if (holder) {
          const holderBot = botFor(table, holder.id);
          if (holderBot && isConnected(holderBot)) {
            await once(`clue:${sig}`, () =>
              holderBot.submitClue(`clue-${state.round}-${holder.id.slice(0, 4)}-${state.turnSeat}`),
            );
          } else if (isConnected(host)) {
            // Disconnected clue-giver → host skips them (game-design.md §8).
            await once(`skip:${sig}`, () => host.turnSkip());
          }
        }
        break;
      }
      case 'discussion': {
        if (isConnected(host)) await once(`disc:${sig}`, () => host.phaseAdvance());
        break;
      }
      case 'voting': {
        const alive = state.players.filter((p) => p.alive && !p.hasLeft);
        // Ghost: eliminated players keep vote:cast rights, so the round only
        // closes once THEY vote too — mirrors the engine's own eligibleVoterIds exactly.
        const ghostActive = state.settings.specialRoles.includes('ghost');
        const eligibleVoters = state.players.filter(
          (p) => !p.hasLeft && (p.alive || ghostActive),
        );
        const target = pickTarget(table, alive, priority);
        for (const voter of eligibleVoters) {
          const bot = botFor(table, voter.id);
          if (!bot || !isConnected(bot)) continue;
          const targetId = voter.id === target ? anyOther(alive, target) : target;
          if (targetId) await once(`vote:${sig}:${voter.id}`, () => bot.vote(targetId));
        }
        break;
      }
      case 'judge_decision': {
        // Judge special role: the Judge (alive or already eliminated) resolves
        // the tie directly — no re-vote, no host action.
        const judgeBot = table.bots.find((b) => b.latest()?.you.specialRole === 'judge');
        const tied = state.tiedPlayerIds ?? [];
        if (judgeBot && isConnected(judgeBot) && tied.length > 0) {
          const tiedPlayers = state.players.filter((p) => tied.includes(p.id));
          const target = pickTarget(table, tiedPlayers, priority);
          await once(`judge:${sig}`, () => judgeBot.specialJudge(target));
        }
        break;
      }
      case 'grudge_decision': {
        // Grudge special role: the just-eliminated Grudge picks one alive
        // player to drag down — no re-vote, no host action. Dragging SOMEBODY (rather than
        // leaving it to the 30s "drags nobody" default) keeps this driver fast.
        const grudgeId = state.pendingElimination;
        const grudgeBot = grudgeId ? botFor(table, grudgeId) : undefined;
        const alive = state.players.filter((p) => p.alive && !p.hasLeft);
        if (grudgeBot && isConnected(grudgeBot) && alive.length > 0) {
          const target = pickTarget(table, alive, priority);
          await once(`grudge:${sig}`, () => grudgeBot.specialGrudge(target));
        }
        break;
      }
      case 'reveal': {
        if (isConnected(host)) await once(`reveal:${sig}`, () => host.phaseAdvance());
        break;
      }
      case 'mrwhite_guess': {
        const guesserId = state.pendingElimination;
        const bot = guesserId ? botFor(table, guesserId) : undefined;
        if (bot && isConnected(bot)) {
          const civWord = civilianWord(table);
          const word = options.mrWhiteGuessCorrect && civWord ? civWord : 'definitely-not-it';
          await once(`guess:${sig}`, () => bot.mrWhiteGuess(word));
        }
        break;
      }
      case 'lobby':
        break;
    }

    await sleep(pollMs);
  }
}

function clueOrder(state: RedactedGameState): RedactedGameState['players'] {
  if (state.phase === 'tiebreak_clue' && state.tiedPlayerIds) {
    const tied = new Set(state.tiedPlayerIds);
    return state.players.filter((p) => tied.has(p.id));
  }
  return state.players.filter((p) => p.alive);
}

function pickTarget(
  table: Table,
  alive: RedactedGameState['players'],
  priority: (role: BaseRole | null) => number,
): string {
  const roles = roleMap(table);
  const sorted = [...alive].sort((a, b) => {
    const diff = priority(roles.get(a.id) ?? null) - priority(roles.get(b.id) ?? null);
    return diff !== 0 ? diff : a.seat - b.seat;
  });
  return sorted[0]!.id;
}

function anyOther(alive: RedactedGameState['players'], target: string): string | undefined {
  return alive.find((p) => p.id !== target)?.id;
}

function civilianWord(table: Table): string | undefined {
  for (const bot of table.bots) {
    const you = bot.latest()?.you;
    if (you?.role === 'civilian' && you.word) return you.word;
  }
  return undefined;
}

/** Elimination priorities (mirror engine test-support) — pick a target outcome. */
export const priority = {
  civilianWin: (role: BaseRole | null): number => (role === 'civilian' ? 1 : 0),
  undercoverWin: (role: BaseRole | null): number =>
    role === 'mrwhite' ? 0 : role === 'civilian' ? 1 : 2,
};

export function closeTable(table: Table): void {
  for (const bot of table.bots) bot.close();
}
