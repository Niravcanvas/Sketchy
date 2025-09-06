/**
 * Drizzle schema — the EXACT DDL shape of arch/data-model.md §1. Column
 * names, defaults, checks, indexes, and uniques all mirror that document
 * one-for-one; if the two ever disagree, data-model.md wins and this file
 * is wrong. This includes `reports` (spec'd in data-model.md §1) plus the
 * `player_blocks` / `moderation_actions` tables and `players.warned_at`/
 * `players.suspended_at` columns, all documented in that same section.
 *
 * Managed by drizzle-kit migrations in `apps/api/drizzle/` — this file is
 * never applied directly (system-design.md §3: migrations are committed
 * files, applied by `db:migrate`, never auto-applied by the app at boot).
 */
import type { AvatarConfig, GameSettings } from '@sketchy/engine/types';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// --- Enums (data-model.md §1) ---
export const gameModeEnum = pgEnum('game_mode', ['pass_play', 'online_private', 'online_public']);
export const baseRoleEnum = pgEnum('base_role', ['civilian', 'undercover', 'mrwhite']);
export const factionEnum = pgEnum('faction', ['civilian', 'undercover', 'mrwhite', 'infiltrators']);
export const difficultyEnum = pgEnum('difficulty', ['easy', 'medium', 'hard']);
export const packVisibilityEnum = pgEnum('pack_visibility', ['private', 'unlisted', 'public']);
export const pairStatusEnum = pgEnum('pair_status', ['active', 'pending_review', 'rejected']);
// PACK-level moderation status, distinct from the PAIR-level `pair_status` above:
// a public pack must be admin-approved before strangers can see or use it. Kept a
// separate enum (not overloaded onto `pair_status`) because it answers a different
// question ("is this whole pack cleared for the public catalog?") than the per-word-pair
// review state does.
export const packReviewStatusEnum = pgEnum('pack_review_status', ['pending', 'approved', 'rejected']);

/**
 * Case-insensitive text (Postgres `citext` extension). The generated
 * migration must `CREATE EXTENSION IF NOT EXISTS citext;` — drizzle-kit
 * doesn't know about extensions for custom types, so that statement is
 * hand-added at the top of the migration SQL file (pinned decision).
 */
const citext = customType<{ data: string }>({
  dataType() {
    return 'citext';
  },
});

/**
 * Players: guest-first identity (system-design.md §6). `email` stays NULL
 * until account linking.
 */
export const players = pgTable(
  'players',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    displayName: text('display_name').notNull(),
    avatar: jsonb('avatar').notNull().default({}).$type<AvatarConfig>(),
    isGuest: boolean('is_guest').notNull().default(true),
    email: citext('email').unique(),
    // Denormalized lifetime stats, updated transactionally at game persistence.
    totalPoints: integer('total_points').notNull().default(0),
    gamesPlayed: integer('games_played').notNull().default(0),
    gamesWon: integer('games_won').notNull().default(0),
    // Moderation flags (data-model.md §1). Both NULL by default; a
    // timestamp records WHEN the flag was set. `warned_at` is a soft flag (a
    // recorded warning, no gameplay effect); `suspended_at` hard-blocks the
    // player at every auth boundary (REST + socket handshake) with a sanitized
    // `suspended` error (routes reject; the fast path is a Redis `mod:suspended`
    // set rehydrated from this column on boot — moderation/suspension.ts).
    warnedAt: timestamp('warned_at', { withTimezone: true }),
    suspendedAt: timestamp('suspended_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('players_display_name_length', sql`char_length(${table.displayName}) BETWEEN 2 AND 20`),
  ],
);

/**
 * Word packs: category is a PACK property; difficulty is a PAIR property.
 * Official content ships as one pack per category — `slug` is set only for
 * those; user packs leave it NULL.
 */
export const wordPacks = pgTable(
  'word_packs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').unique(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    category: text('category').notNull().default('custom'),
    language: text('language').notNull().default('en'),
    isOfficial: boolean('is_official').notNull().default(false),
    ownerId: uuid('owner_id').references(() => players.id, { onDelete: 'cascade' }),
    visibility: packVisibilityEnum('visibility').notNull().default('private'),
    // Public-catalog moderation state. A `visibility:'public'` pack is visible/usable to
    // non-owners only when this is `'approved'` — but going public is self-service and
    // takes effect immediately: the PATCH handler sets `'approved'` in the same step, so a
    // public pack is instantly live. This column and the admin `approve_pack` action are
    // DORMANT infrastructure for a future review gate (enable it by making PATCH→public set
    // `'pending'` instead of `'approved'`). `'pending'` default is harmless for private/
    // unlisted packs, which never consult this column.
    reviewStatus: packReviewStatusEnum('review_status').notNull().default('pending'),
    shareCode: text('share_code').unique(),
    coverUrl: text('cover_url'),
    pairCount: integer('pair_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('word_packs_name_length', sql`char_length(${table.name}) BETWEEN 2 AND 40`),
    check('word_packs_official_owner', sql`${table.isOfficial} = (${table.ownerId} IS NULL)`),
  ],
);

/**
 * Word pairs: symmetric (a/b) — the ENGINE flips a coin for which side
 * Civilians get (data-model.md §1 notes).
 */
export const wordPairs = pgTable(
  'word_pairs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    packId: uuid('pack_id')
      .notNull()
      .references(() => wordPacks.id, { onDelete: 'cascade' }),
    wordA: text('word_a').notNull(),
    wordB: text('word_b').notNull(),
    difficulty: difficultyEnum('difficulty').notNull().default('medium'),
    status: pairStatusEnum('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check('word_pairs_word_a_length', sql`char_length(${table.wordA}) BETWEEN 1 AND 40`),
    check('word_pairs_word_b_length', sql`char_length(${table.wordB}) BETWEEN 1 AND 40`),
    uniqueIndex('word_pairs_pack_word_a_word_b_key').on(table.packId, table.wordA, table.wordB),
    index('idx_pairs_pack')
      .on(table.packId)
      .where(sql`${table.status} = 'active'`),
  ],
);

/**
 * Pack access grants (data-model.md §1): `POST /packs/import` records
 * one row here per (pack, player) — "grants read-access, does not copy"
 * (api-contract.md §1). This is what makes an imported `unlisted` pack show up
 * in the importer's own pack list and pass the visibility/leak-guard gates
 * (`routes/pack-access.ts`) without duplicating any pair data. Deleting either
 * side (pack or player) cascades the grant away.
 */
export const packAccess = pgTable(
  'pack_access',
  {
    packId: uuid('pack_id')
      .notNull()
      .references(() => wordPacks.id, { onDelete: 'cascade' }),
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.packId, table.playerId] }),
    index('idx_pack_access_player').on(table.playerId),
  ],
);

/**
 * Games: ONLINE games only — pass-and-play is fully client-side and never
 * persisted server-side (data-model.md §1 notes).
 */
export const games = pgTable(
  'games',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    roomCode: text('room_code').notNull(),
    mode: gameModeEnum('mode').notNull(),
    hostPlayerId: uuid('host_player_id').references(() => players.id, { onDelete: 'set null' }),
    settings: jsonb('settings').notNull().$type<GameSettings>(),
    pairId: uuid('pair_id').references(() => wordPairs.id, { onDelete: 'set null' }),
    civilianWord: text('civilian_word').notNull(),
    undercoverWord: text('undercover_word').notNull(),
    roundsPlayed: integer('rounds_played').notNull().default(0),
    winnerFaction: factionEnum('winner_faction'),
    summary: jsonb('summary').$type<Record<string, unknown>>(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
  },
  (table) => [
    index('idx_games_room').on(table.roomCode, table.startedAt.desc()),
    index('idx_games_started').on(table.startedAt.desc()),
  ],
);

/** Per-player-per-game results — the scoring & history backbone. */
export const gamePlayers = pgTable(
  'game_players',
  {
    gameId: uuid('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    seat: integer('seat').notNull(),
    role: baseRoleEnum('role').notNull(),
    specialRole: text('special_role'),
    word: text('word'),
    eliminatedRound: integer('eliminated_round'),
    won: boolean('won').notNull().default(false),
    points: integer('points').notNull().default(0),
    wasHost: boolean('was_host').notNull().default(false),
  },
  (table) => [
    primaryKey({ columns: [table.gameId, table.playerId] }),
    index('idx_gp_player').on(table.playerId, table.gameId),
  ],
);

/**
 * Player reports (data-model.md §1). `reason` is enum-ish text
 * (`'name' | 'chat' | 'clue' | 'other'`, validated by the Zod `reportReason`
 * at the route); `status` walks `'open' → 'actioned' | 'dismissed'`. `context`
 * is an ADDITIVE column beyond the doc's original 8 columns: the
 * server-captured recent chat/clue lines from the reported room ("recent-context
 * capture"), stored so the admin queue can show what was
 * said WITHOUT the untrusted client ever supplying it. Documented in
 * data-model.md §1 in the same change.
 */
export const reports = pgTable(
  'reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    reporterId: uuid('reporter_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    reportedId: uuid('reported_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    roomCode: text('room_code'),
    reason: text('reason').notNull(),
    detail: text('detail').notNull().default(''),
    status: text('status').notNull().default('open'),
    context: jsonb('context').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // The admin queue reads open reports newest-first; a partial-ish composite
    // index keeps that list cheap as the table grows.
    index('idx_reports_status_created').on(table.status, table.createdAt.desc()),
  ],
);

/**
 * Per-player block list. Directional in
 * storage (`blocker` → `blocked`), symmetric in matchmaking effect: the matcher
 * never seats two players together if EITHER has blocked the other. Deleting
 * either player cascades the row away. Composite PK makes a block idempotent;
 * `idx_player_blocks_blocked` lets the matcher look up "who blocked me" cheaply.
 */
export const playerBlocks = pgTable(
  'player_blocks',
  {
    blockerId: uuid('blocker_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    blockedId: uuid('blocked_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.blockerId, table.blockedId] }),
    index('idx_player_blocks_blocked').on(table.blockedId),
  ],
);

/**
 * Moderation action log — one row per admin action taken from the reports queue
 * (dismiss/warn/suspend/retire_pack). The admin surface is token-gated with no
 * player identity, so there is no `admin_id` — the row records only WHAT was
 * done to WHOM/WHAT. Foreign keys `set null` on delete so the audit trail
 * survives the deletion of a report/player/pack it referenced.
 */
export const moderationActions = pgTable(
  'moderation_actions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    action: text('action').notNull(),
    reportId: uuid('report_id').references(() => reports.id, { onDelete: 'set null' }),
    targetPlayerId: uuid('target_player_id').references(() => players.id, { onDelete: 'set null' }),
    packId: uuid('pack_id').references(() => wordPacks.id, { onDelete: 'set null' }),
    detail: text('detail').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('idx_mod_actions_created').on(table.createdAt.desc())],
);
