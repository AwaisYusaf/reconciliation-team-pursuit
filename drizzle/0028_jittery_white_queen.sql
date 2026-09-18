CREATE TYPE "public"."ai_usage_document_kind" AS ENUM('receipt', 'proof');--> statement-breakpoint
CREATE TYPE "public"."ai_usage_document_source" AS ENUM('upload', 'attached');--> statement-breakpoint
CREATE TYPE "public"."ai_usage_feature" AS ENUM('amount_read', 'monthly_summary');--> statement-breakpoint
CREATE TYPE "public"."ai_usage_outcome" AS ENUM('found', 'none', 'failed', 'success', 'rejected');--> statement-breakpoint
CREATE TABLE "ai_usage_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid,
	"feature" "ai_usage_feature" NOT NULL,
	"outcome" "ai_usage_outcome" NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"cost_micro_usd" integer,
	"document_source" "ai_usage_document_source",
	"document_kind" "ai_usage_document_kind",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_usage_events_amount_read_ck" CHECK ("ai_usage_events"."feature" <> 'amount_read' OR ("ai_usage_events"."document_source" IS NOT NULL AND "ai_usage_events"."document_kind" IS NOT NULL AND "ai_usage_events"."outcome" IN ('found', 'none', 'failed')))
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "read_amounts_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_usage_events" ADD CONSTRAINT "ai_usage_events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage_events" ADD CONSTRAINT "ai_usage_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_usage_events_org_idx" ON "ai_usage_events" USING btree ("org_id","created_at");