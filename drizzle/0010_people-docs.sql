CREATE SCHEMA "aggc-people";
--> statement-breakpoint
CREATE TABLE "aggc-people"."people_docs" (
	"id" text PRIMARY KEY NOT NULL,
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
	"confidence" integer DEFAULT 0 NOT NULL,
	"page_count" integer,
	"review_reason" text,
	"extracted_text" text,
	"classify_mode" text,
	"classifier_warning" text,
	"needs_confirm" boolean DEFAULT false NOT NULL,
	"uploaded_at" text NOT NULL,
	"processed_at" text,
	"archived_at" text,
	"agreement_id" text,
	"requestor" text,
	"agreement_type" text,
	"agreement_sub_type" text,
	"business_function" text,
	"resmed_entity" text,
	"start_date" text,
	"end_date" text,
	"auto_renew" boolean,
	"perpetual" boolean,
	"fields_json" text,
	"job_json" text
);
--> statement-breakpoint
CREATE INDEX "people_docs_folder_idx" ON "aggc-people"."people_docs" USING btree ("folder");
--> statement-breakpoint
CREATE INDEX "people_docs_storage_key_idx" ON "aggc-people"."people_docs" USING btree ("storage_key");
--> statement-breakpoint
CREATE INDEX "people_docs_content_hash_idx" ON "aggc-people"."people_docs" USING btree ("content_hash");
