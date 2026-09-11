CREATE TABLE "aggc-cash"."sales_orders" (
	"id" text PRIMARY KEY NOT NULL,
	"customer" text NOT NULL,
	"amount" bigint NOT NULL,
	"currency" text NOT NULL,
	"order_date" text NOT NULL,
	"due_date" text NOT NULL,
	"status" text NOT NULL,
	"customer_po" text,
	"operating_unit" text,
	"source" text DEFAULT 'oci-uk' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "aggc-cash"."purchase_orders" (
	"id" text PRIMARY KEY NOT NULL,
	"vendor" text NOT NULL,
	"amount" bigint NOT NULL,
	"currency" text NOT NULL,
	"order_date" text NOT NULL,
	"due_date" text NOT NULL,
	"status" text NOT NULL,
	"invoice_number" text,
	"po_numbers" text,
	"operating_unit" text,
	"country" text,
	"source" text DEFAULT 'oci-uk' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "aggc-cash"."remittances" (
	"id" text PRIMARY KEY NOT NULL,
	"party" text NOT NULL,
	"name" text NOT NULL,
	"reference" text DEFAULT '' NOT NULL,
	"amount" bigint NOT NULL,
	"currency" text NOT NULL,
	"date" text NOT NULL,
	"remittance_number" text,
	"invoice_numbers" text,
	"operating_unit" text,
	"status" text,
	"source" text DEFAULT 'oci-uk' NOT NULL
);
--> statement-breakpoint
CREATE INDEX "remittances_currency_date_idx" ON "aggc-cash"."remittances" USING btree ("currency","date");
