'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import type { RedactedGameState } from '@sketchy/engine/redact-for';
import type { Faction } from '@sketchy/engine/types';
import { IconCrown } from '@/components/icons/icon-crown';
import { ScribbleConfetti } from '@/components/pnp/scribble-confetti';
import { PopButton } from '@/components/pop/pop-button';
import { PopCard } from '@/components/pop/pop-card';
import { copy } from '@/copy';
import { apiClient } from '@/lib/api-client';
import { emitLeave, emitRematch } from '@/lib/socket';
import { useRoomStore } from '@/stores/room-store';
import { StandingsPanel, type StandingsRow } from './standings-panel';

/** Delay before fetching lifetime stats on win-screen mount: gives
 * the server's fire-and-forget `persistGame` effect (`rooms/persist-game.ts`, triggered the
 * instant `game_over` is entered) time to land its transaction before we read the
 * denormalized totals back — the socket broadcast that puts the client on this screen and
 * the Postgres write race each other, and there's no client-visible signal for "the write
 * landed" to wait on instead. 1.2s comfortably covers a same-region transaction; a slower
 * write just means the lifetime chip is a beat late to appear, never wrong. */
const LIFETIME_STATS_FETCH_DELAY_MS = 1200;

type BaseRole = 'civilian' | 'undercover' | 'mrwhite';

/** Full-bleed win-screen takeover per winning faction (design-party-pop.md §10). Literal
 * lookups (never template-interpolated) so Tailwind's content scan finds every class.
 * `infiltrators` has no dedicated token — the joint win borrows `undercover`. */
const FACTION_BG_CLASS: Record<Faction, string> = {
  civilian: 'bg-civilian',
  undercover: 'bg-undercover',
  mrwhite: 'bg-mrwhite',
  infiltrators: 'bg-undercover',
};

const ROLE_LABEL_CLASS: Record<BaseRole, string> = {
  civilian: 'text-civilian',
  undercover: 'text-undercover',
  mrwhite: 'text-mrwhite',
};

function roleCardTitle(role: BaseRole): string {
  if (role === 'civilian') return copy.roles.civilian.cardTitle;
  if (role === 'undercover') return copy.roles.undercover.cardTitle;
  return copy.roles.mrWhite.cardTitle;
}

/** The winning faction's role label(s) — two chips for the joint infiltrators win, so color
 * is never the only signal (design-party-pop.md §2). */
function winnerLabels(faction: Faction): string[] {
  if (faction === 'civilian') return [copy.roles.civilian.cardTitle];
  if (faction === 'undercover') return [copy.roles.undercover.cardTitle];
  if (faction === 'mrwhite') return [copy.roles.mrWhite.cardTitle];
  return [copy.roles.undercover.cardTitle, copy.roles.mrWhite.cardTitle];
}

/** `null` for the Mr. White steal (a single pre-combined `guessRight` sentence). */
function winSummary(
  faction: Faction,
): { headline: string; subline: string; points: string } | null {
  if (faction === 'civilian') return copy.reveal.winScreens.civilians;
  if (faction === 'undercover') return copy.reveal.winScreens.undercover;
  if (faction === 'infiltrators') return copy.reveal.winScreens.infiltrators;
  return null;
}

/**
 * The Jester's +4 first-out consolation, derived here for DISPLAY only from the
 * now-public `eliminatedRound`/`specialRole` fields (data-model.md §4) — the engine already
 * folded it into `scoreboard` immediately at elimination time (`applyJesterFirstOutBonus`,
 * reducers/shared.ts); this just re-derives WHETHER to show it, the same trick this file
 * already uses for the ordinary 2/6/10 deltas. `null` unless the very first player
 * eliminated this game held Jester (eliminations happen at most one per round, so the
 * minimum `eliminatedRound` is always unique).
 */
function firstOutJester(players: RedactedGameState['players']): { id: string; name: string } | null {
  let first: RedactedGameState['players'][number] | null = null;
  for (const p of players) {
    if (p.eliminatedRound === null) continue;
    if (!first || (p.eliminatedRound as number) < (first.eliminatedRound as number)) {
      first = p;
    }
  }
  return first && first.specialRole === 'jester' ? { id: first.id, name: first.name } : null;
}

/**
 * The Rivals ±2 scoring swing, re-derived here for DISPLAY only from the now-
 * public `eliminatedRound`/`specialRole` fields — the engine already folded it into
 * `scoreboard` at game-over time (`applyRivalsScoring`, reducers/cascade.ts), same trick
 * `firstOutJester` above uses. `null` when Rivals isn't enabled, or when both survived / both
 * fell in the same round (data-model.md "Phase 13 engine extension" — no swing either way).
 */
function rivalsOutcome(
  players: RedactedGameState['players'],
): { firstOut: { id: string; name: string }; survivor: { id: string; name: string } } | null {
  const rivals = players.filter((p) => p.specialRole === 'rivals');
  if (rivals.length !== 2) return null;
  const [a, b] = rivals as [RedactedGameState['players'][number], RedactedGameState['players'][number]];
  const rank = (p: RedactedGameState['players'][number]): number =>
    p.eliminatedRound === null ? Infinity : p.eliminatedRound;
  const ra = rank(a);
  const rb = rank(b);
  if (ra === rb) return null;
  const [firstOut, survivor] = ra < rb ? [a, b] : [b, a];
  return {
    firstOut: { id: firstOut.id, name: firstOut.name },
    survivor: { id: survivor.id, name: survivor.name },
  };
}

/**
 * Per-player points earned THIS game (the 2/6/10 deltas plus the Jester's +4), computed
 * from the now-public roles — a mirror of the engine's award rules (reveal.ts) and the
 * server's `persist-game.ts`. `state.scoreboard` is the SESSION total (carried across
 * rematches); the delta is what to pop onto it (design-party-pop.md §11 "score bumps").
 * Kept in lockstep with those two by the full-loop test, which asserts the first game's
 * deltas equal its scoreboard.
 */
function gameDeltas(state: RedactedGameState): Record<string, number> {
  const jester = firstOutJester(state.players);
  const deltas: Record<string, number> = jester ? { [jester.id]: 4 } : {};
  const faction = state.winnerFaction;
  if (faction === null) {
    return deltas;
  }
  const steal = faction === 'mrwhite' && state.lastGuess?.correct === true;
  for (const player of state.players) {
    let earned = deltas[player.id] ?? 0;
    if (faction === 'civilian' && player.role === 'civilian') earned += 2;
    if (
      (faction === 'undercover' || faction === 'infiltrators') &&
      player.role === 'undercover' &&
      player.alive
    ) {
      earned += 10;
    }
    if (
      !steal &&
      (faction === 'mrwhite' || faction === 'infiltrators') &&
      player.role === 'mrwhite' &&
      player.alive
    ) {
      earned += 6;
    }
    if (earned > 0) deltas[player.id] = earned;
  }
  if (steal && state.lastGuess) {
    deltas[state.lastGuess.playerId] = (deltas[state.lastGuess.playerId] ?? 0) + 6;
  }
  const rivals = rivalsOutcome(state.players);
  if (rivals) {
    deltas[rivals.firstOut.id] = (deltas[rivals.firstOut.id] ?? 0) - 2;
    deltas[rivals.survivor.id] = (deltas[rivals.survivor.id] ?? 0) + 2;
  }
  return deltas;
}

/**
 * The online game-over takeover (game-design.md §6.7): winner splash + confetti, full-table
 * reveal (every role + both words — redaction lifts at `game_over`, data-model.md §4), the
 * session scoreboard with 2/6/10 deltas, and the host's rematch CTA. Renders full-bleed (the
 * `GameScreen` gives it the whole screen at `game_over` rather than the standard chrome).
 * Reads only the public snapshot — `winnerFaction`/`scoreboard`/`pair`/`players[].role/word`
 * are all revealed by the server at `game_over`.
 *
 * TODO: game-design.md §6.7's host "Back to lobby" (return the room to `lobby` to
 * reshuffle players/settings) has no engine action / contract event — game_over only
 * transitions to `dealing` via `rematch`. Deferred to keep engine + shared frozen; "Leave
 * room" is the frozen-safe exit until a `game:reset` action lands.
 */
export function OnlineWinScreen() {
  const snapshot = useRoomStore((state) => state.snapshot);
  const you = useRoomStore((state) => state.you);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  // Hooks run unconditionally (Rules of Hooks) — the early `return null` below happens AFTER
  // these, same as the `useState`s above it.
  const [statsFetchReady, setStatsFetchReady] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setStatsFetchReady(true), LIFETIME_STATS_FETCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);
  const statsQuery = useQuery({
    queryKey: ['playerStats'],
    queryFn: () => apiClient.getPlayerStats(),
    enabled: statsFetchReady,
  });

  if (!snapshot || !you || !snapshot.winnerFaction || !snapshot.pair) {
    return null;
  }

  const faction = snapshot.winnerFaction;
  const pair = snapshot.pair;
  const isHost = snapshot.hostId === you.playerId;
  const hostName = snapshot.players.find((p) => p.id === snapshot.hostId)?.name ?? '';
  const summary = winSummary(faction);
  const headline = summary ? summary.headline : copy.reveal.guessRight(pair.civilianWord);
  const deltas = gameDeltas(snapshot);
  const myDelta = deltas[you.playerId] ?? 0;
  const jester = firstOutJester(snapshot.players);
  const rivals = rivalsOutcome(snapshot.players);

  const scoreboardRows = Object.entries(snapshot.scoreboard)
    .map(([playerId, points]) => {
      const player = snapshot.players.find((p) => p.id === playerId);
      return player
        ? { id: playerId, name: player.name, points, delta: deltas[playerId] ?? 0 }
        : null;
    })
    .filter(
      (row): row is { id: string; name: string; points: number; delta: number } => row !== null,
    )
    .sort((a, b) => b.points - a.points);

  const standingsRows: StandingsRow[] = scoreboardRows.map(({ id, name, points }) => ({
    id,
    name,
    points,
  }));

  async function handleRematch(): Promise<void> {
    setIsBusy(true);
    setError(null);
    const ack = await emitRematch();
    setIsBusy(false);
    if (!ack.ok) {
      setError(ack.error === 'not_host' ? copy.errors.notHost : copy.errors.generic500);
    }
  }

  async function handleLeave(): Promise<void> {
    setIsBusy(true);
    setError(null);
    const ack = await emitLeave();
    setIsBusy(false);
    if (!ack.ok) {
      setError(copy.errors.generic500);
    }
  }

  return (
    <div
      data-testid="online-win-screen"
      data-faction={faction}
      className={clsx(
        'dots flex min-h-screen flex-col items-center gap-10 px-6 py-12 text-center',
        FACTION_BG_CLASS[faction],
      )}
    >
      {/* 1. Winner splash */}
      <section className="relative flex w-full max-w-xl flex-col items-center gap-4 overflow-hidden pt-6">
        <ScribbleConfetti />
        <IconCrown className="h-12 w-12 text-highlight" />
        <div className="flex flex-wrap items-center justify-center gap-2">
          {winnerLabels(faction).map((label) => (
            <span key={label} className="font-display text-sm uppercase tracking-wide text-white">
              {label}
            </span>
          ))}
        </div>
        <h1 className="font-display text-4xl uppercase tracking-wide text-ink">
          <span className="pnp-slam inline-block rounded-lg bg-highlight px-2">{headline}</span>
        </h1>
        {summary ? <p className="font-ui text-lg text-white">{summary.subline}</p> : null}
        {summary ? (
          <p className="font-display text-xl uppercase tracking-wide text-highlight">
            {summary.points}
          </p>
        ) : null}
      </section>

      {/* 2. Full-table reveal */}
      <PopCard className="flex w-full max-w-xl flex-col gap-4">
        <h2 className="font-display text-2xl uppercase tracking-wide text-ink">
          {copy.reveal.fullReveal.header}
        </h2>
        <ul className="flex flex-col divide-y divide-graphite/20">
          {snapshot.players.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 py-2">
              <span className="font-ui text-[15px] font-bold text-ink">{p.name}</span>
              <span
                className={clsx(
                  'font-display text-xs uppercase tracking-wide',
                  p.role ? ROLE_LABEL_CLASS[p.role] : undefined,
                )}
              >
                {p.role ? roleCardTitle(p.role) : null}
              </span>
              {/* Mr. White's word is null — left blank rather than a placeholder string. */}
              <span className="font-ui text-sm font-medium text-graphite">{p.word}</span>
            </li>
          ))}
        </ul>
        <p className="font-ui text-ink">
          {copy.reveal.fullReveal.pairLine(pair.civilianWord, pair.undercoverWord)}
        </p>
      </PopCard>

      {/* 3. Scoreboard — session total with this-game 2/6/10 delta bumps. */}
      <PopCard className="flex w-full max-w-xl flex-col gap-3">
        <h2 className="font-display text-2xl uppercase tracking-wide text-ink">
          {copy.reveal.scoreboard.title}
        </h2>
        {jester ? (
          <p data-testid="online-jester-bonus" className="font-ui text-sm font-bold text-ink">
            {copy.reveal.jesterBonus(jester.name)}
          </p>
        ) : null}
        {rivals ? (
          <p data-testid="online-rivals-outcome" className="font-ui text-sm font-bold text-ink">
            {copy.reveal.rivalsFirstOut(rivals.firstOut.name)}{' '}
            {copy.reveal.rivalsSurvivor(rivals.survivor.name)}
          </p>
        ) : null}
        <ul data-testid="online-scoreboard" className="flex flex-col divide-y divide-graphite/20">
          {scoreboardRows.map((row) => (
            <li
              key={row.id}
              data-testid="online-scoreboard-row"
              data-name={row.name}
              data-points={row.points}
              data-delta={row.delta}
              className="flex items-center justify-between gap-3 py-2"
            >
              <span className="font-ui text-[15px] font-bold text-ink">{row.name}</span>
              <span className="flex items-baseline gap-2">
                {row.delta !== 0 ? (
                  <span
                    key={row.points}
                    className={clsx(
                      'pnp-pop-in font-display text-sm uppercase tracking-wide',
                      row.delta > 0 ? 'text-success' : 'text-undercover',
                    )}
                  >
                    {row.delta > 0
                      ? copy.reveal.scoreboard.delta(row.delta)
                      : copy.reveal.scoreboard.deltaNegative(row.delta)}
                  </span>
                ) : null}
                <span className="font-display text-2xl text-ink">{row.points}</span>
              </span>
            </li>
          ))}
        </ul>
        {statsQuery.data ? (
          <div className="flex items-center justify-center gap-2 border-t-3 border-ink pt-3">
            <span
              data-testid="lifetime-scrapbook-chip"
              className="rounded-lg border-3 border-ink bg-highlight px-3 py-1 font-ui text-xs font-bold uppercase tracking-[0.08em] text-ink"
            >
              {copy.reveal.scoreboard.lifetimeChip(statsQuery.data.totalPoints)}
            </span>
            {myDelta > 0 ? (
              <span
                key={statsQuery.data.totalPoints}
                className="pnp-pop-in font-display text-sm uppercase tracking-wide text-success"
              >
                {copy.reveal.scoreboard.delta(myDelta)}
              </span>
            ) : null}
          </div>
        ) : null}
      </PopCard>

      {/* 3b. Standings — ranked positions across this room's rematches + tonight's MVP. */}
      <StandingsPanel rows={standingsRows} />

      {/* 4. CTAs */}
      <section className="flex flex-col items-center gap-3">
        {isHost ? (
          <PopButton
            variant="accent"
            size="lg"
            data-testid="online-rematch"
            disabled={isBusy}
            onClick={() => {
              void handleRematch();
            }}
          >
            {copy.reveal.endCTAs.rematch}
          </PopButton>
        ) : (
          <p data-testid="online-waiting-host" className="font-ui text-lg text-white">
            {copy.reveal.endCTAs.waitingForHost(hostName)}
          </p>
        )}
        <PopButton
          variant="secondary"
          data-testid="online-leave-room"
          disabled={isBusy}
          onClick={() => {
            void handleLeave();
          }}
        >
          {copy.reveal.endCTAs.leaveRoom}
        </PopButton>
        {error ? (
          // This screen is a
          // full-bleed winning-faction takeover (bg-civilian/undercover/mrwhite) — bare
          // `text-ink` here was a real contrast dip against those fills. A white chip
          // matches design-party-pop.md §2 ("state text sits ON a colored chip in ink or
          // white") and every other error treatment in the app (`text-undercover` on
          // `bg-paper-2`).
          <p
            role="alert"
            className="rounded-xl border-3 border-ink bg-paper-2 px-4 py-2 font-ui text-sm font-medium text-undercover shadow-hard-sm"
          >
            {error}
          </p>
        ) : null}
      </section>
    </div>
  );
}
