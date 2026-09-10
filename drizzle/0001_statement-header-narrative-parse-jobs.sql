CREATE TABLE "aggc-cash"."parse_events" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"seq" integer NOT NULL,
	"level" text NOT NULL,
	"stage" text NOT NULL,
	"message" text NOT NULL,
	"page" integer,
	"line" integer,
	"detail" text
);
--> statement-breakpoint
CREATE TABLE "aggc-cash"."parse_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"statement_id" text NOT NULL,
	"storage_key" text,
	"parser_id" text NOT NULL,
	"parser_version" text NOT NULL,
	"status" text NOT NULL,
	"started_at" text NOT NULL,
	"finished_at" text NOT NULL,
	"transaction_count" integer NOT NULL,
	"warning_count" integer DEFAULT 0 NOT NULL,
	"skipped_noise" integer DEFAULT 0 NOT NULL,
	"skipped_unparsed" integer DEFAULT 0 NOT NULL,
	"page_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "aggc-cash"."bank_transactions" ADD COLUMN "narrative" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "aggc-cash"."bank_transactions" ADD COLUMN "post_date" text;--> statement-breakpoint
ALTER TABLE "aggc-cash"."bank_transactions" ADD COLUMN "value_date" text;--> statement-breakpoint
ALTER TABLE "aggc-cash"."bank_transactions" ADD COLUMN "trn_type" text;--> statement-breakpoint
ALTER TABLE "aggc-cash"."bank_transactions" ADD COLUMN "customer_reference" text;--> statement-breakpoint
ALTER TABLE "aggc-cash"."bank_transactions" ADD COLUMN "bank_reference" text;--> statement-breakpoint
ALTER TABLE "aggc-cash"."bank_transactions" ADD COLUMN "debit_amount" bigint;--> statement-breakpoint
ALTER TABLE "aggc-cash"."bank_transactions" ADD COLUMN "credit_amount" bigint;--> statement-breakpoint
ALTER TABLE "aggc-cash"."bank_transactions" ADD COLUMN "page_number" integer;--> statement-breakpoint
ALTER TABLE "aggc-cash"."bank_transactions" ADD COLUMN "line_number" integer;--> statement-breakpoint
ALTER TABLE "aggc-cash"."statements" ADD COLUMN "bank_code" text;--> statement-breakpoint
ALTER TABLE "aggc-cash"."statements" ADD COLUMN "parser_id" text;--> statement-breakpoint
ALTER TABLE "aggc-cash"."statements" ADD COLUMN "parser_version" text;--> statement-breakpoint
ALTER TABLE "aggc-cash"."statements" ADD COLUMN "parse_status" text DEFAULT 'parsed' NOT NULL;--> statement-breakpoint
ALTER TABLE "aggc-cash"."statements" ADD COLUMN "account_name" text;--> statement-breakpoint
ALTER TABLE "aggc-cash"."statements" ADD COLUMN "account_number" text;--> statement-breakpoint
ALTER TABLE "aggc-cash"."statements" ADD COLUMN "sort_code" text;--> statement-breakpoint
ALTER TABLE "aggc-cash"."statements" ADD COLUMN "iban" text;--> statement-breakpoint
ALTER TABLE "aggc-cash"."statements" ADD COLUMN "bic" text;--> statement-breakpoint
ALTER TABLE "aggc-cash"."statements" ADD COLUMN "bank_name" text;--> statement-breakpoint
ALTER TABLE "aggc-cash"."statements" ADD COLUMN "account_type" text;--> statement-breakpoint
ALTER TABLE "aggc-cash"."statements" ADD COLUMN "account_status" text;--> statement-breakpoint
ALTER TABLE "aggc-cash"."statements" ADD COLUMN "location" text;--> statement-breakpoint
ALTER TABLE "aggc-cash"."statements" ADD COLUMN "currency" text;--> statement-breakpoint
ALTER TABLE "aggc-cash"."statements" ADD COLUMN "statement_date" text;--> statement-breakpoint
ALTER TABLE "aggc-cash"."statements" ADD COLUMN "current_balance_as_at" text;--> statement-breakpoint
ALTER TABLE "aggc-cash"."statements" ADD COLUMN "brought_forward_from" text;--> statement-breakpoint
ALTER TABLE "aggc-cash"."statements" ADD COLUMN "current_available_balance" bigint;--> statement-breakpoint
ALTER TABLE "aggc-cash"."statements" ADD COLUMN "current_ledger_balance" bigint;--> statement-breakpoint
ALTER TABLE "aggc-cash"."statements" ADD COLUMN "closing_available_brought_forward" bigint;--> statement-breakpoint
ALTER TABLE "aggc-cash"."statements" ADD COLUMN "closing_ledger_brought_forward" bigint;--> statement-breakpoint
ALTER TABLE "aggc-cash"."statements" ADD COLUMN "page_count" integer;--> statement-breakpoint
CREATE INDEX "parse_events_job_id_idx" ON "aggc-cash"."parse_events" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "parse_jobs_statement_id_idx" ON "aggc-cash"."parse_jobs" USING btree ("statement_id");--> statement-breakpoint
CREATE INDEX "bank_transactions_statement_id_idx" ON "aggc-cash"."bank_transactions" USING btree ("statement_id");