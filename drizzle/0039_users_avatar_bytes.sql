-- Phase 15 (D-119): the stored size of each profile photo, so the storage quota counts it.
--
-- A constant default makes this a metadata-only change, but ADD COLUMN still takes ACCESS
-- EXCLUSIVE on `users`, which every sign-in and every session lookup reads. Fail fast rather
-- than queue: a deploy that cannot get the lock within 5 s aborts with the old app still
-- serving, and is simply re-run.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "avatar_bytes" integer DEFAULT 0 NOT NULL;
