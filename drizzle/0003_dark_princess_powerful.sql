ALTER TABLE "generated_artifacts" DROP CONSTRAINT "generated_artifacts_line_item_id_line_items_id_fk";
--> statement-breakpoint
ALTER TABLE "generated_artifacts" ADD CONSTRAINT "generated_artifacts_line_item_id_line_items_id_fk" FOREIGN KEY ("line_item_id") REFERENCES "public"."line_items"("id") ON DELETE set null ON UPDATE no action;