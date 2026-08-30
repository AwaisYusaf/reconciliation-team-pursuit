ALTER TABLE "expenses" ADD COLUMN "reference_seq" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Number the existing rows before the unique index goes on, or every month holding more than
-- one expense fails the index on the shared default of 0.
--
-- Ordered by (sort_order, id) so the numbering matches the order these expenses already
-- appear in on the month list, the cover sheets and the packet — the reference an auditor
-- reads counts down the page rather than jumping about. `id` breaks the ties that sort_order
-- allows, which is the same tiebreak packet-order.ts uses.
UPDATE "expenses" AS e
SET "reference_seq" = numbered.seq
FROM (
  SELECT "id", row_number() OVER (
    PARTITION BY "org_id", "month" ORDER BY "sort_order", "id"
  ) AS seq
  FROM "expenses"
) AS numbered
WHERE e."id" = numbered."id";--> statement-breakpoint
CREATE UNIQUE INDEX "expenses_org_month_reference_uq" ON "expenses" USING btree ("org_id","month","reference_seq");
