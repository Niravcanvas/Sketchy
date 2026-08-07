'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useParams } from 'next/navigation';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { normalizeRoomCode, isValidRoomCode } from '@sketchy/shared/room-code';
import { ApiError } from '@sketchy/shared/client';
import type { RoomResolution } from '@sketchy/shared/contract/rooms';
import type { ErrorCode } from '@sketchy/shared/contract/errors';
import { GameScreen } from '@/components/room/game/game-screen';
import { JoinGate } from '@/components/room/join-gate';
import { LobbyScreen } from '@/components/room/lobby-screen';
import { PopCard } from '@/components/pop/pop-card';
import { MuteToggle } from '@/components/sound/mute-toggle';
import { NavBackButton } from '@/components/nav-back-button';
import { copy } from '@/copy';
import { apiClient } from '@/lib/api-client';
import { copyForError } from '@/lib/error-copy';
import { connectToRoom, disconnectFromRoom } from '@/lib/socket';
import { usePhaseSound } from '@/lib/use-phase-sound';
import { disconnectVoice, hasVoiceOptIn, joinVoice } from '@/lib/voice';
import { useRoomStore } from '@/stores/room-store';
import { useSessionStore } from '@/stores/session-store';

type Resolution =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'resolved'; data: RoomResolution };

function resolutionErrorCopy(error: unknown): string {
  // A non-2xx response carries an `ErrorCode` (incl. a moderation `suspended` handshake at
  // this pre-join REST check); the shared table gives every one a real line. A raw `fetch`
  // throw (offline/DNS/CORS) is never an `ApiError`, so it keeps the offline line.
  if (error instanceof ApiError) {
    return copyForError(error.code);
  }
  return copy.errors.networkOffline;
}

function joinErrorCopy(error: ErrorCode, maxPlayers: number | undefined): string {
  // `room_full` is the one code whose real copy needs context only this route holds
  // (`maxPlayers`), so it overrides the shared baseline; everything else — `suspended`,
  // `kicked`, `unauthorized`, … — reads straight from `copyForError` instead of falling to
  // generic-500.
  if (error === 'room_full' && maxPlayers != null) {
    return copy.errors.roomFull(maxPlayers);
  }
  return copyForError(error);
}

/** A friendly full-screen error card (game-design.md §5 "friendly errors... BEFORE any
 * socket connect", api-contract.md §1) — shared by every terminal error state this route
 * can land in (bad code format, REST pre-join rejection, socket join-ack rejection). */
function RoomMessageScreen({ message }: { message: string }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <NavBackButton href="/" />
      <PopCard className="flex flex-col items-center gap-3">
        <p role="alert" className="font-ui text-base text-ink">
          {message}
        </p>
      </PopCard>
    </main>
  );
}

function ConnectingSkeleton() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-4 px-6 bg-paper">
      <div
        aria-hidden="true"
        className="h-40 w-full max-w-sm animate-pulse rounded-xl border border-graphite/30 bg-paper-2"
      />
    </main>
  );
}

function SupersededBanner() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <NavBackButton href="/" />
      <PopCard className="flex flex-col items-center gap-3">
        <p role="alert" aria-live="assertive" className="font-ui text-base text-ink">
          {copy.presence.sessionSuperseded}
        </p>
      </PopCard>
    </main>
  );
}

/**
 * The room route (game-design.md §2 "one route, the phase drives the view"): a client
 * component fed exclusively by socket snapshots (via `room-store`), per conventions.md §1.
 * `phase === 'lobby'` renders `LobbyScreen`; every other phase renders `GameScreen`.
 */
export default function RoomPage() {
  const params = useParams<{ code: string | string[] }>();
  const rawCode = Array.isArray(params.code) ? params.code[0] : params.code;
  const code = normalizeRoomCode(rawCode ?? '');
  const validCode = isValidRoomCode(code);

  const sessionStatus = useSessionStore((state) => state.status);
  const [gatePassed, setGatePassed] = useState(false);
  const [resolution, setResolution] = useState<Resolution>({ kind: 'loading' });

  const roomStatus = useRoomStore((state) => state.status);
  const joinError = useRoomStore((state) => state.joinError);
  const phase = useRoomStore((state) => state.snapshot?.phase ?? null);

  // Phase-transition sound — page-turn/reveal-sting/win-horn,
  // never gameplay-critical (game-design.md §1 pillar 1). Watching `phase` here (rather than
  // inside `GameScreen`) also catches the lobby → dealing transition, which unmounts
  // `LobbyScreen` and mounts `GameScreen` rather than re-rendering a shared component.
  usePhaseSound(phase);

  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false, staleTime: 5 * 60_000, refetchOnWindowFocus: false },
        },
      }),
  );

  // Pre-join REST check (api-contract.md §1 `GET /rooms/:code`) — only runs once the code
  // is well-formed AND the join gate has been passed (game-design.md §5: avatar picker rides
  // the gate, then the REST check, then the socket connect — in that order). This effect
  // fires exactly once in practice (`gatePassed` only ever flips false → true), so the
  // already-`'loading'` initial state covers the "fetch in flight" render — no synchronous
  // `setState` at the top of the effect body (react-hooks/set-state-in-effect).
  useEffect(() => {
    if (!validCode || !gatePassed) return;
    let cancelled = false;
    apiClient
      .getRoom(code)
      .then((data) => {
        if (!cancelled) setResolution({ kind: 'resolved', data });
      })
      .catch((caught: unknown) => {
        if (!cancelled) setResolution({ kind: 'error', message: resolutionErrorCopy(caught) });
      });
    return () => {
      cancelled = true;
    };
  }, [validCode, gatePassed, code]);

  const shouldConnect =
    resolution.kind === 'resolved' && (resolution.data.canJoin || resolution.data.canRejoin);

  // Socket connect only after the pre-join check clears (api-contract.md §1); torn down on
  // unmount or whenever this room stops being the one we should be connected to. Voice
  // rides the same lifecycle: it can only ever be joined once the game socket
  // itself is connected (the voice-token endpoint requires a seated member), and it must
  // never outlive the game connection.
  useEffect(() => {
    if (!shouldConnect) return;
    connectToRoom(code);
    return () => {
      disconnectFromRoom();
      disconnectVoice();
    };
  }, [shouldConnect, code]);

  // Voice auto-rejoin (game-design.md §10): only if the player
  // opted in on a previous visit — never on a first-time entry, and never blocking anything
  // else on this screen. Re-fires on every reconnect (`roomStatus` cycling back to
  // 'connected'); `joinVoice` itself is a no-op once already connected to this room's voice.
  useEffect(() => {
    if (roomStatus === 'connected' && hasVoiceOptIn()) {
      void joinVoice(code);
    }
  }, [roomStatus, code]);

  const maxPlayersForError = useMemo(
    () => (resolution.kind === 'resolved' ? resolution.data.maxPlayers : undefined),
    [resolution],
  );

  if (!validCode) {
    return <RoomMessageScreen message={copy.errors.roomNotFound} />;
  }

  if (sessionStatus === 'loading') {
    return null;
  }

  let content: ReactNode;
  if (!gatePassed) {
    content = <JoinGate code={code} onReady={() => setGatePassed(true)} />;
  } else if (resolution.kind === 'loading') {
    content = <ConnectingSkeleton />;
  } else if (resolution.kind === 'error') {
    content = <RoomMessageScreen message={resolution.message} />;
  } else if (!resolution.data.canJoin && !resolution.data.canRejoin) {
    const message =
      resolution.data.phase !== 'lobby'
        ? copy.errors.roomInProgress
        : copy.errors.roomFull(resolution.data.maxPlayers);
    content = <RoomMessageScreen message={message} />;
  } else if (roomStatus === 'connecting' || roomStatus === 'idle') {
    // Store status ordering (this phase's pinned render priority): connecting skeleton,
    // then superseded, then joinError, then the connected view. `'connecting'`/`'idle'`
    // only ever precede a snapshot (connectToRoom resets the store before dialing), so this
    // never masks an existing lobby/game view.
    content = <ConnectingSkeleton />;
  } else if (roomStatus === 'superseded') {
    content = <SupersededBanner />;
  } else if (joinError) {
    content = <RoomMessageScreen message={joinErrorCopy(joinError, maxPlayersForError)} />;
  } else if (phase === 'lobby') {
    content = <LobbyScreen />;
  } else if (phase !== null) {
    content = <GameScreen />;
  } else {
    content = <ConnectingSkeleton />;
  }

  return (
    <QueryClientProvider client={queryClient}>
      {/* Sound only ever plays once a lobby/game snapshot exists — the toggle only needs to
          be on screen from that point on, not during the pre-join gate/loading/error states. */}
      {phase !== null ? <MuteToggle /> : null}
      {content}
    </QueryClientProvider>
  );
}
