ALTER TABLE "aggc-cash"."sales_orders" ADD COLUMN "source_file" text;
--> statement-breakpoint
ALTER TABLE "aggc-cash"."sales_orders" ADD COLUMN "source_row" integer;
--> statement-breakpoint
ALTER TABLE "aggc-cash"."purchase_orders" ADD COLUMN "source_file" text;
--> statement-breakpoint
ALTER TABLE "aggc-cash"."purchase_orders" ADD COLUMN "source_row" integer;
--> statement-breakpoint
ALTER TABLE "aggc-cash"."remittances" ADD COLUMN "source_file" text;
--> statement-breakpoint
ALTER TABLE "aggc-cash"."remittances" ADD COLUMN "source_row" integer;
