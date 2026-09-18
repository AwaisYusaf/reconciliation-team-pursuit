ALTER TABLE "ai_usage_events" DROP CONSTRAINT "ai_usage_events_funding_source_id_funding_sources_id_fk";
--> statement-breakpoint
ALTER TABLE "ai_usage_events" ADD CONSTRAINT "ai_usage_events_funding_source_id_org_id_funding_sources_id_org_id_fk" FOREIGN KEY ("funding_source_id","org_id") REFERENCES "public"."funding_sources"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage_events" ADD CONSTRAINT "ai_usage_events_month_ck" CHECK ("ai_usage_events"."month" ~ '^\d{4}-(0[1-9]|1[0-2])$');