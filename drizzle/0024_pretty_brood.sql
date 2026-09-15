CREATE TYPE "public"."tour_key" AS ENUM('dashboard', 'add_expense', 'recurring', 'packet');--> statement-breakpoint
CREATE TABLE "user_tour_progress" (
	"user_id" uuid NOT NULL,
	"tour" "tour_key" NOT NULL,
	"completed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_tour_progress_user_id_tour_pk" PRIMARY KEY("user_id","tour")
);
--> statement-breakpoint
ALTER TABLE "user_tour_progress" ADD CONSTRAINT "user_tour_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;