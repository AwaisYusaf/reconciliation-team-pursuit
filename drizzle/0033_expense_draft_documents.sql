-- Phase 14: files attached to a draft before it is an expense. The object is stored once and
-- approval re-points it at the new expense rather than uploading it again.
--
-- Fail fast rather than queue: the foreign keys take locks on organizations and expense_drafts.
SET LOCAL lock_timeout = '5s';--> statement-breakpoint
CREATE TABLE "expense_draft_documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"draft_id" uuid NOT NULL,
	"kind" "document_kind" NOT NULL,
	"supporting_type" text,
	"status" "document_status" DEFAULT 'pending' NOT NULL,
	"s3_key" text NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" bigint DEFAULT 0 NOT NULL,
	"thumbnail_bytes" integer DEFAULT 0 NOT NULL,
	"page_count" integer,
	"width_px" integer,
	"height_px" integer,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expense_draft_documents_supporting_type_ck" CHECK (("expense_draft_documents"."kind" = 'supporting') = ("expense_draft_documents"."supporting_type" is not null))
);
--> statement-breakpoint
ALTER TABLE "expense_draft_documents" ADD CONSTRAINT "expense_draft_documents_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_draft_documents" ADD CONSTRAINT "expense_draft_documents_draft_id_expense_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."expense_drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expense_draft_documents_draft_idx" ON "expense_draft_documents" USING btree ("draft_id","kind","sort_order");--> statement-breakpoint
CREATE INDEX "expense_draft_documents_org_idx" ON "expense_draft_documents" USING btree ("org_id");