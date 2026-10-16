CREATE TABLE "annotations" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"reader_id" text NOT NULL,
	"kind" text NOT NULL,
	"color" text,
	"note" text,
	"anchor" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" text PRIMARY KEY NOT NULL,
	"reader_id" text NOT NULL,
	"slug" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"author" text,
	"dek" text,
	"year" integer,
	"source_url" text,
	"source_label" text,
	"topic" text DEFAULT 'unsorted' NOT NULL,
	"minutes" integer DEFAULT 1 NOT NULL,
	"blocks" jsonb NOT NULL,
	"favourite" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "glosses" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"reader_id" text NOT NULL,
	"action" text NOT NULL,
	"anchor" jsonb,
	"turns" jsonb NOT NULL,
	"model" text,
	"usage" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "readers" (
	"id" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reading_progress" (
	"document_id" text NOT NULL,
	"reader_id" text NOT NULL,
	"block_id" text,
	"ratio" real DEFAULT 0 NOT NULL,
	"finished" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reading_progress_document_id_reader_id_pk" PRIMARY KEY("document_id","reader_id")
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"reader_id" text PRIMARY KEY NOT NULL,
	"data" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "annotations" ADD CONSTRAINT "annotations_reader_id_readers_id_fk" FOREIGN KEY ("reader_id") REFERENCES "public"."readers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_reader_id_readers_id_fk" FOREIGN KEY ("reader_id") REFERENCES "public"."readers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "glosses" ADD CONSTRAINT "glosses_reader_id_readers_id_fk" FOREIGN KEY ("reader_id") REFERENCES "public"."readers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reading_progress" ADD CONSTRAINT "reading_progress_reader_id_readers_id_fk" FOREIGN KEY ("reader_id") REFERENCES "public"."readers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_reader_id_readers_id_fk" FOREIGN KEY ("reader_id") REFERENCES "public"."readers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "annotations_doc_idx" ON "annotations" USING btree ("document_id","reader_id");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_slug_idx" ON "documents" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "documents_reader_idx" ON "documents" USING btree ("reader_id");--> statement-breakpoint
CREATE INDEX "glosses_doc_idx" ON "glosses" USING btree ("document_id","reader_id");