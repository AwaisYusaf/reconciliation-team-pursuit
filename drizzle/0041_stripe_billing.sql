-- Phase 16 (D-123): the Stripe billing columns. Every one is nullable or has a constant
-- default, so each ADD COLUMN is metadata-only; none is an enum change (D-115).
--
-- ADD COLUMN still takes ACCESS EXCLUSIVE on `organizations`, which every signed-in request
-- reads. Fail fast rather than queue: a deploy that cannot get the lock within 5 s aborts with
-- the old app still serving, and is simply re-run (same as 0039 and 0040).
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "org_account_events" ADD COLUMN "via_stripe" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "stripe_customer_id" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "stripe_livemode" boolean;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "stripe_subscription_id" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "stripe_status" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "billing_interval" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "current_period_end" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "cancel_at_period_end" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "pending_plan" "org_plan";--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "pending_interval" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "pending_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "pending_reason" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "upgrade_pay_url" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "upgrade_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "billing_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "complimentary_plan" "org_plan";--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "collection_paused" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "billing_flag" text;--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_stripe_customer_id_uq" ON "organizations" USING btree ("stripe_customer_id");--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_stripe_status_ck" CHECK ("organizations"."stripe_status" IS NULL OR length("organizations"."stripe_status") > 0);--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_billing_interval_ck" CHECK ("organizations"."billing_interval" IS NULL OR "organizations"."billing_interval" IN ('month', 'year'));--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_pending_interval_ck" CHECK ("organizations"."pending_interval" IS NULL OR "organizations"."pending_interval" IN ('month', 'year'));--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_pending_reason_ck" CHECK ("organizations"."pending_reason" IS NULL OR "organizations"."pending_reason" IN ('downgrade', 'price_move'));