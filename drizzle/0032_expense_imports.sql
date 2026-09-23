-- Phase 14 (D-115): invoice imports and the drafts read off them.
--
-- The check constraint at the bottom compares "feature"::text, not the enum column, on purpose.
-- Postgres refuses to use an enum value in the transaction that added it, and drizzle applies
-- every pending migration inside ONE transaction (pg-core/dialect.js wraps the whole loop), so
-- moving the constraint to a second migration file would not have separated them. Comparing as
-- text never evaluates the new enum literal. See the note in schema.ts; this qualifies D-106.
--
-- Fail fast rather than queue: the foreign keys below take locks on organizations, users,
-- funding_sources and line_items, and ADD CONSTRAINT takes ACCESS EXCLUSIVE on ai_usage_events,
-- all of which the running app writes to. A deploy that can't get a lock within 5 s aborts with
-- the old app still serving, and is simply re-run.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TYPE "public"."ai_usage_feature" ADD VALUE 'invoice_read';--> statement-breakpoint
CREATE TABLE "expense_drafts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"import_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"funding_source_id" uuid NOT NULL,
	"month" char(7) NOT NULL,
	"date" date NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"line_item_id" uuid,
	"payment_source" text NOT NULL,
	"subtotal_cents" bigint DEFAULT 0 NOT NULL,
	"tax_cents" bigint DEFAULT 0 NOT NULL,
	"fees_cents" bigint DEFAULT 0 NOT NULL,
	"note" text,
	"narrative" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expense_drafts_month_ck" CHECK ("expense_drafts"."month" ~ '^\d{4}-(0[1-9]|1[0-2])$')
);
--> statement-breakpoint
CREATE TABLE "expense_imports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"funding_source_id" uuid NOT NULL,
	"month" char(7) NOT NULL,
	"uploaded_by" uuid,
	"s3_key" text NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint DEFAULT 0 NOT NULL,
	"page_count" integer,
	"sha256" char(64) NOT NULL,
	"vendor_name" text,
	"invoice_date" date,
	"bill_tax_cents" bigint,
	"bill_fees_cents" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expense_imports_month_ck" CHECK ("expense_imports"."month" ~ '^\d{4}-(0[1-9]|1[0-2])$')
);
--> statement-breakpoint
ALTER TABLE "expense_drafts" ADD CONSTRAINT "expense_drafts_import_id_expense_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."expense_imports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_drafts" ADD CONSTRAINT "expense_drafts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_drafts" ADD CONSTRAINT "expense_drafts_line_item_id_line_items_id_fk" FOREIGN KEY ("line_item_id") REFERENCES "public"."line_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_drafts" ADD CONSTRAINT "expense_drafts_funding_source_id_org_id_funding_sources_id_org_id_fk" FOREIGN KEY ("funding_source_id","org_id") REFERENCES "public"."funding_sources"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_drafts" ADD CONSTRAINT "expense_drafts_line_item_id_funding_source_id_line_items_id_funding_source_id_fk" FOREIGN KEY ("line_item_id","funding_source_id") REFERENCES "public"."line_items"("id","funding_source_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_imports" ADD CONSTRAINT "expense_imports_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_imports" ADD CONSTRAINT "expense_imports_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_imports" ADD CONSTRAINT "expense_imports_funding_source_id_org_id_funding_sources_id_org_id_fk" FOREIGN KEY ("funding_source_id","org_id") REFERENCES "public"."funding_sources"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expense_drafts_org_source_month_idx" ON "expense_drafts" USING btree ("org_id","funding_source_id","month","sort_order");--> statement-breakpoint
CREATE INDEX "expense_drafts_import_idx" ON "expense_drafts" USING btree ("import_id","sort_order");--> statement-breakpoint
CREATE INDEX "expense_drafts_line_item_idx" ON "expense_drafts" USING btree ("line_item_id");--> statement-breakpoint
CREATE INDEX "expense_imports_org_source_month_idx" ON "expense_imports" USING btree ("org_id","funding_source_id","month","sha256");--> statement-breakpoint
ALTER TABLE "ai_usage_events" ADD CONSTRAINT "ai_usage_events_invoice_read_ck" CHECK ("ai_usage_events"."feature"::text <> 'invoice_read' OR ("ai_usage_events"."document_source" IS NOT NULL AND "ai_usage_events"."document_kind" IS NOT NULL AND "ai_usage_events"."outcome" IN ('found', 'none', 'failed')));