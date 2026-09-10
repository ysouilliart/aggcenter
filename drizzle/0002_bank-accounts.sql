CREATE TABLE "aggc-cash"."bank_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"bank" text NOT NULL,
	"currency" text NOT NULL,
	"opening_balance" bigint DEFAULT 0 NOT NULL,
	"iban" text,
	"account_number" text,
	"bic" text
);
