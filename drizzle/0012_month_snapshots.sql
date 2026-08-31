CREATE TABLE "month_snapshot_totals" (
	"org_id" uuid NOT NULL,
	"month" char(7) NOT NULL,
	"contract_value_cents" bigint DEFAULT 0 NOT NULL,
	"perf_grant_scheduled_cents" bigint DEFAULT 0 NOT NULL,
	"perf_grant_billed_cents" bigint DEFAULT 0 NOT NULL,
	"advances_received_cents" bigint DEFAULT 0 NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "month_snapshot_totals_org_id_month_pk" PRIMARY KEY("org_id","month")
);
--> statement-breakpoint
CREATE TABLE "month_snapshots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"month" char(7) NOT NULL,
	"line_item_id" uuid,
	"line_item_name" text NOT NULL,
	"scheduled_value_cents" bigint DEFAULT 0 NOT NULL,
	"previously_billed_cents" bigint DEFAULT 0 NOT NULL,
	"spent_this_month_cents" bigint DEFAULT 0 NOT NULL,
	"total_billed_cents" bigint DEFAULT 0 NOT NULL,
	"remaining_cents" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "month_snapshot_totals" ADD CONSTRAINT "month_snapshot_totals_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "month_snapshots" ADD CONSTRAINT "month_snapshots_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "month_snapshots" ADD CONSTRAINT "month_snapshots_line_item_id_line_items_id_fk" FOREIGN KEY ("line_item_id") REFERENCES "public"."line_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "month_snapshots_line_item_uq" ON "month_snapshots" USING btree ("org_id","month","line_item_name");--> statement-breakpoint
CREATE INDEX "month_snapshots_lookup_idx" ON "month_snapshots" USING btree ("org_id","month");