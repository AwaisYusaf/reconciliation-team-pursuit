CREATE TYPE "public"."summary_trigger" AS ENUM('first', 'again');--> statement-breakpoint
CREATE TABLE "monthly_summaries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"funding_source_id" uuid NOT NULL,
	"month" char(7) NOT NULL,
	"content_markdown" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"expenses_fingerprint" char(64) NOT NULL,
	"written_at" timestamp with time zone NOT NULL,
	"written_by" uuid,
	"model" text NOT NULL,
	"edited_at" timestamp with time zone,
	"edited_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "monthly_summaries_month_ck" CHECK ("monthly_summaries"."month" ~ '^\d{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "monthly_summaries_content_length_ck" CHECK (char_length("monthly_summaries"."content_markdown") <= 60000)
);
--> statement-breakpoint
ALTER TABLE "ai_usage_events" ADD COLUMN "funding_source_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_usage_events" ADD COLUMN "month" char(7);--> statement-breakpoint
ALTER TABLE "ai_usage_events" ADD COLUMN "trigger" "summary_trigger";--> statement-breakpoint
ALTER TABLE "monthly_summaries" ADD CONSTRAINT "monthly_summaries_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_summaries" ADD CONSTRAINT "monthly_summaries_written_by_users_id_fk" FOREIGN KEY ("written_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_summaries" ADD CONSTRAINT "monthly_summaries_edited_by_users_id_fk" FOREIGN KEY ("edited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monthly_summaries" ADD CONSTRAINT "monthly_summaries_funding_source_id_org_id_funding_sources_id_org_id_fk" FOREIGN KEY ("funding_source_id","org_id") REFERENCES "public"."funding_sources"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "monthly_summaries_source_month_uq" ON "monthly_summaries" USING btree ("org_id","funding_source_id","month");--> statement-breakpoint
ALTER TABLE "ai_usage_events" ADD CONSTRAINT "ai_usage_events_funding_source_id_funding_sources_id_fk" FOREIGN KEY ("funding_source_id") REFERENCES "public"."funding_sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage_events" ADD CONSTRAINT "ai_usage_events_monthly_summary_ck" CHECK ("ai_usage_events"."feature" <> 'monthly_summary' OR ("ai_usage_events"."funding_source_id" IS NOT NULL AND "ai_usage_events"."month" IS NOT NULL AND "ai_usage_events"."trigger" IS NOT NULL AND "ai_usage_events"."outcome" IN ('success', 'rejected', 'failed')));