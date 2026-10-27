CREATE TABLE "ai_leases" (
	"key" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"expires_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_ledger" (
	"period" text PRIMARY KEY NOT NULL,
	"spent_micro" bigint DEFAULT 0 NOT NULL,
	"input_tokens" bigint DEFAULT 0 NOT NULL,
	"output_tokens" bigint DEFAULT 0 NOT NULL,
	"requests" integer DEFAULT 0 NOT NULL,
	"errors" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_reservations" (
	"id" text PRIMARY KEY NOT NULL,
	"amount_micro" bigint NOT NULL,
	"expires_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE INDEX "ai_reservations_expires_idx" ON "ai_reservations" USING btree ("expires_at");