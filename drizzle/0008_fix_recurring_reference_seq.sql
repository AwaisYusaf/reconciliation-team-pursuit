-- The recurring one-click add inserted expenses without a reference, so they took the column
-- default 0 — which is why a second add into the same month collided on
-- `expenses_org_month_reference_uq`. Renumber whatever the bug left behind before the column
-- can refuse 0, or this migration would abort on the CHECK below.

-- 1. Make sure every affected month has a counter, and that it is past every reference the
--    month already uses. GREATEST also repairs a counter that had fallen behind.
INSERT INTO "month_statuses" ("org_id", "month", "next_reference_seq")
SELECT z."org_id",
       z."month",
       (SELECT COALESCE(MAX(e."reference_seq"), 0) + 1
          FROM "expenses" e
         WHERE e."org_id" = z."org_id" AND e."month" = z."month")
FROM (SELECT DISTINCT "org_id", "month" FROM "expenses" WHERE "reference_seq" = 0) z
ON CONFLICT ("org_id", "month") DO UPDATE
  SET "next_reference_seq" = GREATEST(
        "month_statuses"."next_reference_seq",
        EXCLUDED."next_reference_seq"
      );--> statement-breakpoint

-- 2. Hand each zero row that month's next number. At most one row per (org, month) can be 0 —
--    the unique index guaranteed it — so no two rows can be given the same value here.
UPDATE "expenses" e
SET "reference_seq" = ms."next_reference_seq"
FROM "month_statuses" ms
WHERE ms."org_id" = e."org_id"
  AND ms."month" = e."month"
  AND e."reference_seq" = 0;--> statement-breakpoint

-- 3. Advance past what step 2 just consumed. A month nothing was renumbered in has no expense
--    sitting on its counter value, so it is left alone.
UPDATE "month_statuses" ms
SET "next_reference_seq" = ms."next_reference_seq" + 1
WHERE EXISTS (
  SELECT 1 FROM "expenses" e
  WHERE e."org_id" = ms."org_id"
    AND e."month" = ms."month"
    AND e."reference_seq" = ms."next_reference_seq"
);--> statement-breakpoint

-- No default: omitting the reference is now a type error in Drizzle rather than two rows
-- silently landing on the same number (R2.6).
ALTER TABLE "expenses" ALTER COLUMN "reference_seq" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_reference_seq_ck" CHECK ("expenses"."reference_seq" >= 1);
