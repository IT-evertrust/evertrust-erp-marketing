CREATE TYPE "public"."rfq_status" AS ENUM('DISPATCHED', 'FAILED');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rfqs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"tender_id" uuid NOT NULL,
	"supplier_ids" uuid[] DEFAULT '{}' NOT NULL,
	"line_item_ids" uuid[] DEFAULT '{}' NOT NULL,
	"note" text,
	"status" "rfq_status" NOT NULL,
	"detail" text,
	"dispatched_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rfqs" ADD CONSTRAINT "rfqs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rfqs" ADD CONSTRAINT "rfqs_tender_id_tenders_id_fk" FOREIGN KEY ("tender_id") REFERENCES "public"."tenders"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rfqs" ADD CONSTRAINT "rfqs_dispatched_by_users_id_fk" FOREIGN KEY ("dispatched_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rfqs_organization_id_idx" ON "rfqs" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rfqs_tender_id_idx" ON "rfqs" USING btree ("tender_id");
