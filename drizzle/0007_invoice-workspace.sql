CREATE SCHEMA "aggc-invoice";
--> statement-breakpoint
CREATE TABLE "aggc-invoice"."invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"invoice_number" text DEFAULT '' NOT NULL,
	"invoice_date" text,
	"issue_date" text,
	"due_date" text,
	"payment_terms" text,
	"currency" text DEFAULT '' NOT NULL,
	"subtotal" bigint,
	"tax_total" bigint,
	"total" bigint,
	"amount_due" bigint,
	"po_number" text,
	"account_number" text,
	"reference_number" text,
	"customer_number" text,
	"customer_name" text,
	"customer_address" text,
	"customer_email" text,
	"supplier_name" text DEFAULT '' NOT NULL,
	"supplier_legal_name" text,
	"supplier_tax_id" text,
	"supplier_vat" text,
	"supplier_address" text,
	"supplier_country" text,
	"supplier_email" text,
	"supplier_phone" text,
	"supplier_website" text,
	"notes" text,
	"extra_json" text,
	"file_name" text NOT NULL,
	"mime_type" text DEFAULT 'application/octet-stream' NOT NULL,
	"content_hash" text DEFAULT '' NOT NULL,
	"source" text DEFAULT 'upload' NOT NULL,
	"folder" text DEFAULT 'landing' NOT NULL,
	"storage_key" text,
	"original_key" text,
	"parse_status" text DEFAULT 'parsed' NOT NULL,
	"parser_id" text,
	"parser_version" text,
	"vendor" text,
	"confidence" integer DEFAULT 0 NOT NULL,
	"page_count" integer,
	"review_reason" text,
	"extracted_text" text,
	"uploaded_at" text NOT NULL,
	"processed_at" text,
	"archived_at" text
);
--> statement-breakpoint
CREATE TABLE "aggc-invoice"."invoice_line_items" (
	"id" text PRIMARY KEY NOT NULL,
	"invoice_id" text NOT NULL,
	"line_number" integer NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"quantity" text,
	"unit" text,
	"unit_price" bigint,
	"tax_rate" integer,
	"tax_amount" bigint,
	"line_total" bigint,
	"period_start" text,
	"period_end" text,
	"extra_json" text
);
--> statement-breakpoint
CREATE TABLE "aggc-invoice"."invoice_tax_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"invoice_id" text NOT NULL,
	"label" text NOT NULL,
	"rate" integer,
	"taxable_amount" bigint,
	"tax_amount" bigint
);
--> statement-breakpoint
CREATE TABLE "aggc-invoice"."invoice_bank_details" (
	"id" text PRIMARY KEY NOT NULL,
	"invoice_id" text NOT NULL,
	"bank_name" text,
	"account_name" text,
	"account_number" text,
	"bsb" text,
	"iban" text,
	"bic" text,
	"biller_code" text,
	"bpay_reference" text,
	"payment_method" text,
	"extra_json" text
);
--> statement-breakpoint
CREATE TABLE "aggc-invoice"."invoice_fields" (
	"id" text PRIMARY KEY NOT NULL,
	"invoice_id" text NOT NULL,
	"category" text NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"confidence" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "aggc-invoice"."invoice_parse_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"invoice_id" text NOT NULL,
	"storage_key" text,
	"parser_id" text NOT NULL,
	"parser_version" text NOT NULL,
	"status" text NOT NULL,
	"started_at" text NOT NULL,
	"finished_at" text NOT NULL,
	"line_item_count" integer DEFAULT 0 NOT NULL,
	"warning_count" integer DEFAULT 0 NOT NULL,
	"page_count" integer DEFAULT 0 NOT NULL,
	"confidence" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "aggc-invoice"."invoice_parse_events" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"seq" integer NOT NULL,
	"level" text NOT NULL,
	"stage" text NOT NULL,
	"message" text NOT NULL,
	"page" integer,
	"detail" text
);
--> statement-breakpoint
CREATE INDEX "invoices_folder_idx" ON "aggc-invoice"."invoices" USING btree ("folder");
--> statement-breakpoint
CREATE INDEX "invoices_storage_key_idx" ON "aggc-invoice"."invoices" USING btree ("storage_key");
--> statement-breakpoint
CREATE INDEX "invoices_content_hash_idx" ON "aggc-invoice"."invoices" USING btree ("content_hash");
--> statement-breakpoint
CREATE INDEX "invoice_line_items_invoice_id_idx" ON "aggc-invoice"."invoice_line_items" USING btree ("invoice_id");
--> statement-breakpoint
CREATE INDEX "invoice_tax_lines_invoice_id_idx" ON "aggc-invoice"."invoice_tax_lines" USING btree ("invoice_id");
--> statement-breakpoint
CREATE INDEX "invoice_bank_details_invoice_id_idx" ON "aggc-invoice"."invoice_bank_details" USING btree ("invoice_id");
--> statement-breakpoint
CREATE INDEX "invoice_fields_invoice_id_idx" ON "aggc-invoice"."invoice_fields" USING btree ("invoice_id");
--> statement-breakpoint
CREATE INDEX "invoice_parse_jobs_invoice_id_idx" ON "aggc-invoice"."invoice_parse_jobs" USING btree ("invoice_id");
--> statement-breakpoint
CREATE INDEX "invoice_parse_events_job_id_idx" ON "aggc-invoice"."invoice_parse_events" USING btree ("job_id");
