CREATE TYPE "public"."org_account_event_action" AS ENUM('plan_changed', 'complimentary_granted', 'complimentary_changed', 'complimentary_removed', 'suspended', 'reinstated');--> statement-breakpoint
CREATE TYPE "public"."org_plan" AS ENUM('reconciliation', 'reconciliation_ai');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('trial', 'active', 'past_due', 'cancelled');--> statement-breakpoint
CREATE TABLE "org_account_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"actor_staff_id" uuid,
	"action" "org_account_event_action" NOT NULL,
	"before" jsonb NOT NULL,
	"after" jsonb NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"staff_user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "plan" "org_plan" DEFAULT 'reconciliation' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "subscription_status" "subscription_status" DEFAULT 'trial' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "complimentary" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "complimentary_until" date;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "suspended_at" timestamp with time zone;--> statement-breakpoint
UPDATE "organizations" SET "subscription_status" = 'active', "complimentary" = true;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_sign_in_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "org_account_events" ADD CONSTRAINT "org_account_events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_account_events" ADD CONSTRAINT "org_account_events_actor_staff_id_staff_users_id_fk" FOREIGN KEY ("actor_staff_id") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_sessions" ADD CONSTRAINT "staff_sessions_staff_user_id_staff_users_id_fk" FOREIGN KEY ("staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "org_account_events_org_idx" ON "org_account_events" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "staff_sessions_staff_user_idx" ON "staff_sessions" USING btree ("staff_user_id");--> statement-breakpoint
CREATE INDEX "staff_sessions_expires_idx" ON "staff_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_users_email_lower_uq" ON "staff_users" USING btree (lower("email"));