-- Fail fast rather than queue: every statement below waits for a lock on a table the running app
-- writes to (generated_artifacts, and the FK targets organizations, users and funding_sources).
-- A deploy that can't get one within 5 s aborts with the old app still serving, and is simply
-- re-run, instead of holding sign-ins and downloads behind it. Applies to the rest of drizzle's
-- migration transaction.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
-- Moved by hand above everything else (PHASE-12 §3): drizzle-kit writes foreign keys before
-- indexes, and "shared_links_artifact_fk" references this index's columns, which Postgres only
-- allows once a unique constraint on them exists.
CREATE UNIQUE INDEX "generated_artifacts_scope_id_uq" ON "generated_artifacts" USING btree ("id","org_id","funding_source_id","month","type");--> statement-breakpoint
CREATE TABLE "shared_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"funding_source_id" uuid NOT NULL,
	"month" char(7) NOT NULL,
	"artifact_type" "artifact_type" NOT NULL,
	"artifact_id" uuid NOT NULL,
	"token" text NOT NULL,
	"password_hash" text,
	"filename" text NOT NULL,
	"records_hash" text NOT NULL,
	"created_by" uuid,
	"shared_at" timestamp with time zone NOT NULL,
	"shared_by" uuid,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shared_links_month_ck" CHECK ("shared_links"."month" ~ '^\d{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "shared_links_artifact_type_ck" CHECK ("shared_links"."artifact_type" in ('packet_pdf', 'summary_xlsx')),
	CONSTRAINT "shared_links_token_ck" CHECK ("shared_links"."token" ~ '^[0-9A-Za-z]{12}$'),
	CONSTRAINT "shared_links_revoked_password_ck" CHECK ("shared_links"."revoked_at" is null or "shared_links"."password_hash" is null),
	CONSTRAINT "shared_links_revoked_by_ck" CHECK ("shared_links"."revoked_by" is null or "shared_links"."revoked_at" is not null)
);
--> statement-breakpoint
ALTER TABLE "shared_links" ADD CONSTRAINT "shared_links_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_links" ADD CONSTRAINT "shared_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_links" ADD CONSTRAINT "shared_links_shared_by_users_id_fk" FOREIGN KEY ("shared_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_links" ADD CONSTRAINT "shared_links_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_links" ADD CONSTRAINT "shared_links_funding_source_id_org_id_funding_sources_id_org_id_fk" FOREIGN KEY ("funding_source_id","org_id") REFERENCES "public"."funding_sources"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shared_links" ADD CONSTRAINT "shared_links_artifact_fk" FOREIGN KEY ("artifact_id","org_id","funding_source_id","month","artifact_type") REFERENCES "public"."generated_artifacts"("id","org_id","funding_source_id","month","type") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "shared_links_token_uq" ON "shared_links" USING btree ("token");--> statement-breakpoint
CREATE UNIQUE INDEX "shared_links_active_uq" ON "shared_links" USING btree ("org_id","funding_source_id","month","artifact_type") WHERE "shared_links"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "shared_links_artifact_idx" ON "shared_links" USING btree ("artifact_id");