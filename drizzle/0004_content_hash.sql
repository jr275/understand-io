ALTER TABLE "documents" ADD COLUMN "content_hash" text;--> statement-breakpoint
CREATE INDEX "documents_reader_hash_idx" ON "documents" USING btree ("reader_id","content_hash");