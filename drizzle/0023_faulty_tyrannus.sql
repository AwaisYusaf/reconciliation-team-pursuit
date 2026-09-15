-- 1. type + table + its 3 indexes
CREATE TYPE "public"."funding_source_type" AS ENUM('grant', 'donation', 'line_of_credit', 'other');--> statement-breakpoint
CREATE TABLE "funding_sources" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" "funding_source_type" DEFAULT 'grant' NOT NULL,
	"doc_name" text,
	"project_name" text DEFAULT '' NOT NULL,
	"contract_number" text DEFAULT '' NOT NULL,
	"base_po_number" text DEFAULT '' NOT NULL,
	"performance_po_number" text DEFAULT '' NOT NULL,
	"contract_value_cents" bigint DEFAULT 0 NOT NULL,
	"contract_start" date,
	"contract_end" date,
	"fiduciary_name" text DEFAULT '' NOT NULL,
	"advances_received_cents" bigint DEFAULT 0 NOT NULL,
	"tax_reimbursable" boolean NOT NULL,
	"fees_reimbursable" boolean NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "funding_sources" ADD CONSTRAINT "funding_sources_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "funding_sources_id_org_uq" ON "funding_sources" USING btree ("id","org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "funding_sources_org_name_uq" ON "funding_sources" USING btree ("org_id",lower("name"));--> statement-breakpoint
CREATE INDEX "funding_sources_org_sort_idx" ON "funding_sources" USING btree ("org_id","sort_order");--> statement-breakpoint

-- 2. one source per existing organisation (decision 2.11 for the rules)
INSERT INTO "funding_sources" ("id","org_id","name","type","doc_name","project_name",
  "contract_number","base_po_number","performance_po_number","contract_value_cents",
  "contract_start","contract_end","fiduciary_name","advances_received_cents",
  "tax_reimbursable","fees_reimbursable","sort_order")
SELECT gen_random_uuid(), o.id,
       coalesce(nullif(btrim(cs.project_name), ''), 'Source 1'),
       'grant', NULL,
       coalesce(cs.project_name, ''), coalesce(cs.contract_number, ''),
       coalesce(cs.base_po_number, ''), coalesce(cs.performance_po_number, ''),
       coalesce(cs.contract_value_cents, 0), cs.contract_start, cs.contract_end,
       coalesce(cs.fiduciary_name, ''), coalesce(cs.advances_received_cents, 0),
       coalesce(ps.tax_reimbursable, false), coalesce(ps.fees_reimbursable, true), 0
FROM "organizations" o
LEFT JOIN "contract_settings" cs ON cs.org_id = o.id
LEFT JOIN LATERAL (
  SELECT p.tax_reimbursable, p.fees_reimbursable FROM "payment_sources" p
  WHERE p.org_id = o.id AND p.active ORDER BY p.sort_order, p.id LIMIT 1
) ps ON true;
-- gen_random_uuid() is core since Postgres 13; it yields a v4 uuid, which isUuid() (src/lib/ids.ts) accepts.
--> statement-breakpoint

-- 3. add nullable columns
ALTER TABLE "line_items" ADD COLUMN "funding_source_id" uuid;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "funding_source_id" uuid;--> statement-breakpoint
ALTER TABLE "month_documents" ADD COLUMN "funding_source_id" uuid;--> statement-breakpoint
ALTER TABLE "month_statuses" ADD COLUMN "funding_source_id" uuid;--> statement-breakpoint
ALTER TABLE "month_snapshots" ADD COLUMN "funding_source_id" uuid;--> statement-breakpoint
ALTER TABLE "month_snapshot_totals" ADD COLUMN "funding_source_id" uuid;--> statement-breakpoint
ALTER TABLE "generated_artifacts" ADD COLUMN "funding_source_id" uuid;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "active_funding_source_id" uuid;--> statement-breakpoint

-- 4. backfill: exactly one source per org exists at this point, so a join on org_id is exact.
UPDATE "line_items" t SET "funding_source_id" = fs.id FROM "funding_sources" fs WHERE fs.org_id = t.org_id;--> statement-breakpoint
UPDATE "expenses" t SET "funding_source_id" = fs.id FROM "funding_sources" fs WHERE fs.org_id = t.org_id;--> statement-breakpoint
UPDATE "month_documents" t SET "funding_source_id" = fs.id FROM "funding_sources" fs WHERE fs.org_id = t.org_id;--> statement-breakpoint
UPDATE "month_statuses" t SET "funding_source_id" = fs.id FROM "funding_sources" fs WHERE fs.org_id = t.org_id;--> statement-breakpoint
UPDATE "month_snapshots" t SET "funding_source_id" = fs.id FROM "funding_sources" fs WHERE fs.org_id = t.org_id;--> statement-breakpoint
UPDATE "month_snapshot_totals" t SET "funding_source_id" = fs.id FROM "funding_sources" fs WHERE fs.org_id = t.org_id;--> statement-breakpoint
UPDATE "generated_artifacts" t SET "funding_source_id" = fs.id FROM "funding_sources" fs WHERE fs.org_id = t.org_id;--> statement-breakpoint
-- organizations.active_funding_source_id stays NULL (decision 2.5: NULL = "All").

-- 5. SET NOT NULL on the seven funding_source_id columns.
ALTER TABLE "line_items" ALTER COLUMN "funding_source_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ALTER COLUMN "funding_source_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "month_documents" ALTER COLUMN "funding_source_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "month_statuses" ALTER COLUMN "funding_source_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "month_snapshots" ALTER COLUMN "funding_source_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "month_snapshot_totals" ALTER COLUMN "funding_source_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "generated_artifacts" ALTER COLUMN "funding_source_id" SET NOT NULL;--> statement-breakpoint

-- 6. swap indexes/keys
DROP INDEX "line_items_org_name_uq";--> statement-breakpoint
DROP INDEX "line_items_org_sort_idx";--> statement-breakpoint
DROP INDEX "expenses_org_month_reference_uq";--> statement-breakpoint
DROP INDEX "month_documents_org_month_idx";--> statement-breakpoint
DROP INDEX "month_snapshots_line_item_uq";--> statement-breakpoint
DROP INDEX "month_snapshots_lookup_idx";--> statement-breakpoint
DROP INDEX "generated_artifacts_lookup_idx";--> statement-breakpoint
DROP INDEX "generated_artifacts_live_uq";--> statement-breakpoint
DROP INDEX "generated_artifacts_content_uq";--> statement-breakpoint
ALTER TABLE "month_statuses" DROP CONSTRAINT "month_statuses_org_id_month_pk";--> statement-breakpoint
ALTER TABLE "month_snapshot_totals" DROP CONSTRAINT "month_snapshot_totals_org_id_month_pk";--> statement-breakpoint
ALTER TABLE "month_statuses" ADD CONSTRAINT "month_statuses_org_id_funding_source_id_month_pk" PRIMARY KEY("org_id","funding_source_id","month");--> statement-breakpoint
ALTER TABLE "month_snapshot_totals" ADD CONSTRAINT "month_snapshot_totals_org_id_funding_source_id_month_pk" PRIMARY KEY("org_id","funding_source_id","month");--> statement-breakpoint
CREATE UNIQUE INDEX "line_items_id_source_uq" ON "line_items" USING btree ("id","funding_source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "line_items_source_name_uq" ON "line_items" USING btree ("funding_source_id",lower("name"));--> statement-breakpoint
CREATE INDEX "line_items_org_sort_idx" ON "line_items" USING btree ("org_id","funding_source_id","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "expenses_org_month_reference_uq" ON "expenses" USING btree ("org_id","funding_source_id","month","reference_seq");--> statement-breakpoint
CREATE INDEX "expenses_org_source_month_idx" ON "expenses" USING btree ("org_id","funding_source_id","month");--> statement-breakpoint
CREATE INDEX "month_documents_org_month_idx" ON "month_documents" USING btree ("org_id","funding_source_id","month","category","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "month_snapshots_line_item_uq" ON "month_snapshots" USING btree ("org_id","funding_source_id","month","line_item_name");--> statement-breakpoint
CREATE INDEX "month_snapshots_lookup_idx" ON "month_snapshots" USING btree ("org_id","funding_source_id","month");--> statement-breakpoint
CREATE INDEX "generated_artifacts_lookup_idx" ON "generated_artifacts" USING btree ("org_id","funding_source_id","month","type","line_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "generated_artifacts_live_uq" ON "generated_artifacts" USING btree ("org_id","funding_source_id","month","type",coalesce("line_item_id", '00000000-0000-0000-0000-000000000000'::uuid)) WHERE "generated_artifacts"."downloaded_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "generated_artifacts_content_uq" ON "generated_artifacts" USING btree ("org_id","funding_source_id","month","type",coalesce("line_item_id", '00000000-0000-0000-0000-000000000000'::uuid),"inputs_hash");--> statement-breakpoint

-- 7. foreign keys, added last
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_active_funding_source_id_funding_sources_id_fk" FOREIGN KEY ("active_funding_source_id") REFERENCES "public"."funding_sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "line_items" ADD CONSTRAINT "line_items_funding_source_id_org_id_funding_sources_id_org_id_fk" FOREIGN KEY ("funding_source_id","org_id") REFERENCES "public"."funding_sources"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "month_documents" ADD CONSTRAINT "month_documents_funding_source_id_org_id_funding_sources_id_org_id_fk" FOREIGN KEY ("funding_source_id","org_id") REFERENCES "public"."funding_sources"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "month_statuses" ADD CONSTRAINT "month_statuses_funding_source_id_org_id_funding_sources_id_org_id_fk" FOREIGN KEY ("funding_source_id","org_id") REFERENCES "public"."funding_sources"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "month_snapshots" ADD CONSTRAINT "month_snapshots_funding_source_id_org_id_funding_sources_id_org_id_fk" FOREIGN KEY ("funding_source_id","org_id") REFERENCES "public"."funding_sources"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "month_snapshot_totals" ADD CONSTRAINT "month_snapshot_totals_funding_source_id_org_id_funding_sources_id_org_id_fk" FOREIGN KEY ("funding_source_id","org_id") REFERENCES "public"."funding_sources"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_artifacts" ADD CONSTRAINT "generated_artifacts_funding_source_id_org_id_funding_sources_id_org_id_fk" FOREIGN KEY ("funding_source_id","org_id") REFERENCES "public"."funding_sources"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_funding_source_id_org_id_funding_sources_id_org_id_fk" FOREIGN KEY ("funding_source_id","org_id") REFERENCES "public"."funding_sources"("id","org_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_line_item_id_funding_source_id_line_items_id_funding_source_id_fk" FOREIGN KEY ("line_item_id","funding_source_id") REFERENCES "public"."line_items"("id","funding_source_id") ON DELETE no action ON UPDATE no action;
