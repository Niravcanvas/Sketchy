CREATE TABLE "pack_access" (
	"pack_id" uuid NOT NULL,
	"player_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pack_access_pack_id_player_id_pk" PRIMARY KEY("pack_id","player_id")
);
--> statement-breakpoint
ALTER TABLE "pack_access" ADD CONSTRAINT "pack_access_pack_id_word_packs_id_fk" FOREIGN KEY ("pack_id") REFERENCES "public"."word_packs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pack_access" ADD CONSTRAINT "pack_access_player_id_players_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_pack_access_player" ON "pack_access" USING btree ("player_id");