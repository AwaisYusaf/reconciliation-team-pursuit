CREATE TABLE "line_item_performances" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"line_item_id" uuid NOT NULL,
	"amount_cents" bigint DEFAULT 0 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "line_item_performances_amount_ck" CHECK ("line_item_performances"."amount_cents" > 0)
);
--> statement-breakpoint
ALTER TABLE "line_item_performances" ADD CONSTRAINT "line_item_performances_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "line_item_performances" ADD CONSTRAINT "line_item_performances_line_item_id_line_items_id_fk" FOREIGN KEY ("line_item_id") REFERENCES "public"."line_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "line_item_performances_line_item_idx" ON "line_item_performances" USING btree ("line_item_id");--> statement-breakpoint

-- The Performance Grant (R7.2) is retired as a hand-maintained Settings figure in favor of
-- per-line-item performances (m08): any real amount sitting in the two columns below is moved
-- into a real line item before they are dropped, so nothing is lost. This must run before the
-- DROP COLUMN statements at the end of this file, which is why it comes first.
DO $$
DECLARE
  org RECORD;
  new_line_item_id uuid;
  candidate_name text;
  suffix int;
BEGIN
  FOR org IN
    SELECT org_id, perf_grant_scheduled_cents, perf_grant_billed_cents
    FROM contract_settings
    WHERE perf_grant_scheduled_cents > 0 OR perf_grant_billed_cents > 0
  LOOP
    -- Case-insensitive name collision (line_items_org_name_uq / R9.1): fall back to
    -- "Performance Grant 1 (2)", "(3)", etc. rather than aborting the whole migration.
    candidate_name := 'Performance Grant 1';
    suffix := 2;
    WHILE EXISTS (
      SELECT 1 FROM line_items
      WHERE org_id = org.org_id AND lower(name) = lower(candidate_name)
    ) LOOP
      candidate_name := 'Performance Grant 1 (' || suffix || ')';
      suffix := suffix + 1;
    END LOOP;

    new_line_item_id := gen_random_uuid();

    -- The old billed-to-date figure becomes real opening balance (R3.1) — exactly what that
    -- column already means: billed before this line item existed in the system.
    INSERT INTO line_items
      (id, org_id, name, scheduled_value_cents, opening_billed_cents, sort_order, created_at, updated_at)
    VALUES (
      new_line_item_id,
      org.org_id,
      candidate_name,
      0,
      org.perf_grant_billed_cents,
      (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM line_items WHERE org_id = org.org_id),
      now(),
      now()
    );

    -- Guarded separately: an org could in principle have only a billed figure with nothing
    -- scheduled, and `line_item_performances_amount_ck` requires a strictly positive amount.
    IF org.perf_grant_scheduled_cents > 0 THEN
      INSERT INTO line_item_performances (id, org_id, line_item_id, amount_cents, sort_order, created_at)
      VALUES (gen_random_uuid(), org.org_id, new_line_item_id, org.perf_grant_scheduled_cents, 0, now());
    END IF;
  END LOOP;
END $$;--> statement-breakpoint

ALTER TABLE "contract_settings" DROP COLUMN "perf_grant_scheduled_cents";--> statement-breakpoint
ALTER TABLE "contract_settings" DROP COLUMN "perf_grant_billed_cents";
