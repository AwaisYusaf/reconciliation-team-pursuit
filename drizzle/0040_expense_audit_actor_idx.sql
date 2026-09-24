-- Phase 15: index the audit log by actor, for "has this person ever acted on an expense?"
-- (the Users page, account delete, and Postgres's own foreign-key check on every user delete).
--
-- Not CONCURRENTLY: drizzle runs every pending migration inside one transaction, where CREATE
-- INDEX CONCURRENTLY is refused. A plain build blocks writes to `expense_audit_events` for as
-- long as it takes, which at this table's size (one row per expense change, one organisation)
-- is well under a second. The lock timeout makes a deploy that meets a long transaction abort
-- with the old app still serving, rather than queue every expense save behind it.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
CREATE INDEX "expense_audit_events_actor_idx" ON "expense_audit_events" USING btree ("actor_user_id");