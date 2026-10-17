CREATE TABLE "accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"subject" text NOT NULL,
	"email" text,
	"name" text,
	"picture" text,
	"reader_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_reader_id_readers_id_fk" FOREIGN KEY ("reader_id") REFERENCES "public"."readers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_provider_subject_idx" ON "accounts" USING btree ("provider","subject");--> statement-breakpoint
CREATE INDEX "accounts_reader_idx" ON "accounts" USING btree ("reader_id");