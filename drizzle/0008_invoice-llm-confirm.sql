ALTER TABLE "aggc-invoice"."invoices" ADD COLUMN "classify_mode" text;
--> statement-breakpoint
ALTER TABLE "aggc-invoice"."invoices" ADD COLUMN "classifier_warning" text;
--> statement-breakpoint
ALTER TABLE "aggc-invoice"."invoices" ADD COLUMN "needs_confirm" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "aggc-invoice"."invoices" ADD COLUMN "confirmed_at" text;
--> statement-breakpoint
ALTER TABLE "aggc-invoice"."invoices" ADD COLUMN "confirmed_by" text;
--> statement-breakpoint
ALTER TABLE "aggc-invoice"."invoices" ADD COLUMN "confirm_action" text;
--> statement-breakpoint
CREATE TABLE "aggc-invoice"."invoice_confirm_events" (
	"id" text PRIMARY KEY NOT NULL,
	"invoice_id" text NOT NULL,
	"action" text NOT NULL,
	"field" text,
	"old_value" text,
	"new_value" text,
	"actor" text NOT NULL,
	"reason" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "invoice_confirm_events_invoice_id_idx" ON "aggc-invoice"."invoice_confirm_events" USING btree ("invoice_id");
