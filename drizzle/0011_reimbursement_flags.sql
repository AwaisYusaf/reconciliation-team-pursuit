ALTER TABLE "expenses" ADD COLUMN "tax_reimbursable" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "fees_reimbursable" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_sources" ADD COLUMN "tax_reimbursable" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_sources" ADD COLUMN "fees_reimbursable" boolean DEFAULT true NOT NULL;