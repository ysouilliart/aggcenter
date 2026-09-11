CREATE SCHEMA "aggc-supplier";
--> statement-breakpoint
CREATE TABLE "aggc-supplier"."suppliers" (
	"id" text PRIMARY KEY NOT NULL,
	"supplier_number" text DEFAULT '' NOT NULL,
	"name" text NOT NULL,
	"type" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"supplier_vat" text DEFAULT '' NOT NULL,
	"tax_registration_number" text DEFAULT '' NOT NULL,
	"taxpayer_id" text DEFAULT '' NOT NULL,
	"one_time" text DEFAULT 'N' NOT NULL,
	"inactive_date" text,
	"source" text DEFAULT 'oci-supplier' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "aggc-supplier"."supplier_sites" (
	"id" text PRIMARY KEY NOT NULL,
	"supplier_id" text NOT NULL,
	"site_code" text DEFAULT '' NOT NULL,
	"address_name" text DEFAULT '' NOT NULL,
	"procurement_bu" text DEFAULT '' NOT NULL,
	"operating_unit" text,
	"inactive_date" text,
	"payment_terms" text DEFAULT '' NOT NULL,
	"pay_group" text DEFAULT '' NOT NULL,
	"payment_method" text DEFAULT '' NOT NULL,
	"invoice_currency" text DEFAULT '' NOT NULL,
	"payment_currency" text DEFAULT '' NOT NULL,
	"country" text DEFAULT '' NOT NULL,
	"address_line_1" text DEFAULT '' NOT NULL,
	"address_line_2" text,
	"city" text DEFAULT '' NOT NULL,
	"state" text,
	"province" text,
	"county" text,
	"postal_code" text DEFAULT '' NOT NULL,
	"site_vat" text DEFAULT '' NOT NULL,
	"email" text,
	"source" text DEFAULT 'oci-supplier' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "aggc-supplier"."supplier_record_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"record_type" text NOT NULL,
	"record_id" text NOT NULL,
	"version" integer NOT NULL,
	"snapshot" text NOT NULL,
	"created_at" text NOT NULL,
	"actor" text NOT NULL,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "aggc-supplier"."supplier_audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"record_type" text NOT NULL,
	"record_id" text NOT NULL,
	"action" text NOT NULL,
	"field" text,
	"old_value" text,
	"new_value" text,
	"actor" text NOT NULL,
	"reason" text,
	"created_at" text NOT NULL,
	"version" integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX "suppliers_number_idx" ON "aggc-supplier"."suppliers" USING btree ("supplier_number");
--> statement-breakpoint
CREATE INDEX "supplier_sites_supplier_id_idx" ON "aggc-supplier"."supplier_sites" USING btree ("supplier_id");
--> statement-breakpoint
CREATE INDEX "supplier_record_versions_record_idx" ON "aggc-supplier"."supplier_record_versions" USING btree ("record_type","record_id");
--> statement-breakpoint
CREATE INDEX "supplier_audit_events_record_idx" ON "aggc-supplier"."supplier_audit_events" USING btree ("record_type","record_id");
