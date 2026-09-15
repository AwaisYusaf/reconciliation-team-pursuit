CREATE TABLE "month_lock_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"funding_source_id" uuid NOT NULL,
	"month" char(7) NOT NULL,
	"actor_user_id" uuid,
	"reason" text,
	"s3_key" text,
	"filename" text,
	"size_bytes" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "month_statuses" ADD COLUMN "locked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "month_lock_events" ADD CONSTRAINT "month_lock_events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "month_lock_events" ADD CONSTRAINT "month_lock_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "month_lock_events" ADD CONSTRAINT "month_lock_events_funding_source_id_org_id_funding_sources_id_org_id_fk" FOREIGN KEY ("funding_source_id","org_id") REFERENCES "public"."funding_sources"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "month_lock_events_month_idx" ON "month_lock_events" USING btree ("org_id","funding_source_id","month","created_at");