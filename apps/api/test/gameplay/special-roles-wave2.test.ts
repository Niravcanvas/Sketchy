import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../../src/server.js';
import { closeTable, createTable, freshestState, playToGameOver, priority as tablePriority } from '../bots/table.js';

/**
 * Special roles wave 2 — a wire-level proof for the ONE genuinely NEW socket
 * surface this wave adds (`special:grudge`), complementing the exhaustive engine-level
 * coverage in packages/engine/src/reducers/cascade.test.ts and
 * __tests__/special-roles-wave2.test.ts (the interaction matrix + 20-seed fuzz already
 * prove the cascade/scoring/redaction logic itself). Mirror/Lovebirds/Rivals/Mime don't
 * introduce any new socket events — they're purely engine-state-driven and already ride
 * the existing `room:snapshot` broadcast path, so they aren't re-proven here.
 */
describe('special roles wave 2 (Grudge) — 6-bot integration', () => {
  let server: FastifyInstance;
  let baseUrl: string;

  beforeEach(async () => {
    server = await buildServer();
    baseUrl = await server.listen({ port: 0 });
  });

  afterEach(async () => {
    await server.close();
  });

  it('the Grudge drags a target down over the real wire: canAct.grudge, redaction, chained reveal', async () => {
    const table = await createTable(server, baseUrl, {
      n: 6,
      namePrefix: 'Grudge',
      settings: { specialRoles: ['grudge'] },
    });

    try {
      const grudgeBot = table.bots.find((b) => b.latest()?.you.specialRole === 'grudge');
      expect(grudgeBot, 'a Grudge holder must be assigned').toBeDefined();

      // Pre-elimination: nobody (including the Grudge themselves seeing it reflected back
      // publicly) can see the Grudge's identity yet — no early-reveal exception for Grudge.
      const bystander = table.bots.find((b) => b.playerId !== grudgeBot!.playerId)!;
      const preRevealState = bystander.latest()!.state;
      expect(
        preRevealState.players.find((p) => p.id === grudgeBot!.playerId)?.specialRole,
      ).toBeNull();

      const otherBots = table.bots.filter((b) => b.playerId !== grudgeBot!.playerId);
      expect(otherBots).toHaveLength(5);
      const dragTarget = otherBots[0]!;

      // Vote the Grudge out unanimously (everyone else piles on; the Grudge casts their
      // own required throwaway ballot).
      await playToGameOver(table, {
        priority: tablePriority.undercoverWin,
        until: (s) => s.phase === 'voting',
        timeoutMs: 15_000,
      });
      const alive = freshestState(table).players.filter((p) => p.alive);
      for (const bot of table.bots) {
        if (!alive.some((p) => p.id === bot.playerId)) continue;
        // Everyone piles onto the Grudge; the Grudge can't vote for themselves, so their
        // own required ballot is a harmless throwaway to whichever OTHER alive player.
        const finalTarget =
          bot.playerId === grudgeBot!.playerId
            ? alive.find((p) => p.id !== grudgeBot!.playerId)!.id
            : grudgeBot!.playerId;
        const ack = await bot.vote(finalTarget);
        expect(ack.ok).toBe(true);
      }

      // The vote closing only lands on `reveal` (the Grudge's own card showing) — the
      // host must dismiss it before the engine checks for the Grudge trigger and opens
      // `grudge_decision` (reducers/cascade.ts `advanceCascadeOrResolve`). The Grudge's
      // BASE role is assigned independently of their special role, so — rarely — they
      // might ALSO be Mr. White: that guess window (if any) comes first (`resolveRevealPhase`
      // always checks Mr. White before the Grudge trigger), so handle both orderings.
      await table.host.waitForPhase('reveal', 6000);
      await table.host.phaseAdvance();
      if (freshestState(table).phase === 'mrwhite_guess') {
        const guessAck = await grudgeBot!.mrWhiteGuess('definitely-not-it');
        expect(guessAck.ok).toBe(true);
      }
      await table.host.waitForPhase('grudge_decision', 8000);
      const revealedState = freshestState(table);
      expect(revealedState.pendingElimination).toBe(grudgeBot!.playerId);
      // The Grudge's identity is now public (ordinary "eliminated -> role visible" rule —
      // NOT a special early-reveal exception, since they're genuinely eliminated by now).
      expect(
        revealedState.players.find((p) => p.id === grudgeBot!.playerId)?.specialRole,
      ).toBe('grudge');

      // canAct.grudge is true ONLY for the Grudge, only now. Wait on the Grudge's OWN
      // snapshot stream specifically — `table.host.waitForPhase` above only guarantees the
      // HOST has seen the transition; other bots' snapshots can lag by a tick.
      await grudgeBot!.waitForSnapshot(
        (s) => s.you.canAct.grudge === true,
        'canAct.grudge to flip true for the Grudge',
        6000,
      );
      expect(bystander.latest()!.you.canAct.grudge).toBe(false);

      // A non-Grudge attempting to drag someone is rejected server-side.
      const impersonation = await bystander.specialGrudge(dragTarget.playerId);
      expect(impersonation).toEqual({ ok: false, error: 'validation' });

      // The real Grudge drags their target down.
      const dragAck = await grudgeBot!.specialGrudge(dragTarget.playerId);
      expect(dragAck.ok).toBe(true);

      await table.host.waitForPhase('reveal', 6000);
      const afterDrag = freshestState(table);
      expect(afterDrag.pendingElimination).toBe(dragTarget.playerId);
      expect(
        afterDrag.players.find((p) => p.id === dragTarget.playerId)?.alive,
      ).toBe(false);
      expect(afterDrag.players.find((p) => p.id === grudgeBot!.playerId)?.usedSpecialPower).toBe(
        true,
      );

      // Finish the game out normally — proves the room isn't stuck after the chain.
      const final = await playToGameOver(table, {
        priority: tablePriority.undercoverWin,
        timeoutMs: 20_000,
      });
      expect(final.phase).toBe('game_over');
    } finally {
      closeTable(table);
    }
  }, 30000);
});
