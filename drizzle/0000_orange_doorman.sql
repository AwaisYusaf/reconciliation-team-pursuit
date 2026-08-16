CREATE TYPE "public"."artifact_type" AS ENUM('packet_pdf', 'summary_xlsx', 'cover_docx', 'cover_pdf');--> statement-breakpoint
CREATE TYPE "public"."document_kind" AS ENUM('proof', 'receipt', 'supporting');--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('pending', 'attached', 'failed');--> statement-breakpoint
CREATE TYPE "public"."month_document_category" AS ENUM('bank_statement', 'combined_hours', 'timesheet', 'fiduciary_invoice', 'other');--> statement-breakpoint
CREATE TABLE "contract_settings" (
	"org_id" uuid PRIMARY KEY NOT NULL,
	"project_name" text DEFAULT '' NOT NULL,
	"contract_number" text DEFAULT '' NOT NULL,
	"base_po_number" text DEFAULT '' NOT NULL,
	"performance_po_number" text DEFAULT '' NOT NULL,
	"contract_value_cents" bigint DEFAULT 0 NOT NULL,
	"contract_start" date,
	"contract_end" date,
	"fiduciary_name" text DEFAULT '' NOT NULL,
	"perf_grant_scheduled_cents" bigint DEFAULT 0 NOT NULL,
	"perf_grant_billed_cents" bigint DEFAULT 0 NOT NULL,
	"advances_received_cents" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expense_documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"expense_id" uuid NOT NULL,
	"kind" "document_kind" NOT NULL,
	"supporting_type" text,
	"status" "document_status" DEFAULT 'pending' NOT NULL,
	"s3_key" text NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint DEFAULT 0 NOT NULL,
	"page_count" integer,
	"width_px" integer,
	"height_px" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expense_documents_supporting_type_ck" CHECK (("expense_documents"."kind" = 'supporting') = ("expense_documents"."supporting_type" is not null))
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"line_item_id" uuid NOT NULL,
	"month" char(7) NOT NULL,
	"date" date NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"payment_source" text NOT NULL,
	"subtotal_cents" bigint DEFAULT 0 NOT NULL,
	"tax_cents" bigint DEFAULT 0 NOT NULL,
	"fees_cents" bigint DEFAULT 0 NOT NULL,
	"note" text,
	"narrative" text,
	"no_receipt" boolean DEFAULT false NOT NULL,
	"no_receipt_reason" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expenses_no_receipt_reason_ck" CHECK (not "expenses"."no_receipt" or ("expenses"."no_receipt_reason" is not null and btrim("expenses"."no_receipt_reason") <> ''))
);
--> statement-breakpoint
CREATE TABLE "generated_artifacts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"month" char(7) NOT NULL,
	"type" "artifact_type" NOT NULL,
	"line_item_id" uuid,
	"inputs_hash" text NOT NULL,
	"downloaded_at" timestamp with time zone,
	"s3_key" text NOT NULL,
	"size_bytes" bigint DEFAULT 0 NOT NULL,
	"page_count" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "line_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"scheduled_value_cents" bigint DEFAULT 0 NOT NULL,
	"opening_billed_cents" bigint DEFAULT 0 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "month_documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"month" char(7) NOT NULL,
	"category" "month_document_category" NOT NULL,
	"title" text,
	"status" "document_status" DEFAULT 'pending' NOT NULL,
	"s3_key" text NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint DEFAULT 0 NOT NULL,
	"page_count" integer,
	"width_px" integer,
	"height_px" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "month_statuses" (
	"org_id" uuid NOT NULL,
	"month" char(7) NOT NULL,
	"submitted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "month_statuses_org_id_month_pk" PRIMARY KEY("org_id","month")
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"doc_name" text NOT NULL,
	"active_month" char(7) NOT NULL,
	"onboarded_at" timestamp with time zone,
	"welcome_dismissed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_sources" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recurring_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"amount_cents" bigint DEFAULT 0 NOT NULL,
	"line_item_id" uuid NOT NULL,
	"default_description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supporting_doc_types" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendor_defaults" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"default_line_item_id" uuid,
	"default_description" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contract_settings" ADD CONSTRAINT "contract_settings_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_documents" ADD CONSTRAINT "expense_documents_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_documents" ADD CONSTRAINT "expense_documents_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_line_item_id_line_items_id_fk" FOREIGN KEY ("line_item_id") REFERENCES "public"."line_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_artifacts" ADD CONSTRAINT "generated_artifacts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_artifacts" ADD CONSTRAINT "generated_artifacts_line_item_id_line_items_id_fk" FOREIGN KEY ("line_item_id") REFERENCES "public"."line_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "line_items" ADD CONSTRAINT "line_items_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "month_documents" ADD CONSTRAINT "month_documents_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "month_statuses" ADD CONSTRAINT "month_statuses_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_sources" ADD CONSTRAINT "payment_sources_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_items" ADD CONSTRAINT "recurring_items_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_items" ADD CONSTRAINT "recurring_items_line_item_id_line_items_id_fk" FOREIGN KEY ("line_item_id") REFERENCES "public"."line_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supporting_doc_types" ADD CONSTRAINT "supporting_doc_types_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_defaults" ADD CONSTRAINT "vendor_defaults_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_defaults" ADD CONSTRAINT "vendor_defaults_default_line_item_id_line_items_id_fk" FOREIGN KEY ("default_line_item_id") REFERENCES "public"."line_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expense_documents_expense_idx" ON "expense_documents" USING btree ("expense_id","kind","sort_order");--> statement-breakpoint
CREATE INDEX "expense_documents_org_idx" ON "expense_documents" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "expenses_org_month_idx" ON "expenses" USING btree ("org_id","month");--> statement-breakpoint
CREATE INDEX "expenses_line_item_idx" ON "expenses" USING btree ("line_item_id");--> statement-breakpoint
CREATE INDEX "expenses_org_month_sort_idx" ON "expenses" USING btree ("org_id","month","sort_order");--> statement-breakpoint
CREATE INDEX "generated_artifacts_lookup_idx" ON "generated_artifacts" USING btree ("org_id","month","type","line_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "generated_artifacts_live_uq" ON "generated_artifacts" USING btree ("org_id","month","type",coalesce("line_item_id", '00000000-0000-0000-0000-000000000000'::uuid)) WHERE "generated_artifacts"."downloaded_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "line_items_org_name_uq" ON "line_items" USING btree ("org_id",lower("name"));--> statement-breakpoint
CREATE INDEX "line_items_org_sort_idx" ON "line_items" USING btree ("org_id","sort_order");--> statement-breakpoint
CREATE INDEX "month_documents_org_month_idx" ON "month_documents" USING btree ("org_id","month","category","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_sources_org_label_uq" ON "payment_sources" USING btree ("org_id",lower("label"));--> statement-breakpoint
CREATE INDEX "recurring_items_org_sort_idx" ON "recurring_items" USING btree ("org_id","sort_order");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "supporting_doc_types_org_label_uq" ON "supporting_doc_types" USING btree ("org_id",lower("label"));--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_uq" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "users_org_idx" ON "users" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vendor_defaults_org_name_uq" ON "vendor_defaults" USING btree ("org_id",lower("name"));