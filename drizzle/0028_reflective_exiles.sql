CREATE TYPE "public"."amount_read_document_kind" AS ENUM('receipt', 'proof');--> statement-breakpoint
CREATE TYPE "public"."amount_read_outcome" AS ENUM('found', 'none', 'failed');--> statement-breakpoint
CREATE TYPE "public"."amount_read_source" AS ENUM('upload', 'attached');--> statement-breakpoint
CREATE TABLE "amount_reads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid,
	"source" "amount_read_source" NOT NULL,
	"document_kind" "amount_read_document_kind" NOT NULL,
	"outcome" "amount_read_outcome" NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"cost_micro_usd" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "read_amounts_enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "amount_reads" ADD CONSTRAINT "amount_reads_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "amount_reads" ADD CONSTRAINT "amount_reads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "amount_reads_org_idx" ON "amount_reads" USING btree ("org_id","created_at");