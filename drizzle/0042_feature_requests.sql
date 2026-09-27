-- PHASE-17 (D-127): feature requests. Three new tables and one new enum; nothing existing is
-- altered, so the only locks taken on existing tables are the foreign keys into `organizations`,
-- `users` and `staff_users` (SHARE ROW EXCLUSIVE, which blocks their writes while held).
--
-- Fail fast rather than queue behind a long request: a deploy that can't get a lock within 5 s
-- aborts with the old app still serving, and is simply re-run (same as 0039 to 0041).
--
-- Hand-ordered: `feature_requests_id_org_uq` is created before the replies' composite foreign
-- key that references it (drizzle-kit emits every index after every foreign key, and Postgres
-- refuses a foreign key with no unique index on its target), as in 0031.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
CREATE TYPE "public"."feature_request_status" AS ENUM('waiting_for_review', 'considering', 'planned', 'in_progress', 'released', 'not_planned', 'already_requested');--> statement-breakpoint
CREATE TABLE "feature_request_replies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"from_staff" boolean NOT NULL,
	"author_user_id" uuid,
	"author_staff_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feature_request_replies_body_ck" CHECK (char_length("feature_request_replies"."body") between 1 and 2000),
	CONSTRAINT "feature_request_replies_staff_ck" CHECK ("feature_request_replies"."from_staff" or "feature_request_replies"."author_staff_id" is null),
	CONSTRAINT "feature_request_replies_user_ck" CHECK (not "feature_request_replies"."from_staff" or "feature_request_replies"."author_user_id" is null)
);
--> statement-breakpoint
CREATE TABLE "feature_request_votes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"request_id" uuid NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feature_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"author_user_id" uuid,
	"title" text NOT NULL,
	"details" text NOT NULL,
	"original_title" text,
	"original_details" text,
	"status" "feature_request_status" DEFAULT 'waiting_for_review' NOT NULL,
	"shown_to_all_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feature_requests_title_ck" CHECK (char_length("feature_requests"."title") between 1 and 100),
	CONSTRAINT "feature_requests_details_ck" CHECK (char_length("feature_requests"."details") between 1 and 2000),
	CONSTRAINT "feature_requests_original_ck" CHECK (("feature_requests"."original_title" is null) = ("feature_requests"."original_details" is null)),
	CONSTRAINT "feature_requests_shown_status_ck" CHECK ("feature_requests"."shown_to_all_at" is null or "feature_requests"."status"::text not in ('waiting_for_review', 'already_requested'))
);
--> statement-breakpoint
ALTER TABLE "feature_request_replies" ADD CONSTRAINT "feature_request_replies_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_request_replies" ADD CONSTRAINT "feature_request_replies_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_request_replies" ADD CONSTRAINT "feature_request_replies_author_staff_id_staff_users_id_fk" FOREIGN KEY ("author_staff_id") REFERENCES "public"."staff_users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "feature_requests_id_org_uq" ON "feature_requests" USING btree ("id","org_id");--> statement-breakpoint
ALTER TABLE "feature_request_replies" ADD CONSTRAINT "feature_request_replies_request_id_org_id_feature_requests_id_org_id_fk" FOREIGN KEY ("request_id","org_id") REFERENCES "public"."feature_requests"("id","org_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_request_votes" ADD CONSTRAINT "feature_request_votes_request_id_feature_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."feature_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_request_votes" ADD CONSTRAINT "feature_request_votes_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_request_votes" ADD CONSTRAINT "feature_request_votes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_requests" ADD CONSTRAINT "feature_requests_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_requests" ADD CONSTRAINT "feature_requests_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feature_request_replies_request_idx" ON "feature_request_replies" USING btree ("request_id","created_at");--> statement-breakpoint
CREATE INDEX "feature_request_replies_org_idx" ON "feature_request_replies" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "feature_request_replies_author_idx" ON "feature_request_replies" USING btree ("author_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "feature_request_votes_request_user_uq" ON "feature_request_votes" USING btree ("request_id","user_id");--> statement-breakpoint
CREATE INDEX "feature_request_votes_org_idx" ON "feature_request_votes" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "feature_request_votes_user_idx" ON "feature_request_votes" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "feature_requests_org_idx" ON "feature_requests" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "feature_requests_author_idx" ON "feature_requests" USING btree ("author_user_id","created_at");
