-- Phase 14 review: a draft document must belong to the same organisation as its draft.
--
-- `expense_draft_documents` carried org_id and draft_id as two INDEPENDENT foreign keys, so a
-- row whose two parents disagreed was storable. `/api/files/[id]` scopes reads by this table's
-- own org_id, which means such a row would be served to the wrong tenant. Every other
-- grant-scoped table has carried the pair since D-93; this one was missed.
--
-- HAND-ORDERED, and the order is the whole point: drizzle-kit generated the ADD CONSTRAINT
-- before the CREATE UNIQUE INDEX it references, which Postgres rejects ("there is no unique
-- constraint matching given keys"). The index has to exist first. Regenerating this file
-- without re-checking the order will reintroduce that failure.
--
-- Fail fast rather than queue: ADD CONSTRAINT takes ACCESS EXCLUSIVE on
-- expense_draft_documents and a lock on expense_drafts, both of which the running app writes
-- to. A deploy that cannot get a lock within 5 s aborts with the old app still serving, and is
-- simply re-run.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
-- 1. The target the composite key points at. `id` is already the primary key, so this adds no
--    new guarantee about the data; it exists because a foreign key may only reference columns
--    covered by a unique index. Same shape and naming as `funding_sources_id_org_uq`.
CREATE UNIQUE INDEX "expense_drafts_id_org_uq" ON "expense_drafts" USING btree ("id","org_id");--> statement-breakpoint
-- 2. The old single-column key, dropped only once its replacement can be created.
ALTER TABLE "expense_draft_documents" DROP CONSTRAINT "expense_draft_documents_draft_id_expense_drafts_id_fk";--> statement-breakpoint
-- 3. The pair. Cascade is unchanged: discarding a draft still takes its documents with it.
ALTER TABLE "expense_draft_documents" ADD CONSTRAINT "expense_draft_documents_draft_id_org_id_expense_drafts_id_org_id_fk" FOREIGN KEY ("draft_id","org_id") REFERENCES "public"."expense_drafts"("id","org_id") ON DELETE cascade ON UPDATE no action;
