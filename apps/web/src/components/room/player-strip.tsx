'use client';

import { useState } from 'react';
import clsx from 'clsx';
import type { RedactedGamePlayer, RedactedGameState } from '@sketchy/engine/redact-for';
import { AvatarDoodle } from '@/components/avatar/avatar-doodle';
import { IconCheck } from '@/components/icons/icon-check';
import { IconCrown } from '@/components/icons/icon-crown';
import { IconGhost } from '@/components/icons/icon-ghost';
import { IconMicOff } from '@/components/icons/icon-mic-off';
import { IconPencil } from '@/components/icons/icon-pencil';
import { PopButton } from '@/components/pop/pop-button';
import { PopDialog } from '@/components/pop/pop-dialog';
import { PlayerModeration } from '@/components/room/player-moderation';
import { copy } from '@/copy';
import { copyForError } from '@/lib/error-copy';
import { emitHostTransfer, emitKick } from '@/lib/socket';
import { useRoomStore } from '@/stores/room-store';
import { useVoiceStore } from '@/stores/voice-store';

/** The eliminated player's now-public role, for the "OUT · {ROLE}" strip tag (redactFor
 * reveals `role` the instant a player is eliminated, data-model.md §4). */
function roleCardTitle(role: 'civilian' | 'undercover' | 'mrwhite'): string {
  if (role === 'civilian') return copy.roles.civilian.cardTitle;
  if (role === 'undercover') return copy.roles.undercover.cardTitle;
  return copy.roles.mrWhite.cardTitle;
}

/**
 * Turn order for whichever clue-giving phase `state` is in, re-derived from the redacted
 * snapshot — the same small derivation as `game/clue-screen.tsx` (see that file's comment
 * for why the engine's own `currentTurnOrder` isn't reusable against `RedactedGameState`).
 * Returns `null` outside `clue`/`tiebreak_clue` so the current-turn highlight only ever
 * lights up during an actual clue round.
 */
function currentSpeakerId(state: RedactedGameState): string | null {
  if (state.turnSeat === null) return null;
  if (state.phase !== 'clue' && state.phase !== 'tiebreak_clue') return null;
  const order =
    state.phase === 'tiebreak_clue' && state.tiedPlayerIds
      ? state.players.filter((p) => state.tiedPlayerIds?.includes(p.id))
      : state.players.filter((p) => p.alive);
  return order[state.turnSeat]?.id ?? null;
}

/**
 * Seat-ordered player cards (game-design.md §3.2): doodle avatar, host pencil-crown, ready
 * checkmark (never color-only — the check IS the signal, conventions.md §2 contrast note),
 * and a faded/microtext treatment for a disconnected player's card (game-design.md §8's
 * 90-second grace window). In-game: the current clue turn-holder's card flips to a
 * civilian-blue sticker + pencil icon (color is never the only signal here either), and a
 * checkmark on every player who's already acked their word during `dealing`. Host tapping
 * another player's card opens a kick confirm dialog — lobby-only; kicking mid-game isn't a
 * thing (game-design.md §8's disconnect/skip flow replaces it once a game is underway).
 */
export function PlayerStrip() {
  const snapshot = useRoomStore((state) => state.snapshot);
  const you = useRoomStore((state) => state.you);
  // Speaking ring (LiveKit audio-level events, only meaningful for players who are
  // THEMSELVES connected to voice — game-design.md §10) and the mute badge (the `voice:state`
  // → `voice:roster` mirror, visible to every seated player regardless of their own voice
  // connection).
  const voiceSpeakingIds = useVoiceStore((state) => state.speakingIds);
  const mutedRoster = useVoiceStore((state) => state.mutedRoster);
  const [kickTarget, setKickTarget] = useState<RedactedGamePlayer | null>(null);
  const [kickError, setKickError] = useState<string | null>(null);
  const [isKicking, setIsKicking] = useState(false);
  const [hostTarget, setHostTarget] = useState<RedactedGamePlayer | null>(null);
  const [hostError, setHostError] = useState<string | null>(null);
  const [isTransferring, setIsTransferring] = useState(false);

  if (!snapshot) {
    return null;
  }

  const isHost = snapshot.hostId === you?.playerId;
  const isLobby = snapshot.phase === 'lobby';
  const isGameOver = snapshot.phase === 'game_over';
  const isDealing = snapshot.phase === 'dealing';
  const speakerId = currentSpeakerId(snapshot);
  // Ghost: eliminated players styled distinctly — graphite is the token
  // design-party-pop.md §2 reserves for "ghost players" — plus an IconGhost badge so the
  // signal is never color-only.
  const ghostActive = snapshot.settings.specialRoles.includes('ghost');

  function closeDialog(): void {
    setKickTarget(null);
    setKickError(null);
  }

  function closeHostDialog(): void {
    setHostTarget(null);
    setHostError(null);
  }

  async function confirmKick(): Promise<void> {
    if (!kickTarget) return;
    setIsKicking(true);
    setKickError(null);
    const ack = await emitKick(kickTarget.id);
    setIsKicking(false);
    if (ack.ok) {
      setKickTarget(null);
    } else {
      setKickError(copyForError(ack.error));
    }
  }

  async function confirmMakeHost(): Promise<void> {
    if (!hostTarget) return;
    setIsTransferring(true);
    setHostError(null);
    const ack = await emitHostTransfer(hostTarget.id);
    setIsTransferring(false);
    if (ack.ok) {
      setHostTarget(null);
    } else {
      setHostError(copyForError(ack.error));
    }
  }

  return (
    <>
      <ul data-testid="player-strip" className="flex flex-wrap justify-center gap-4">
        {snapshot.players.map((player) => {
          const isPlayerHost = player.id === snapshot.hostId;
          const canKick = isHost && isLobby && !isPlayerHost;
          // Mid-game only: hand the pencil to another seated player (game-design.md §8).
          const canMakeHost = isHost && !isLobby && !isGameOver && !isPlayerHost;
          const cardActionable = canKick || canMakeHost;
          const isCurrentTurn = speakerId === player.id;
          const isEliminated = !player.alive;
          const isGhost = isEliminated && ghostActive;
          const hasVoted =
            snapshot.phase === 'voting' && player.alive && snapshot.votedIds.includes(player.id);
          // Speaking ring only lights up for a player LiveKit is actually reporting
          // audio levels for (i.e. someone connected to voice); the mute badge reads the
          // server-mirrored roster instead, so it's accurate for viewers who never joined
          // voice themselves too (game-design.md §10).
          const isVoiceSpeaking = voiceSpeakingIds.has(player.id);
          const isVoiceMuted = mutedRoster[player.id] === true;
          return (
            <li key={player.id}>
              {/* Current speaker → tilted civilian-blue sticker; eliminated → tilted
                  undercover-red "OUT" row (design-party-pop.md §7/§11). Color is never the
                  only signal — the pencil icon / OUT tag ride alongside. */}
              <button
                type="button"
                disabled={!cardActionable}
                data-testid="player-card"
                data-player-name={player.name}
                data-ready={player.isReady}
                data-connected={player.connected}
                data-host={isPlayerHost}
                data-current-turn={isCurrentTurn}
                data-eliminated={isEliminated}
                data-ghost={isGhost}
                data-voted={hasVoted}
                data-voice-speaking={isVoiceSpeaking}
                data-voice-muted={isVoiceMuted}
                onClick={() => {
                  if (canKick) setKickTarget(player);
                  else if (canMakeHost) setHostTarget(player);
                }}
                className={clsx(
                  'flex w-28 flex-col items-center gap-1 rounded-xl border-3 border-ink p-3 text-center shadow-hard-sm transition-[transform,box-shadow,background-color] duration-150',
                  isCurrentTurn && 'rotate-1 bg-civilian text-white',
                  !isCurrentTurn && isGhost && '-rotate-1 bg-graphite text-white',
                  !isCurrentTurn && isEliminated && !isGhost && '-rotate-1 bg-undercover text-white',
                  !isCurrentTurn && !isEliminated && 'bg-paper-2 text-ink',
                  !player.connected && 'opacity-50',
                  cardActionable ? 'cursor-pointer hover:-translate-y-0.5' : 'cursor-default',
                  // The speaking ring — a highlight-token outline, never the only signal (the
                  // player-card is always ALSO labeled by name; this is a pure enhancement).
                  isVoiceSpeaking && 'outline outline-4 outline-highlight outline-offset-2',
                )}
              >
                <div className="relative">
                  <AvatarDoodle config={player.avatar} size={48} title={player.name} />
                  {isVoiceMuted ? (
                    <IconMicOff
                      data-testid="voice-muted-badge"
                      className="absolute -left-2 -top-2 h-4 w-4 rounded-full bg-paper text-undercover"
                      aria-hidden="true"
                    />
                  ) : null}
                  {isPlayerHost ? (
                    <IconCrown
                      className="absolute -right-2 -top-2 h-5 w-5 text-highlight"
                      aria-hidden="true"
                    />
                  ) : null}
                  {isGhost ? (
                    <IconGhost
                      data-testid="ghost-badge"
                      className="absolute -bottom-1 -left-1 h-4 w-4 rounded-full bg-paper text-ink"
                      aria-hidden="true"
                    />
                  ) : null}
                  {isDealing && player.hasSeenWord ? (
                    <IconCheck
                      data-testid="has-seen-word"
                      className="absolute -bottom-1 -right-1 h-4 w-4 rounded-full bg-paper text-success"
                      aria-hidden="true"
                    />
                  ) : null}
                  {/* "has voted" badge during voting (game-design.md §3.2) — the check IS the
                      signal (never color-only); WHO they voted for stays secret (§4). */}
                  {hasVoted ? (
                    <IconCheck
                      data-testid="has-voted"
                      className="absolute -bottom-1 -right-1 h-4 w-4 rounded-full bg-paper text-success"
                      aria-hidden="true"
                    />
                  ) : null}
                </div>
                <span className="flex items-center gap-1 font-ui text-[15px] font-bold">
                  {isCurrentTurn ? (
                    <IconPencil
                      data-testid="current-turn-pencil"
                      className="h-3 w-3 text-highlight"
                      aria-hidden="true"
                    />
                  ) : null}
                  {player.name}
                  {player.isReady ? (
                    <IconCheck className="h-4 w-4 text-success" aria-hidden="true" />
                  ) : null}
                </span>
                {isEliminated && player.role ? (
                  <span className="rounded-lg bg-ink px-2 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-white">
                    {copy.reveal.outTag(roleCardTitle(player.role))}
                  </span>
                ) : null}
                {!player.connected ? (
                  <span className="font-ui text-xs">{copy.presence.disconnectedCardMicrotext}</span>
                ) : null}
              </button>
              {/* Report / block / (host, lobby) kick-&-report — a sibling of the
                  card button (a card is itself a button, so this can't nest inside it). Only
                  for OTHER players, never yourself. */}
              {you && player.id !== you.playerId ? (
                <div className="mt-1 flex justify-center">
                  <PlayerModeration
                    playerId={player.id}
                    playerName={player.name}
                    roomCode={snapshot.code}
                    canKick={canKick}
                  />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {snapshot.players.length === 1 ? (
        <p className="text-center font-ui text-sm text-graphite">{copy.rooms.emptyState}</p>
      ) : null}

      <PopDialog
        open={kickTarget !== null}
        onOpenChange={(open) => {
          if (!open) closeDialog();
        }}
        title={copy.rooms.kick.title}
        description={kickTarget ? copy.rooms.kick.description(kickTarget.name) : undefined}
        closeLabel={copy.rooms.kick.cancel}
      >
        {kickError ? (
          <p role="alert" className="font-ui text-sm text-undercover">
            {kickError}
          </p>
        ) : null}
        <div className="flex justify-end gap-3" data-testid="kick-confirm">
          <PopButton type="button" variant="secondary" onClick={closeDialog}>
            {copy.rooms.kick.cancel}
          </PopButton>
          <PopButton
            type="button"
            variant="danger"
            disabled={isKicking}
            onClick={() => {
              void confirmKick();
            }}
          >
            {copy.rooms.kick.confirm}
          </PopButton>
        </div>
      </PopDialog>

      <PopDialog
        open={hostTarget !== null}
        onOpenChange={(open) => {
          if (!open) closeHostDialog();
        }}
        title={copy.presence.makeHost}
        description={hostTarget ? copy.presence.makeHostConfirm(hostTarget.name) : undefined}
        closeLabel={copy.rooms.kick.cancel}
      >
        {hostError ? (
          <p role="alert" className="font-ui text-sm text-undercover">
            {hostError}
          </p>
        ) : null}
        <div className="flex justify-end gap-3" data-testid="make-host-confirm">
          <PopButton type="button" variant="secondary" onClick={closeHostDialog}>
            {copy.rooms.kick.cancel}
          </PopButton>
          <PopButton
            type="button"
            variant="primary"
            disabled={isTransferring}
            onClick={() => {
              void confirmMakeHost();
            }}
          >
            {copy.presence.makeHost}
          </PopButton>
        </div>
      </PopDialog>
    </>
  );
}
