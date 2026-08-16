ALTER TABLE "expenses" ADD COLUMN "recurring_item_id" uuid;--> statement-breakpoint
CREATE INDEX "expenses_recurring_idx" ON "expenses" USING btree ("recurring_item_id");