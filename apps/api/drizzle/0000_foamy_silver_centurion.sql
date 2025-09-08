-- Hand-added (pinned decision, phase 3): drizzle-kit doesn't know about
-- Postgres extensions for custom types, so `players.email`'s `citext` type
-- (arch/data-model.md §1) needs this created before it's referenced below.
CREATE EXTENSION IF NOT EXISTS citext;--> statement-breakpoint
CREATE TYPE "public"."base_role" AS ENUM('civilian', 'undercover', 'mrwhite');--> statement-breakpoint
CREATE TYPE "public"."difficulty" AS ENUM('easy', 'medium', 'hard');--> statement-breakpoint
CREATE TYPE "public"."faction" AS ENUM('civilian', 'undercover', 'mrwhite', 'infiltrators');--> statement-breakpoint
CREATE TYPE "public"."game_mode" AS ENUM('pass_play', 'online_private', 'online_public');--> statement-breakpoint
CREATE TYPE "public"."pack_visibility" AS ENUM('private', 'unlisted', 'public');--> statement-breakpoint
CREATE TYPE "public"."pair_status" AS ENUM('active', 'pending_review', 'rejected');--> statement-breakpoint
CREATE TABLE "game_players" (
	"game_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"seat" integer NOT NULL,
	"role" "base_role" NOT NULL,
	"special_role" text,
	"word" text,
	"eliminated_round" integer,
	"won" boolean DEFAULT false NOT NULL,
	"points" integer DEFAULT 0 NOT NULL,
	"was_host" boolean DEFAULT false NOT NULL,
	CONSTRAINT "game_players_game_id_player_id_pk" PRIMARY KEY("game_id","player_id")
);
--> statement-breakpoint
CREATE TABLE "games" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_code" text NOT NULL,
	"mode" "game_mode" NOT NULL,
	"host_player_id" uuid,
	"settings" jsonb NOT NULL,
	"pair_id" uuid,
	"civilian_word" text NOT NULL,
	"undercover_word" text NOT NULL,
	"rounds_played" integer DEFAULT 0 NOT NULL,
	"winner_faction" "faction",
	"summary" jsonb,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "players" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"display_name" text NOT NULL,
	"avatar" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_guest" boolean DEFAULT true NOT NULL,
	"email" "citext",
	"total_points" integer DEFAULT 0 NOT NULL,
	"games_played" integer DEFAULT 0 NOT NULL,
	"games_won" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "players_email_unique" UNIQUE("email"),
	CONSTRAINT "players_display_name_length" CHECK (char_length("players"."display_name") BETWEEN 2 AND 20)
);
--> statement-breakpoint
CREATE TABLE "word_packs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"category" text DEFAULT 'custom' NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"is_official" boolean DEFAULT false NOT NULL,
	"owner_id" uuid,
	"visibility" "pack_visibility" DEFAULT 'private' NOT NULL,
	"share_code" text,
	"cover_url" text,
	"pair_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "word_packs_slug_unique" UNIQUE("slug"),
	CONSTRAINT "word_packs_share_code_unique" UNIQUE("share_code"),
	CONSTRAINT "word_packs_name_length" CHECK (char_length("word_packs"."name") BETWEEN 2 AND 40),
	CONSTRAINT "word_packs_official_owner" CHECK ("word_packs"."is_official" = ("word_packs"."owner_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "word_pairs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pack_id" uuid NOT NULL,
	"word_a" text NOT NULL,
	"word_b" text NOT NULL,
	"difficulty" "difficulty" DEFAULT 'medium' NOT NULL,
	"status" "pair_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "word_pairs_word_a_length" CHECK (char_length("word_pairs"."word_a") BETWEEN 1 AND 40),
	CONSTRAINT "word_pairs_word_b_length" CHECK (char_length("word_pairs"."word_b") BETWEEN 1 AND 40)
);
--> statement-breakpoint
ALTER TABLE "game_players" ADD CONSTRAINT "game_players_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_players" ADD CONSTRAINT "game_players_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_host_player_id_players_id_fk" FOREIGN KEY ("host_player_id") REFERENCES "public"."players"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_pair_id_word_pairs_id_fk" FOREIGN KEY ("pair_id") REFERENCES "public"."word_pairs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "word_packs" ADD CONSTRAINT "word_packs_owner_id_players_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "word_pairs" ADD CONSTRAINT "word_pairs_pack_id_word_packs_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."word_packs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_gp_player" ON "game_players" USING btree ("player_id","game_id");--> statement-breakpoint
CREATE INDEX "idx_games_room" ON "games" USING btree ("room_code","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_games_started" ON "games" USING btree ("started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "word_pairs_pack_word_a_word_b_key" ON "word_pairs" USING btree ("pack_id","word_a","word_b");--> statement-breakpoint
CREATE INDEX "idx_pairs_pack" ON "word_pairs" USING btree ("pack_id") WHERE "word_pairs"."status" = 'active';