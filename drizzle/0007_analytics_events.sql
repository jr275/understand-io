CREATE TABLE "analytics_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "analytics_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"at" bigint NOT NULL,
	"event" text NOT NULL,
	"actor" text NOT NULL,
	"actor_kind" text NOT NULL,
	"route" text,
	"props" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"channel" text,
	"campaign" text,
	"ref" text
);
--> statement-breakpoint
CREATE INDEX "analytics_events_at_idx" ON "analytics_events" USING btree ("at");--> statement-breakpoint
CREATE INDEX "analytics_events_event_idx" ON "analytics_events" USING btree ("event","at");--> statement-breakpoint
CREATE INDEX "analytics_events_actor_idx" ON "analytics_events" USING btree ("actor","at");