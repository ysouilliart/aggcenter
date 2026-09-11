CREATE TABLE "aggc-supplier"."supplier_vat_checks" (
	"id" text PRIMARY KEY NOT NULL,
	"site_id" text NOT NULL,
	"supplier_id" text NOT NULL,
	"vat_number" text NOT NULL,
	"country_code" text NOT NULL,
	"validity" text NOT NULL,
	"registered_name" text,
	"registered_address" text,
	"request_date" text,
	"name_match" text DEFAULT 'unknown' NOT NULL,
	"address_match" text DEFAULT 'unknown' NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"actor" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "supplier_vat_checks_site_idx" ON "aggc-supplier"."supplier_vat_checks" USING btree ("site_id");
