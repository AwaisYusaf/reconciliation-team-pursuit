ALTER TABLE "expense_documents" ADD COLUMN "thumbnail_bytes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "month_documents" ADD COLUMN "thumbnail_bytes" integer DEFAULT 0 NOT NULL;