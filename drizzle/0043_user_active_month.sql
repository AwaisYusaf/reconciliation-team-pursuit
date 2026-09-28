-- PHASE-18 (D-131): state one person picks for themselves moves from the organization to each
-- person, so one manager's click no longer changes another's screens: the header's month and
-- funding source, and the dashboard's welcome banner dismissal. Additive: three nullable columns
-- on `users`, then each person starts where their organization was. The organization's columns
-- of the same names are left in place (unused) so a code-only rollback still finds a month; a
-- later clean-up drops them.
--
-- Fail fast rather than queue behind a long request: a deploy that can't get a lock within 5 s
-- aborts with the old app still serving, and is simply re-run (same as 0039 to 0042). The foreign
-- key briefly takes SHARE ROW EXCLUSIVE on `funding_sources`.
--
-- Rollback: ALTER TABLE "users" DROP COLUMN "active_month", DROP COLUMN "active_funding_source_id", DROP COLUMN "welcome_dismissed_at";
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "active_month" char(7);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "active_funding_source_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "welcome_dismissed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_active_funding_source_id_funding_sources_id_fk" FOREIGN KEY ("active_funding_source_id") REFERENCES "public"."funding_sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
UPDATE "users" SET "active_month" = "organizations"."active_month", "active_funding_source_id" = "organizations"."active_funding_source_id", "welcome_dismissed_at" = "organizations"."welcome_dismissed_at" FROM "organizations" WHERE "organizations"."id" = "users"."org_id";
