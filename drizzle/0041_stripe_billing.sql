-- Phase 16 (D-123, D-125): the Stripe billing copy, in its own table `org_billing`, one row per
-- organization once it has a Stripe customer. Kept off `organizations`, which every signed-in
-- request reads, so a webhook rewrites this row rather than the org's. On `organizations` only
-- `complimentary_plan`; on `org_account_events` only `via_stripe`. Every added column is nullable
-- or has a constant default, so each ADD COLUMN is metadata-only; no enum gains a value (D-115).
--
-- ADD COLUMN, and the foreign key into `organizations`, still take locks on tables every
-- signed-in request reads. Fail fast rather than queue: a deploy that cannot get a lock within
-- 5 s aborts with the old app still serving, and is simply re-run (same as 0039 and 0040).
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
CREATE TABLE "org_billing" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"stripe_customer_id" text NOT NULL,
	"livemode" boolean NOT NULL,
	"stripe_status" text,
	"billing_interval" text,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"pending_plan" "org_plan",
	"pending_interval" text,
	"pending_at" timestamp with time zone,
	"pending_reason" text,
	"upgrade_pay_url" text,
	"upgrade_expires_at" timestamp with time zone,
	"collection_paused" boolean DEFAULT false NOT NULL,
	"disputed_at" timestamp with time zone,
	"synced_at" timestamp with time zone,
	CONSTRAINT "org_billing_stripe_status_ck" CHECK ("org_billing"."stripe_status" IS NULL OR length("org_billing"."stripe_status") > 0),
	CONSTRAINT "org_billing_billing_interval_ck" CHECK ("org_billing"."billing_interval" IS NULL OR "org_billing"."billing_interval" IN ('month', 'year')),
	CONSTRAINT "org_billing_pending_interval_ck" CHECK ("org_billing"."pending_interval" IS NULL OR "org_billing"."pending_interval" IN ('month', 'year')),
	CONSTRAINT "org_billing_pending_reason_ck" CHECK ("org_billing"."pending_reason" IS NULL OR "org_billing"."pending_reason" IN ('downgrade', 'price_move'))
);
--> statement-breakpoint
ALTER TABLE "org_account_events" ADD COLUMN "via_stripe" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "complimentary_plan" "org_plan";--> statement-breakpoint
ALTER TABLE "org_billing" ADD CONSTRAINT "org_billing_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "org_billing_stripe_customer_id_uq" ON "org_billing" USING btree ("stripe_customer_id");