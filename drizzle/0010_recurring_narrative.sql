ALTER TABLE "recurring_items" ADD COLUMN "default_narrative" text;--> statement-breakpoint
ALTER TABLE "recurring_items" ADD COLUMN "default_payment_source" text;--> statement-breakpoint
ALTER TABLE "recurring_items" ADD COLUMN "default_tax_cents" bigint;--> statement-breakpoint
ALTER TABLE "recurring_items" ADD COLUMN "default_fees_cents" bigint;