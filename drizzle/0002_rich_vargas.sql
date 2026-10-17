DROP INDEX "accounts_reader_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_reader_idx" ON "accounts" USING btree ("reader_id");