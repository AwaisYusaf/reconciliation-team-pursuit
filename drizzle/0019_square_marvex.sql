ALTER TABLE "expense_audit_events" ADD COLUMN "before_data" jsonb;--> statement-breakpoint
ALTER TABLE "expense_audit_events" ADD COLUMN "after_data" jsonb;