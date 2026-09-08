CREATE SCHEMA "aggc-cash";
--> statement-breakpoint
CREATE TABLE "aggc-cash"."bank_transactions" (
	"id" text PRIMARY KEY NOT NULL,
	"statement_id" text NOT NULL,
	"account_id" text NOT NULL,
	"date" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"reference" text,
	"counterparty" text,
	"amount" bigint NOT NULL,
	"currency" text NOT NULL,
	"balance_after" bigint
);
--> statement-breakpoint
CREATE TABLE "aggc-cash"."statements" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"file_name" text NOT NULL,
	"source" text NOT NULL,
	"period_start" text NOT NULL,
	"period_end" text NOT NULL,
	"transaction_count" integer NOT NULL,
	"storage_key" text,
	"uploaded_at" text
);
