-- D-118: who last saved a draft.
--
-- Each ADD CONSTRAINT ... REFERENCES "users" takes SHARE ROW EXCLUSIVE on `users` as well as on
-- `expense_drafts`, and validates every existing draft row while holding it. `users` is read on
-- every session lookup, so a migration queued behind a long transaction would stall sign-in for
-- everyone queued behind it. Fail fast instead: a deploy that cannot get the locks within 5 s
-- aborts with the old app still serving and is simply re-run. (Added after this migration first
-- shipped; drizzle tracks applied migrations by timestamp, so databases already past it are
-- unaffected.)
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "expense_drafts" ADD COLUMN "created_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "expense_drafts" ADD COLUMN "updated_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "expense_drafts" ADD CONSTRAINT "expense_drafts_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_drafts" ADD CONSTRAINT "expense_drafts_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;