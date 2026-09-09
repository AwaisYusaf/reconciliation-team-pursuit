CREATE TYPE "public"."user_role" AS ENUM('admin', 'manager');--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "role" "user_role" NOT NULL DEFAULT 'admin';--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;
