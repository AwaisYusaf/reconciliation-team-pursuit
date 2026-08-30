ALTER TABLE "month_statuses" ADD COLUMN "next_reference_seq" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
-- Seed the counter past every reference already issued, including for months that have no
-- month_statuses row yet. Without this the first expense saved into an existing month would
-- be handed 1, collide with the row that already holds it, and fail the unique index.
INSERT INTO "month_statuses" ("org_id", "month", "next_reference_seq")
SELECT "org_id", "month", MAX("reference_seq") + 1
FROM "expenses"
GROUP BY "org_id", "month"
ON CONFLICT ("org_id", "month") DO UPDATE
  SET "next_reference_seq" = EXCLUDED."next_reference_seq";
