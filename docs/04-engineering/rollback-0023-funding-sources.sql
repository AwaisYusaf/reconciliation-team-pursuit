-- Rollback for drizzle/0023_faulty_tyrannus.sql (multiple funding sources, D-93).
--
-- Use only together with rolling the APP back to the pre-feature commit (e5a0ff8 or earlier):
-- the new code cannot run on the old schema, and the old code cannot run on the new one.
--
-- Rehearsed 2026-09-11 on a copy of seed + fixture + edge-case data (docs/PHASE-6.md "Results"):
-- after 0023 then this file, every original table matched the pre-migration state row for row
-- and every index/primary key matched a database migrated only to 0022.
--
-- Run it as ONE transaction (psql: `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f <this file>`).
-- Take a backup first. It refuses to run once any organisation has a second funding source:
-- two sources' line items may share a name and their expenses may share a reference number in
-- one month, which the restored per-organisation unique indexes cannot hold.
--
-- What it carries back: contract details edited in Settings after the deploy (they now live on
-- the funding source) are copied into contract_settings, which the old code reads.
-- What it cannot carry back: tax/fee rules edited on the funding source after the deploy. The
-- old code reads them per payment source, whose pre-deploy values are still in place.

BEGIN;

-- 0. refuse once a second source exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM funding_sources GROUP BY org_id HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'rollback refused: an organisation has more than one funding source';
  END IF;
END $$;

-- 1. carry contract details back to the table the old code reads
UPDATE contract_settings cs SET
  project_name = fs.project_name,
  contract_number = fs.contract_number,
  base_po_number = fs.base_po_number,
  performance_po_number = fs.performance_po_number,
  contract_value_cents = fs.contract_value_cents,
  contract_start = fs.contract_start,
  contract_end = fs.contract_end,
  fiduciary_name = fs.fiduciary_name,
  advances_received_cents = fs.advances_received_cents
FROM funding_sources fs
WHERE fs.org_id = cs.org_id
  AND (cs.project_name, cs.contract_number, cs.base_po_number, cs.performance_po_number,
       cs.contract_value_cents, cs.contract_start, cs.contract_end, cs.fiduciary_name,
       cs.advances_received_cents)
      IS DISTINCT FROM
      (fs.project_name, fs.contract_number, fs.base_po_number, fs.performance_po_number,
       fs.contract_value_cents, fs.contract_start, fs.contract_end, fs.fiduciary_name,
       fs.advances_received_cents);

-- An org that never had a contract_settings row gets one only if its source now holds details;
-- otherwise the old code's "no row" defaults already mean the same thing.
INSERT INTO contract_settings (org_id, project_name, contract_number, base_po_number,
  performance_po_number, contract_value_cents, contract_start, contract_end, fiduciary_name,
  advances_received_cents)
SELECT fs.org_id, fs.project_name, fs.contract_number, fs.base_po_number,
  fs.performance_po_number, fs.contract_value_cents, fs.contract_start, fs.contract_end,
  fs.fiduciary_name, fs.advances_received_cents
FROM funding_sources fs
WHERE NOT EXISTS (SELECT 1 FROM contract_settings cs WHERE cs.org_id = fs.org_id)
  AND (fs.project_name <> '' OR fs.contract_number <> '' OR fs.base_po_number <> ''
       OR fs.performance_po_number <> '' OR fs.contract_value_cents <> 0
       OR fs.contract_start IS NOT NULL OR fs.contract_end IS NOT NULL
       OR fs.fiduciary_name <> '' OR fs.advances_received_cents <> 0);

-- 2. foreign keys added by 0023
ALTER TABLE expenses DROP CONSTRAINT "expenses_line_item_id_funding_source_id_line_items_id_funding_source_id_fk";
ALTER TABLE expenses DROP CONSTRAINT "expenses_funding_source_id_org_id_funding_sources_id_org_id_fk";
ALTER TABLE generated_artifacts DROP CONSTRAINT "generated_artifacts_funding_source_id_org_id_funding_sources_id_org_id_fk";
ALTER TABLE month_snapshot_totals DROP CONSTRAINT "month_snapshot_totals_funding_source_id_org_id_funding_sources_id_org_id_fk";
ALTER TABLE month_snapshots DROP CONSTRAINT "month_snapshots_funding_source_id_org_id_funding_sources_id_org_id_fk";
ALTER TABLE month_statuses DROP CONSTRAINT "month_statuses_funding_source_id_org_id_funding_sources_id_org_id_fk";
ALTER TABLE month_documents DROP CONSTRAINT "month_documents_funding_source_id_org_id_funding_sources_id_org_id_fk";
ALTER TABLE line_items DROP CONSTRAINT "line_items_funding_source_id_org_id_funding_sources_id_org_id_fk";
ALTER TABLE organizations DROP CONSTRAINT "organizations_active_funding_source_id_funding_sources_id_fk";

-- 3. indexes and primary keys added or reshaped by 0023
DROP INDEX line_items_id_source_uq;
DROP INDEX line_items_source_name_uq;
DROP INDEX line_items_org_sort_idx;
DROP INDEX expenses_org_month_reference_uq;
DROP INDEX expenses_org_source_month_idx;
DROP INDEX month_documents_org_month_idx;
DROP INDEX month_snapshots_line_item_uq;
DROP INDEX month_snapshots_lookup_idx;
DROP INDEX generated_artifacts_lookup_idx;
DROP INDEX generated_artifacts_live_uq;
DROP INDEX generated_artifacts_content_uq;
ALTER TABLE month_statuses DROP CONSTRAINT "month_statuses_org_id_funding_source_id_month_pk";
ALTER TABLE month_snapshot_totals DROP CONSTRAINT "month_snapshot_totals_org_id_funding_source_id_month_pk";

-- 4. columns added by 0023
ALTER TABLE line_items DROP COLUMN funding_source_id;
ALTER TABLE expenses DROP COLUMN funding_source_id;
ALTER TABLE month_documents DROP COLUMN funding_source_id;
ALTER TABLE month_statuses DROP COLUMN funding_source_id;
ALTER TABLE month_snapshots DROP COLUMN funding_source_id;
ALTER TABLE month_snapshot_totals DROP COLUMN funding_source_id;
ALTER TABLE generated_artifacts DROP COLUMN funding_source_id;
ALTER TABLE organizations DROP COLUMN active_funding_source_id;

-- 5. the original indexes and primary keys, verbatim from a database migrated to 0022
CREATE UNIQUE INDEX expenses_org_month_reference_uq ON public.expenses USING btree (org_id, month, reference_seq);
CREATE UNIQUE INDEX generated_artifacts_content_uq ON public.generated_artifacts USING btree (org_id, month, type, COALESCE(line_item_id, '00000000-0000-0000-0000-000000000000'::uuid), inputs_hash);
CREATE UNIQUE INDEX generated_artifacts_live_uq ON public.generated_artifacts USING btree (org_id, month, type, COALESCE(line_item_id, '00000000-0000-0000-0000-000000000000'::uuid)) WHERE (downloaded_at IS NULL);
CREATE INDEX generated_artifacts_lookup_idx ON public.generated_artifacts USING btree (org_id, month, type, line_item_id);
CREATE UNIQUE INDEX line_items_org_name_uq ON public.line_items USING btree (org_id, lower(name));
CREATE INDEX line_items_org_sort_idx ON public.line_items USING btree (org_id, sort_order);
CREATE INDEX month_documents_org_month_idx ON public.month_documents USING btree (org_id, month, category, sort_order);
CREATE UNIQUE INDEX month_snapshots_line_item_uq ON public.month_snapshots USING btree (org_id, month, line_item_name);
CREATE INDEX month_snapshots_lookup_idx ON public.month_snapshots USING btree (org_id, month);
ALTER TABLE month_statuses ADD CONSTRAINT "month_statuses_org_id_month_pk" PRIMARY KEY (org_id, month);
ALTER TABLE month_snapshot_totals ADD CONSTRAINT "month_snapshot_totals_org_id_month_pk" PRIMARY KEY (org_id, month);

-- 6. the table and its type
DROP TABLE funding_sources;
DROP TYPE public.funding_source_type;

-- 7. forget 0023 so a later deploy of the feature re-applies it (drizzle records a migration by
--    the journal's `when` for its entry: 1789123847775 for 0023_faulty_tyrannus).
DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1789123847775;

COMMIT;
