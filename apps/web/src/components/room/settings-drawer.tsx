'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  PAIRED_SPECIAL_ROLES,
  ROOM_WIDE_SPECIAL_ROLES,
  SPECIAL_ROLE_MIN_PLAYERS,
} from '@sketchy/engine/constants';
import type { Difficulty, SpecialRole } from '@sketchy/engine/types';
import { suggestRoleCounts } from '@sketchy/engine/suggest-role-counts';
import type { LobbySettingsPayload } from '@sketchy/shared/contract/socket';
import { PopButton } from '@/components/pop/pop-button';
import { PopCard } from '@/components/pop/pop-card';
import { copy } from '@/copy';
import { apiClient } from '@/lib/api-client';
import { copyForError } from '@/lib/error-copy';
import { emitSettings } from '@/lib/socket';
import { useRoomStore } from '@/stores/room-store';

const ALL_DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];
const STEP_DECREMENT = '−';
const STEP_INCREMENT = '+';

/** Toggle cards for special roles, in copy.md §3.2 table order. */
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

/** How many holder "slots" one role costs toward the `floor(maxPlayers / 2)`
 * total-slot budget (`reducers/shared.ts` `isValidSpecialRoles`, mirrored client-side here
 * so the toggle grays out BEFORE a submit round-trips a rejection — the engine's own check
 * is still the enforced source of truth; this is purely a proactive UX). */
function specialRoleSlotCost(role: SpecialRole): number {
  if (ROOM_WIDE_SPECIAL_ROLES.has(role)) return 0;
  if (PAIRED_SPECIAL_ROLES.has(role)) return 2;
  return 1;
}

interface TimerPreset {
  testId: string;
  label: string;
  clueTimerSec: number | null;
  discussionTimerSec: number | null;
  voteTimerSec: number | null;
}

/** PINNED (copy.md §4 "The clock") — the three timer presets, in the exact
 * clue/discussion/vote second counts the phase brief specifies. */
const TIMER_PRESETS: TimerPreset[] = [
  {
    testId: 'preset-untimed',
    label: copy.rooms.timers.presetUntimed,
    clueTimerSec: null,
    discussionTimerSec: null,
    voteTimerSec: null,
  },
  {
    testId: 'preset-standard',
    label: copy.rooms.timers.presetStandard,
    clueTimerSec: 60,
    discussionTimerSec: 120,
    voteTimerSec: 45,
  },
  {
    testId: 'preset-speedy',
    label: copy.rooms.timers.presetSpeedy,
    clueTimerSec: 30,
    discussionTimerSec: 60,
    voteTimerSec: 30,
  },
];

/**
 * Host: editable. Non-host: read-only live values (visibly disabled controls, same layout —
 * game-design.md §5 "non-hosts see settings read-only, live"). Every control change emits a
 * `lobby:settings` patch and waits for the next snapshot to reflect it (api-contract.md §2.3
 * rule 4 — optimistic UI is only for the actor's own pending action, and there isn't one
 * worth faking here); on a rejected ack the UI simply stays exactly as the last snapshot left
 * it (nothing to roll back) and shows the mapped copy.md §9 line.
 */
export function SettingsDrawer() {
  const snapshot = useRoomStore((state) => state.snapshot);
  const you = useRoomStore((state) => state.you);
  const [error, setError] = useState<string | null>(null);

  // No filter: `GET /packs`'s default gate is official ∪ owned ∪ imported
  // (routes/pack-access.ts), so the host's lobby picker lists their own/imported packs
  // alongside the official catalog without a second query.
  const packsQuery = useQuery({
    queryKey: ['packs', 'mine-and-official'],
    queryFn: () => apiClient.listPacks(),
  });

  if (!snapshot) {
    return null;
  }

  const isHost = snapshot.hostId === you?.playerId;
  const {
    packIds,
    difficulties,
    undercoverCount,
    mrWhiteCount,
    clueTimerSec,
    discussionTimerSec,
    voteTimerSec,
    specialRoles,
    maxPlayers,
  } = snapshot.settings;
  const suggestion = suggestRoleCounts(snapshot.players.length);

  async function applyPatch(patch: LobbySettingsPayload): Promise<void> {
    if (!isHost) return;
    setError(null);
    const ack = await emitSettings(patch);
    if (!ack.ok) {
      setError(copyForError(ack.error));
    }
  }

  function togglePack(packId: string): void {
    const selected = packIds.includes(packId);
    const next = selected ? packIds.filter((id) => id !== packId) : [...packIds, packId];
    void applyPatch({ packIds: next });
  }

  function toggleSpecialRole(role: SpecialRole): void {
    const selected = specialRoles.includes(role);
    const next = selected ? specialRoles.filter((r) => r !== role) : [...specialRoles, role];
    void applyPatch({ specialRoles: next });
  }

  function toggleDifficulty(difficulty: Difficulty): void {
    const selected = difficulties.includes(difficulty);
    if (selected && difficulties.length === 1) return;
    const next = selected
      ? difficulties.filter((value) => value !== difficulty)
      : [...difficulties, difficulty];
    void applyPatch({ difficulties: next });
  }

  const matchingPreset = TIMER_PRESETS.find(
    (preset) =>
      preset.clueTimerSec === clueTimerSec &&
      preset.discussionTimerSec === discussionTimerSec &&
      preset.voteTimerSec === voteTimerSec,
  );

  return (
    <PopCard
      data-testid="settings-drawer"
      className="flex flex-col gap-6"
    >
      <section className="flex flex-col gap-3">
        <div>
          <h2 className="font-display text-2xl uppercase tracking-wide text-ink">{copy.pnp.packPicker.header}</h2>
          <p className="font-ui text-sm text-graphite">{copy.pnp.packPicker.helper}</p>
        </div>
        {packsQuery.isError ? (
          <p className="font-ui text-sm text-graphite">{copy.pnp.setup.offlinePacks}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {(packsQuery.data?.items ?? []).map((pack) => {
              const selected = packIds.includes(pack.id);
              return (
                <button
                  key={pack.id}
                  type="button"
                  disabled={!isHost}
                  aria-pressed={selected}
                  onClick={() => togglePack(pack.id)}
                  className={clsx(
                    'rounded-lg border-3 border-ink px-3 py-1 font-ui text-sm font-bold shadow-hard-sm transition-[transform,box-shadow] duration-[80ms] ease-out active:translate-x-[2px] active:translate-y-[2px] active:shadow-hard-pressed',
                    isHost && 'hover:-translate-y-0.5',
                    selected ? 'bg-highlight text-ink' : 'bg-paper-2 text-graphite',
                  )}
                >
                  {pack.name}
                </button>
              );
            })}
          </div>
        )}
      </section>

      <section className="flex gap-2">
        {ALL_DIFFICULTIES.map((difficulty) => {
          const selected = difficulties.includes(difficulty);
          return (
            <button
              key={difficulty}
              type="button"
              disabled={!isHost}
              aria-pressed={selected}
              onClick={() => toggleDifficulty(difficulty)}
              className={clsx(
                'rounded-lg border-3 border-ink px-3 py-1 font-ui text-sm font-bold shadow-hard-sm transition-[transform,box-shadow] duration-[80ms] ease-out active:translate-x-[2px] active:translate-y-[2px] active:shadow-hard-pressed',
                isHost && 'hover:-translate-y-0.5',
                selected ? 'bg-highlight text-ink' : 'bg-paper-2 text-graphite',
              )}
            >
              {copy.pnp.difficulty[difficulty]}
            </button>
          );
        })}
      </section>

      <section className="flex flex-col gap-4">
        <div>
          <h2 className="font-display text-2xl uppercase tracking-wide text-ink">{copy.pnp.steppers.header}</h2>
          <p className="font-ui text-sm text-graphite">
            {copy.pnp.steppers.helper(snapshot.players.length)}
          </p>
        </div>
        <RoleStepper
          label={copy.roles.undercover.cardTitle}
          value={undercoverCount}
          suggestion={suggestion.undercoverCount}
          disabled={!isHost}
          onDecrement={() => void applyPatch({ undercoverCount: Math.max(0, undercoverCount - 1) })}
          onIncrement={() => void applyPatch({ undercoverCount: undercoverCount + 1 })}
        />
        <RoleStepper
          label={copy.roles.mrWhite.cardTitle}
          value={mrWhiteCount}
          suggestion={suggestion.mrWhiteCount}
          disabled={!isHost}
          onDecrement={() => void applyPatch({ mrWhiteCount: Math.max(0, mrWhiteCount - 1) })}
          onIncrement={() => void applyPatch({ mrWhiteCount: mrWhiteCount + 1 })}
        />
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="font-display text-2xl uppercase tracking-wide text-ink">{copy.rooms.timers.header}</h2>
          <p className="font-ui text-sm text-graphite">{copy.rooms.timers.helper}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {TIMER_PRESETS.map((preset) => {
            const selected = matchingPreset?.testId === preset.testId;
            return (
              <PopButton
                key={preset.testId}
                type="button"
                variant={selected ? 'primary' : 'secondary'}
                disabled={!isHost}
                aria-pressed={selected}
                data-testid={preset.testId}
                onClick={() =>
                  void applyPatch({
                    clueTimerSec: preset.clueTimerSec,
                    discussionTimerSec: preset.discussionTimerSec,
                    voteTimerSec: preset.voteTimerSec,
                  })
                }
              >
                {preset.label}
              </PopButton>
            );
          })}
        </div>
      </section>

      <section className="flex flex-col gap-3" data-testid="spice-section">
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
            // Guardrail: don't let the host turn ON a role that would push the
            // total holder-slot budget over floor(maxPlayers / 2) — the engine's
            // `isValidSpecialRoles` is still the enforced check; this just avoids a
            // round-trip rejection for the common case. Never blocks TURNING OFF a role.
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
                testId={`spice-${role}`}
                label={label}
                description={description}
                checked={isEnabled}
                disabled={!isHost || tooFewPlayers || wouldExceedBudget}
                disabledReason={disabledReason}
                onChange={() => toggleSpecialRole(role)}
              />
            );
          })}
        </div>
      </section>

      {error ? (
        <p role="alert" className="font-ui text-sm text-undercover">
          {error}
        </p>
      ) : null}
    </PopCard>
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

/** One "Spice (optional roles)" toggle card (game-design.md §5, copy.md §3.2). Which roles
 * are ON is public — every player sees this same drawer, host editable, everyone else
 * read-only (this file's own doc comment) — so the toggle state IS the "enabled-role chip"
 * the phase asked for; no separate chip display is needed. Min-player gating grays the row
 * out and shows the reason inline, same visual language as the disabled role steppers. */
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

interface RoleStepperProps {
  label: string;
  value: number;
  suggestion: number;
  disabled: boolean;
  onDecrement: () => void;
  onIncrement: () => void;
}

/** A labelled −/+ counter, disabled entirely for non-hosts (still shows the live value). The
 * engine's suggestion for the current player count renders as a small aside — the actual
 * value always comes from `snapshot.settings` (game-design.md §5 / this file's doc comment). */
function RoleStepper({ label, value, suggestion, disabled, onDecrement, onIncrement }: RoleStepperProps) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="font-ui text-base text-ink">
        {label}
        {suggestion !== value ? (
          <span className="pl-2 font-ui text-xs text-graphite">{`(${suggestion})`}</span>
        ) : null}
      </span>
      <div className="flex items-center gap-3">
        <PopButton
          type="button"
          variant="secondary"
          disabled={disabled || value <= 0}
          onClick={onDecrement}
        >
          {STEP_DECREMENT}
        </PopButton>
        <span className="w-8 text-center font-display text-2xl text-ink">{value}</span>
        <PopButton type="button" variant="secondary" disabled={disabled} onClick={onIncrement}>
          {STEP_INCREMENT}
        </PopButton>
      </div>
    </div>
  );
}
