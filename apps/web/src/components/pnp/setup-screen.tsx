'use client';

import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  PAIRED_SPECIAL_ROLES,
  ROOM_WIDE_SPECIAL_ROLES,
  SPECIAL_ROLE_MIN_PLAYERS,
} from '@sketchy/engine/constants';
import type { Difficulty, SpecialRole } from '@sketchy/engine/types';
import { IconArrowRight } from '@/components/icons/icon-arrow-right';
import { IconCross } from '@/components/icons/icon-cross';
import { PopButton } from '@/components/pop/pop-button';
import { PopCard } from '@/components/pop/pop-card';
import { PopInput } from '@/components/pop/pop-input';
import { copy } from '@/copy';
import { apiClient } from '@/lib/api-client';
import { bundledPairPool, fetchPairPool, type PairPool } from '@/lib/pair-pool';
import { usePnpStore } from '@/stores/pnp-store';

/** Mirrors the engine's `MIN_PLAYERS` (packages/engine/src/constants.ts) — `start` rejects
 * below this, so the CTA disables at the same threshold rather than dispatching a doomed
 * action. */
const MIN_PLAYERS_TO_START = 3;
const PLAYER_COUNT_WARNING_THRESHOLD = 4;
const ALL_DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];

/** Toggle cards for special roles, in copy.md §3.2 table order — mirrors
 * `room/settings-drawer.tsx`'s SPICE_ROLES (settings UI has no single shared component
 * between online/pnp, same as `RoleStepper` below). */
const SPICE_ROLES: Array<{
  role: SpecialRole;
  label: string;
  description: string;
}> = [
  {
    role: 'judge',
    label: copy.roles.special.judge.toggleLabel,
    description: copy.roles.special.judge.description,
  },
  {
    role: 'ghost',
    label: copy.roles.special.ghost.toggleLabel,
    description: copy.roles.special.ghost.description,
  },
  {
    role: 'jester',
    label: copy.roles.special.jester.toggleLabel,
    description: copy.roles.special.jester.description,
  },
  {
    role: 'lovebirds',
    label: copy.roles.special.lovebirds.toggleLabel,
    description: copy.roles.special.lovebirds.description,
  },
  {
    role: 'grudge',
    label: copy.roles.special.grudge.toggleLabel,
    description: copy.roles.special.grudge.description,
  },
  {
    role: 'mirror',
    label: copy.roles.special.mirror.toggleLabel,
    description: copy.roles.special.mirror.description,
  },
  {
    role: 'rivals',
    label: copy.roles.special.rivals.toggleLabel,
    description: copy.roles.special.rivals.description,
  },
  {
    role: 'mime',
    label: copy.roles.special.mime.toggleLabel,
    description: copy.roles.special.mime.description,
  },
];

/** Mirrors `room/settings-drawer.tsx`'s identical helper — how many holder
 * "slots" one role costs toward the `floor(maxPlayers / 2)` total-slot budget. */
function specialRoleSlotCost(role: SpecialRole): number {
  if (ROOM_WIDE_SPECIAL_ROLES.has(role)) return 0;
  if (PAIRED_SPECIAL_ROLES.has(role)) return 2;
  return 1;
}

/**
 * Locale-neutral math glyphs for the role steppers. Not routed through copy.ts: they're
 * operators, not translatable microcopy (conventions.md §4's "no string literals in JSX"
 * targets user-facing text; module-level constants referenced via identifiers also satisfy
 * the underlying `react/jsx-no-literals` check, same mechanism `copy.ts` itself relies on).
 */
const STEP_DECREMENT = '−';
const STEP_INCREMENT = '+';

/**
 * Pass-and-play setup (`/play`, game-design.md §4.1): the lobby-phase host screen. Reads
 * and writes exclusively through `usePnpStore` — every edit here is a real engine action
 * (`join`/`leave`/`updateSettings`), so validation (dupe names, room-full, role math) is
 * engine-owned. Assumes the router already called `initLobby()` before mounting this.
 */
export function PnpSetupScreen() {
  const game = usePnpStore((s) => s.game);
  const error = usePnpStore((s) => s.error);
  const addPlayer = usePnpStore((s) => s.addPlayer);
  const removePlayer = usePnpStore((s) => s.removePlayer);
  const setRoleCounts = usePnpStore((s) => s.setRoleCounts);
  const setPackSelection = usePnpStore((s) => s.setPackSelection);
  const setDifficulties = usePnpStore((s) => s.setDifficulties);
  const setSpecialRoles = usePnpStore((s) => s.setSpecialRoles);
  const prefs = usePnpStore((s) => s.prefs);
  const setTypedClues = usePnpStore((s) => s.setTypedClues);
  const setOpenVote = usePnpStore((s) => s.setOpenVote);
  const startGame = usePnpStore((s) => s.startGame);

  const [nameInput, setNameInput] = useState('');
  const [lastAttemptedName, setLastAttemptedName] = useState('');
  const [isStarting, setIsStarting] = useState(false);
  const [poolFetchFailed, setPoolFetchFailed] = useState(false);
  const [emptyPoolBlocked, setEmptyPoolBlocked] = useState(false);

  // No filter: `GET /packs`'s default gate is official ∪ owned ∪ imported
  // (routes/pack-access.ts), so pass-and-play setup lists the local player's own/imported
  // packs alongside the official catalog without a second query.
  const packsQuery = useQuery({
    queryKey: ['packs', 'mine-and-official'],
    queryFn: () => apiClient.listPacks(),
  });

  if (!game) return null;

  const offline = packsQuery.isError || poolFetchFailed;
  const { packIds, difficulties, undercoverCount, mrWhiteCount, specialRoles, maxPlayers } =
    game.settings;

  const toggleSpecialRole = (role: SpecialRole): void => {
    const selected = specialRoles.includes(role);
    const next = selected ? specialRoles.filter((r) => r !== role) : [...specialRoles, role];
    setSpecialRoles(next);
  };

  const handleAddPlayer = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const trimmed = nameInput.trim();
    if (!trimmed) return;
    setLastAttemptedName(trimmed);
    addPlayer(trimmed);
    if (!usePnpStore.getState().error) setNameInput('');
  };

  const toggleDifficulty = (difficulty: Difficulty): void => {
    const selected = difficulties.includes(difficulty);
    // Never let the last chip go dark — an empty `difficulties` is engine-rejected anyway
    // (isValidSettingsForLobby), and that rejection would surface as the SAME 'validation'
    // code the role steppers use, misattributing the inline error to the wrong control.
    if (selected && difficulties.length === 1) return;
    const next = selected
      ? difficulties.filter((value) => value !== difficulty)
      : [...difficulties, difficulty];
    setDifficulties(next);
  };

  const togglePack = (packId: string): void => {
    const selected = packIds.includes(packId);
    const next = selected ? packIds.filter((id) => id !== packId) : [...packIds, packId];
    setPackSelection(next);
  };

  const handleStart = async (): Promise<void> => {
    if (game.players.length < MIN_PLAYERS_TO_START || isStarting) return;
    setIsStarting(true);
    try {
      let pool: PairPool;
      if (packsQuery.isSuccess && packIds.length > 0) {
        try {
          pool = await fetchPairPool(apiClient, packIds, difficulties);
        } catch {
          setPoolFetchFailed(true);
          pool = bundledPairPool(difficulties);
        }
      } else {
        pool = bundledPairPool(difficulties);
      }
      setEmptyPoolBlocked(pool.length === 0);
      if (pool.length === 0) return;
      startGame(pool);
    } finally {
      setIsStarting(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-8 bg-paper px-6 py-12">
      <h1 className="text-center font-display text-2xl uppercase tracking-wide text-ink">
        {copy.pnp.setup.title}
      </h1>

      <PopCard className="flex flex-col gap-4">
        <form onSubmit={handleAddPlayer} className="flex items-end gap-3">
          <div className="flex-1">
            <PopInput
              label={copy.pnp.setup.addPlayerPlaceholder}
              placeholder={copy.pnp.setup.addPlayerPlaceholder}
              value={nameInput}
              onChange={(event) => setNameInput(event.target.value)}
              maxLength={20}
              data-testid="pnp-name-input"
            />
          </div>
          <PopButton
            type="submit"
            variant="primary"
            aria-label={copy.pnp.setup.addPlayerPlaceholder}
            data-testid="pnp-add-name"
          >
            <IconArrowRight className="h-4 w-4" />
          </PopButton>
        </form>

        {error === 'name_taken_in_room' ? (
          <p role="alert" className="font-ui text-sm text-undercover">
            {copy.errors.nameTakenInRoom(lastAttemptedName)}
          </p>
        ) : null}
        {error === 'room_full' ? (
          <p role="alert" className="font-ui text-sm text-undercover">
            {copy.errors.roomFull(game.settings.maxPlayers)}
          </p>
        ) : null}

        <ul className="flex flex-wrap gap-2">
          {game.players.map((player) => (
            <li
              key={player.id}
              className="flex items-center gap-2 rounded-lg border-3 border-ink bg-paper-2 px-3 py-1 font-ui text-[15px] font-bold text-ink shadow-hard-sm"
            >
              {player.name}
              <button
                type="button"
                aria-label={copy.glossary.delete}
                onClick={() => removePlayer(player.id)}
                className="text-graphite transition-transform duration-150 hover:rotate-12 hover:text-undercover"
              >
                <IconCross className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>

        {game.players.length < PLAYER_COUNT_WARNING_THRESHOLD ? (
          <p className="font-ui text-sm text-graphite">{copy.pnp.setup.playerCountWarning}</p>
        ) : null}
      </PopCard>

      <PopCard className="flex flex-col gap-4">
        <div>
          <h2 className="font-display text-2xl uppercase tracking-wide text-ink">{copy.pnp.packPicker.header}</h2>
          <p className="font-ui text-sm text-graphite">{copy.pnp.packPicker.helper}</p>
        </div>

        {offline ? (
          <p className="font-ui text-sm text-graphite">{copy.pnp.setup.offlinePacks}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {(packsQuery.data?.items ?? []).map((pack) => {
              const selected = packIds.includes(pack.id);
              return (
                <button
                  key={pack.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => togglePack(pack.id)}
                  className={clsx(
                    'rounded-lg border-3 border-ink px-3 py-1 font-ui text-sm font-bold shadow-hard-sm transition-[transform,box-shadow] duration-[80ms] ease-out hover:-translate-y-0.5 active:translate-x-[2px] active:translate-y-[2px] active:shadow-hard-pressed',
                    selected ? 'bg-highlight text-ink' : 'bg-paper-2 text-graphite',
                  )}
                >
                  {pack.name}
                </button>
              );
            })}
          </div>
        )}

        <div className="flex gap-2">
          {ALL_DIFFICULTIES.map((difficulty) => {
            const selected = difficulties.includes(difficulty);
            return (
              <button
                key={difficulty}
                type="button"
                aria-pressed={selected}
                onClick={() => toggleDifficulty(difficulty)}
                className={clsx(
                  'rounded-lg border-3 border-ink px-3 py-1 font-ui text-sm font-bold shadow-hard-sm transition-[transform,box-shadow] duration-[80ms] ease-out hover:-translate-y-0.5 active:translate-x-[2px] active:translate-y-[2px] active:shadow-hard-pressed',
                  selected ? 'bg-highlight text-ink' : 'bg-paper-2 text-graphite',
                )}
              >
                {copy.pnp.difficulty[difficulty]}
              </button>
            );
          })}
        </div>
      </PopCard>

      <PopCard className="flex flex-col gap-4">
        <div>
          <h2 className="font-display text-2xl uppercase tracking-wide text-ink">{copy.pnp.steppers.header}</h2>
          <p className="font-ui text-sm text-graphite">
            {copy.pnp.steppers.helper(game.players.length)}
          </p>
        </div>

        <RoleStepper
          label={copy.roles.undercover.cardTitle}
          value={undercoverCount}
          onDecrement={() => setRoleCounts({ undercoverCount: Math.max(0, undercoverCount - 1) })}
          onIncrement={() => setRoleCounts({ undercoverCount: undercoverCount + 1 })}
        />
        <RoleStepper
          label={copy.roles.mrWhite.cardTitle}
          value={mrWhiteCount}
          onDecrement={() => setRoleCounts({ mrWhiteCount: Math.max(0, mrWhiteCount - 1) })}
          onIncrement={() => setRoleCounts({ mrWhiteCount: mrWhiteCount + 1 })}
        />

        {error === 'validation' ? (
          <p role="alert" className="font-ui text-sm text-undercover">
            {copy.pnp.steppers.roleMathError}
          </p>
        ) : null}
      </PopCard>

      <PopCard className="flex flex-col gap-5">
        <ToggleRow
          id="pnp-setup-typed-clues"
          label={copy.pnp.typedClues.toggleLabel}
          helper={copy.pnp.typedClues.toggleHelper}
          checked={prefs.typedClues}
          onChange={setTypedClues}
        />
        <ToggleRow
          id="pnp-setup-open-vote"
          label={copy.pnp.openVote.toggleLabel}
          helper={copy.pnp.openVote.toggleHelper}
          checked={prefs.openVote}
          onChange={setOpenVote}
        />
      </PopCard>

      <PopCard className="flex flex-col gap-4" data-testid="spice-section">
        <div>
          <h2 className="font-display text-2xl uppercase tracking-wide text-ink">
            {copy.roles.special.sectionHeader}
          </h2>
          <p className="font-ui text-sm text-graphite">{copy.roles.special.sectionHelper}</p>
        </div>
        <div className="flex flex-col gap-3">
          {SPICE_ROLES.map(({ role, label, description }) => {
            const min = SPECIAL_ROLE_MIN_PLAYERS[role];
            const tooFewPlayers = min !== undefined && maxPlayers < min;
            const isEnabled = specialRoles.includes(role);
            // Guardrail (mirrors room/settings-drawer.tsx): proactively grays out
            // a role that would push the total holder-slot budget over
            // floor(maxPlayers / 2) — the engine's `isValidSpecialRoles` remains the
            // enforced check (applyStart re-validates against the actual seated count).
            const usedSlots = specialRoles.reduce((sum, r) => sum + specialRoleSlotCost(r), 0);
            const wouldExceedBudget =
              !isEnabled &&
              usedSlots + specialRoleSlotCost(role) > Math.floor(maxPlayers / 2);
            const disabledReason = tooFewPlayers
              ? copy.roles.special.needsMorePlayers(min as number)
              : wouldExceedBudget
                ? copy.roles.special.tooSpicy
                : undefined;
            return (
              <SpiceToggleRow
                key={role}
                testId={`pnp-spice-${role}`}
                label={label}
                description={description}
                checked={isEnabled}
                disabled={tooFewPlayers || wouldExceedBudget}
                disabledReason={disabledReason}
                onChange={() => toggleSpecialRole(role)}
              />
            );
          })}
        </div>
      </PopCard>

      <PopButton
        type="button"
        variant="primary"
        size="lg"
        className="self-center"
        disabled={game.players.length < MIN_PLAYERS_TO_START || isStarting}
        data-testid="pnp-start"
        onClick={() => {
          void handleStart();
        }}
      >
        {copy.glossary.startGame}
      </PopButton>

      {emptyPoolBlocked ? (
        <p role="alert" className="text-center font-ui text-sm text-undercover">
          {copy.errors.validation}
        </p>
      ) : null}
    </main>
  );
}

interface RoleStepperProps {
  label: string;
  value: number;
  onDecrement: () => void;
  onIncrement: () => void;
}

/** A labelled −/+ counter (native `<button>`s — keyboard-reachable for free). */
function RoleStepper({ label, value, onDecrement, onIncrement }: RoleStepperProps) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="font-ui text-base text-ink">{label}</span>
      <div className="flex items-center gap-3">
        <PopButton
          type="button"
          variant="secondary"
          disabled={value <= 0}
          onClick={onDecrement}
        >
          {STEP_DECREMENT}
        </PopButton>
        <span className="w-8 text-center font-display text-2xl text-ink">{value}</span>
        <PopButton type="button" variant="secondary" onClick={onIncrement}>
          {STEP_INCREMENT}
        </PopButton>
      </div>
    </div>
  );
}

interface ToggleRowProps {
  id: string;
  label: string;
  helper: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}

/** Checkbox + label + helper text — keyboard operable natively (a real `<input>`). */
function ToggleRow({ id, label, helper, checked, onChange }: ToggleRowProps) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="flex items-center gap-3 font-ui text-base text-ink">
        <input
          id={id}
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          className="h-5 w-5 accent-civilian"
        />
        {label}
      </label>
      <p className="pl-8 font-ui text-sm text-graphite">{helper}</p>
    </div>
  );
}

interface SpiceToggleRowProps {
  testId: string;
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  disabledReason?: string;
  onChange: () => void;
}

/** One "Spice (optional roles)" toggle card (game-design.md §4, copy.md §3.2) — mirrors
 * `room/settings-drawer.tsx`'s SpiceToggleRow. Min-player gating grays the row out and
 * shows the reason inline. */
function SpiceToggleRow({
  testId,
  label,
  description,
  checked,
  disabled,
  disabledReason,
  onChange,
}: SpiceToggleRowProps) {
  return (
    <label
      htmlFor={testId}
      className={clsx(
        'flex items-start gap-3 rounded-xl border-3 border-ink bg-paper-2 p-3 shadow-hard-sm',
        disabled ? 'opacity-60' : 'cursor-pointer',
      )}
    >
      <input
        id={testId}
        data-testid={testId}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        className="mt-1 h-5 w-5 accent-civilian"
      />
      <span className="flex flex-col gap-0.5">
        <span className="font-ui text-base font-bold text-ink">{label}</span>
        <span className="font-ui text-sm text-graphite">{description}</span>
        {disabledReason ? (
          <span className="font-ui text-xs font-bold uppercase tracking-[0.08em] text-undercover">
            {disabledReason}
          </span>
        ) : null}
      </span>
    </label>
  );
}
