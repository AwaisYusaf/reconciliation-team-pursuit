CREATE TYPE "public"."expense_audit_action" AS ENUM('created', 'edited', 'deleted', 'restored', 'permanently_deleted');--> statement-breakpoint
CREATE TABLE "expense_audit_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"expense_id" uuid,
	"actor_user_id" uuid NOT NULL,
	"action" "expense_audit_action" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "expense_audit_events" ADD CONSTRAINT "expense_audit_events_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_audit_events" ADD CONSTRAINT "expense_audit_events_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_audit_events" ADD CONSTRAINT "expense_audit_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expense_audit_events_expense_idx" ON "expense_audit_events" USING btree ("expense_id","created_at");