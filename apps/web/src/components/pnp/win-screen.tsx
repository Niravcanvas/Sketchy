'use client';

import clsx from 'clsx';
import { redactFor } from '@sketchy/engine/redact-for';
import type { RedactedGamePlayer } from '@sketchy/engine/redact-for';
import type { Faction } from '@sketchy/engine/types';
import { copy } from '@/copy';
import { usePnpStore } from '@/stores/pnp-store';
import { PopButton } from '@/components/pop/pop-button';
import { PopCard } from '@/components/pop/pop-card';
import { IconCrown } from '@/components/icons/icon-crown';
import { ScribbleConfetti } from '@/components/pnp/scribble-confetti';

type BaseRole = 'civilian' | 'undercover' | 'mrwhite';

/** Full-bleed win-screen takeover background per winning faction (design-party-pop.md §10).
 * Literal lookups (never template-interpolated class names) so Tailwind's content scan still
 * finds every class string. `infiltrators` has no dedicated palette token (conventions.md §2
 * only defines civilian/undercover/mrwhite/highlight/success) — the joint Undercover+Mr.White
 * win borrows `undercover`, the palette's other "doubles as danger" color. */
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

/** The faction name label(s) shown alongside the headline so color is never the only
 * signal (conventions.md §2) — two chips for the joint infiltrators win. */
function winnerLabels(faction: Faction): string[] {
  if (faction === 'civilian') return [copy.roles.civilian.cardTitle];
  if (faction === 'undercover') return [copy.roles.undercover.cardTitle];
  if (faction === 'mrwhite') return [copy.roles.mrWhite.cardTitle];
  return [copy.roles.undercover.cardTitle, copy.roles.mrWhite.cardTitle];
}

/** `null` when there's no headline/subline/points breakdown to render — the `mrwhite`
 * steal case (`copy.reveal.guessRight`) is a single pre-combined sentence instead. */
function winSummary(faction: Faction): { headline: string; subline: string; points: string } | null {
  if (faction === 'civilian') return copy.reveal.winScreens.civilians;
  if (faction === 'undercover') return copy.reveal.winScreens.undercover;
  if (faction === 'infiltrators') return copy.reveal.winScreens.infiltrators;
  return null;
}

/** The Jester's +4 first-out consolation — derived here for DISPLAY only from the
 * now-public `eliminatedRound`/`specialRole` fields (the engine already folded the bonus
 * into `game.scoreboard` immediately at elimination time). `null` unless the very first
 * player eliminated this game held Jester. Mirrors `room/game/win-screen.tsx`'s identical
 * helper (online). */
function firstOutJester(players: RedactedGamePlayer[]): { name: string } | null {
  let first: RedactedGamePlayer | null = null;
  for (const p of players) {
    if (p.eliminatedRound === null) continue;
    if (!first || (p.eliminatedRound as number) < (first.eliminatedRound as number)) {
      first = p;
    }
  }
  return first && first.specialRole === 'jester' ? { name: first.name } : null;
}

/** The Rivals ±2 scoring outcome — derived here for DISPLAY only, mirrors
 * `room/game/win-screen.tsx`'s identical helper (online). `null` when Rivals isn't enabled,
 * or both survived / both fell in the same round (no swing either way). */
function rivalsOutcome(
  players: RedactedGamePlayer[],
): { firstOut: { name: string }; survivor: { name: string } } | null {
  const rivals = players.filter((p) => p.specialRole === 'rivals');
  if (rivals.length !== 2) return null;
  const [a, b] = rivals as [RedactedGamePlayer, RedactedGamePlayer];
  const rank = (p: RedactedGamePlayer): number => (p.eliminatedRound === null ? Infinity : p.eliminatedRound);
  const ra = rank(a);
  const rb = rank(b);
  if (ra === rb) return null;
  const [firstOut, survivor] = ra < rb ? [a, b] : [b, a];
  return { firstOut: { name: firstOut.name }, survivor: { name: survivor.name } };
}

/**
 * game-design.md §6.7 — winner splash, full-table reveal, scoreboard, rematch/start-fresh.
 * Renders exclusively from `redactFor(game, 'spectator')` (data-model.md §4: `game_over`
 * unlocks every role/word/pair to a spectator) — never the raw `game.players[].role/word`
 * or `game.pair`. Raw `game.scoreboard`/`winnerFaction` are public fields (redaction never
 * touches them), read directly.
 */
export function PnpWinScreen() {
  const game = usePnpStore((s) => s.game);
  const rematch = usePnpStore((s) => s.rematch);
  const resetToSetup = usePnpStore((s) => s.resetToSetup);

  // Defensive only — the router (pnp-game.tsx) mounts this component exclusively at
  // `phase === 'game_over'`, where `winnerFaction`/`pair` are always set.
  if (!game || !game.winnerFaction) return null;

  const spectator = redactFor(game, 'spectator');
  const faction = game.winnerFaction;
  const pair = spectator.pair;
  if (!pair) return null;

  const summary = winSummary(faction);
  const headline = summary ? summary.headline : copy.reveal.guessRight(pair.civilianWord);
  const jester = firstOutJester(spectator.players);
  const rivals = rivalsOutcome(spectator.players);

  const scoreboardRows = Object.entries(game.scoreboard)
    .map(([playerId, points]) => {
      const player = spectator.players.find((p) => p.id === playerId);
      return player ? { id: playerId, name: player.name, points } : null;
    })
    .filter((row): row is { id: string; name: string; points: number } => row !== null)
    .sort((a, b) => b.points - a.points);

  return (
    <div
      data-testid="pnp-win-screen"
      data-faction={faction}
      className={clsx(
        // Full-bleed faction takeover (design-party-pop.md §10) with a halftone
        // ground; white / highlight display type over the saturated color.
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
        {/* Winner headline (design-party-pop.md §7): the name slams into a tilted
            highlight sticker block. */}
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
          {spectator.players.map((p) => (
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

      {/* 3. Scoreboard — points in the display face (design-party-pop.md §3 "big numbers"). */}
      <PopCard className="flex w-full max-w-xl flex-col gap-3">
        <h2 className="font-display text-2xl uppercase tracking-wide text-ink">
          {copy.reveal.scoreboard.title}
        </h2>
        {jester ? (
          <p data-testid="pnp-jester-bonus" className="font-ui text-sm font-bold text-ink">
            {copy.reveal.jesterBonus(jester.name)}
          </p>
        ) : null}
        {rivals ? (
          <p data-testid="pnp-rivals-outcome" className="font-ui text-sm font-bold text-ink">
            {copy.reveal.rivalsFirstOut(rivals.firstOut.name)}{' '}
            {copy.reveal.rivalsSurvivor(rivals.survivor.name)}
          </p>
        ) : null}
        <ul data-testid="pnp-scoreboard" className="flex flex-col divide-y divide-graphite/20">
          {scoreboardRows.map((row) => (
            <li
              key={row.id}
              data-testid="pnp-scoreboard-row"
              data-name={row.name}
              data-points={row.points}
              className="flex items-center justify-between gap-3 py-2"
            >
              <span className="font-ui text-[15px] font-bold text-ink">{row.name}</span>
              <span className="font-display text-2xl text-ink">{row.points}</span>
            </li>
          ))}
        </ul>
      </PopCard>

      {/* 4. CTAs */}
      <section className="flex flex-col items-center gap-3">
        <PopButton variant="accent" size="lg" data-testid="pnp-rematch" onClick={rematch}>
          {copy.reveal.endCTAs.rematch}
        </PopButton>
        <PopButton variant="secondary" data-testid="pnp-start-fresh" onClick={resetToSetup}>
          {copy.pnp.resume.startFresh}
        </PopButton>
      </section>
    </div>
  );
}
