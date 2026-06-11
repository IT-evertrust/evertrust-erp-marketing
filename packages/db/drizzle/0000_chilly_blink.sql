CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TYPE "public"."approval_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."approval_type" AS ENUM('PRICING', 'CUSTOMER', 'QC');--> statement-breakpoint
CREATE TYPE "public"."audit_actor_type" AS ENUM('USER', 'SYSTEM', 'N8N', 'DEEPSEEK', 'CLAUDE');--> statement-breakpoint
CREATE TYPE "public"."document_type" AS ENUM('TYPE1', 'TYPE2');--> statement-breakpoint
CREATE TYPE "public"."lane" AS ENUM('OPERATIONS', 'MARKETING', 'HR');--> statement-breakpoint
CREATE TYPE "public"."ocr_status" AS ENUM('PENDING', 'DONE', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."price_obs_source" AS ENUM('SUPPLIER_QUOTE', 'MANUAL', 'AI_ESTIMATE', 'COMPETITOR_WINNER', 'OUR_SUBMITTED', 'OUR_BENCHMARK', 'IBAU_HISTORICAL');--> statement-breakpoint
CREATE TYPE "public"."pricing_status" AS ENUM('DRAFT', 'REVIEW', 'FINAL');--> statement-breakpoint
CREATE TYPE "public"."tender_regime" AS ENUM('VOB_A', 'VgV', 'UVgO');--> statement-breakpoint
CREATE TYPE "public"."tender_status" AS ENUM('NOT_STARTED', 'PIC_PRICING', 'CUSTOMER_PRICING', 'DOCUMENTS', 'SUBMITTED', 'AWARDED', 'LOST');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('L1', 'L2', 'L3', 'L4', 'L5');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "amendments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tender_id" uuid NOT NULL,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"diff" jsonb NOT NULL,
	"affects_deadline" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tender_id" uuid NOT NULL,
	"pic_id" uuid NOT NULL,
	"workload_score" numeric NOT NULL,
	"reason" text,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"contact" text,
	"niches" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tender_id" uuid NOT NULL,
	"type" "document_type" NOT NULL,
	"kind" text,
	"storage_url" text NOT NULL,
	"original_name" text NOT NULL,
	"mime_type" text,
	"size_bytes" integer,
	"ocr_status" "ocr_status" DEFAULT 'PENDING' NOT NULL,
	"ocr_text" text,
	"parsed_ref" text,
	"source_parent_doc_id" uuid,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"niches" text[] DEFAULT '{}' NOT NULL,
	"capabilities" text[] DEFAULT '{}' NOT NULL,
	"fit_score" numeric,
	"contact" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "tenders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"vergabe_id" text NOT NULL,
	"source" text NOT NULL,
	"title" text NOT NULL,
	"buyer" text,
	"customer_id" uuid,
	"regime" "tender_regime",
	"niche" text,
	"status" "tender_status" DEFAULT 'NOT_STARTED' NOT NULL,
	"estimated_value" numeric,
	"currency" varchar(3) DEFAULT 'EUR' NOT NULL,
	"is_above_threshold" boolean DEFAULT false NOT NULL,
	"questions_deadline_at" timestamp with time zone,
	"submission_deadline_at" timestamp with time zone,
	"location" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"role" "user_role" DEFAULT 'L5' NOT NULL,
	"lane" "lane" DEFAULT 'OPERATIONS' NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "auth_credentials" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "line_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tender_id" uuid NOT NULL,
	"source_doc_id" uuid,
	"parent_id" uuid,
	"position" text NOT NULL,
	"description" text NOT NULL,
	"long_text" text,
	"qty" numeric NOT NULL,
	"unit" text NOT NULL,
	"spec" text,
	"brand" text,
	"std" text,
	"bid_ep" numeric,
	"bid_gp" numeric
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "price_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"line_item_id" uuid NOT NULL,
	"supplier_id" uuid,
	"source" "price_obs_source" NOT NULL,
	"price" numeric NOT NULL,
	"currency" varchar(3) DEFAULT 'EUR' NOT NULL,
	"note" text,
	"created_by" uuid,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "pricings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tender_id" uuid NOT NULL,
	"status" "pricing_status" DEFAULT 'DRAFT' NOT NULL,
	"subtotal" numeric NOT NULL,
	"margin" numeric NOT NULL,
	"final_price" numeric NOT NULL,
	"currency" varchar(3) DEFAULT 'EUR' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "approval_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tender_id" uuid NOT NULL,
	"type" "approval_type" NOT NULL,
	"status" "approval_status" DEFAULT 'PENDING' NOT NULL,
	"evidence_url" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"requested_by" uuid,
	"decided_by" uuid,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "compliance_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tender_id" uuid NOT NULL,
	"regime" "tender_regime" NOT NULL,
	"s123_pass" boolean NOT NULL,
	"s124_flags" text[] DEFAULT '{}' NOT NULL,
	"eignung_complete" boolean NOT NULL,
	"missing_forms" text[] DEFAULT '{}' NOT NULL,
	"reviewed_by" uuid,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "doc_packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tender_id" uuid NOT NULL,
	"checklist" jsonb NOT NULL,
	"missing" text[] DEFAULT '{}' NOT NULL,
	"complete" boolean DEFAULT false NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "submission_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tender_id" uuid NOT NULL,
	"submitted_by" uuid NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"proof_url" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"tender_id" uuid,
	"task_type" text NOT NULL,
	"model" text NOT NULL,
	"tokens_in" integer NOT NULL,
	"tokens_out" integer NOT NULL,
	"eur_cost" numeric(12, 6) NOT NULL,
	"confidence" numeric(4, 3) NOT NULL,
	"escalated" boolean DEFAULT false NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"entity" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"action" text NOT NULL,
	"actor_type" "audit_actor_type" NOT NULL,
	"actor_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"correlation_id" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ref_type" text NOT NULL,
	"ref_id" uuid NOT NULL,
	"model" text NOT NULL,
	"dim" integer NOT NULL,
	"content" text,
	"vector" vector(1536) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "workflow_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"n8n_execution_id" text NOT NULL,
	"workflow_name" text NOT NULL,
	"source" text NOT NULL,
	"tender_id" uuid,
	"status" text NOT NULL,
	"retries" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"duration_ms" integer,
	"error" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "amendments" ADD CONSTRAINT "amendments_tender_id_tenders_id_fk" FOREIGN KEY ("tender_id") REFERENCES "public"."tenders"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "assignments" ADD CONSTRAINT "assignments_tender_id_tenders_id_fk" FOREIGN KEY ("tender_id") REFERENCES "public"."tenders"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "assignments" ADD CONSTRAINT "assignments_pic_id_users_id_fk" FOREIGN KEY ("pic_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "customers" ADD CONSTRAINT "customers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "documents" ADD CONSTRAINT "documents_tender_id_tenders_id_fk" FOREIGN KEY ("tender_id") REFERENCES "public"."tenders"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "documents" ADD CONSTRAINT "documents_source_parent_doc_id_documents_id_fk" FOREIGN KEY ("source_parent_doc_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tenders" ADD CONSTRAINT "tenders_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tenders" ADD CONSTRAINT "tenders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "auth_credentials" ADD CONSTRAINT "auth_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "line_items" ADD CONSTRAINT "line_items_tender_id_tenders_id_fk" FOREIGN KEY ("tender_id") REFERENCES "public"."tenders"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "line_items" ADD CONSTRAINT "line_items_source_doc_id_documents_id_fk" FOREIGN KEY ("source_doc_id") REFERENCES "public"."documents"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "line_items" ADD CONSTRAINT "line_items_parent_id_line_items_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."line_items"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "price_observations" ADD CONSTRAINT "price_observations_line_item_id_line_items_id_fk" FOREIGN KEY ("line_item_id") REFERENCES "public"."line_items"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "price_observations" ADD CONSTRAINT "price_observations_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "price_observations" ADD CONSTRAINT "price_observations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pricings" ADD CONSTRAINT "pricings_tender_id_tenders_id_fk" FOREIGN KEY ("tender_id") REFERENCES "public"."tenders"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pricings" ADD CONSTRAINT "pricings_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_tender_id_tenders_id_fk" FOREIGN KEY ("tender_id") REFERENCES "public"."tenders"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "compliance_checks" ADD CONSTRAINT "compliance_checks_tender_id_tenders_id_fk" FOREIGN KEY ("tender_id") REFERENCES "public"."tenders"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "compliance_checks" ADD CONSTRAINT "compliance_checks_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "doc_packages" ADD CONSTRAINT "doc_packages_tender_id_tenders_id_fk" FOREIGN KEY ("tender_id") REFERENCES "public"."tenders"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "submission_receipts" ADD CONSTRAINT "submission_receipts_tender_id_tenders_id_fk" FOREIGN KEY ("tender_id") REFERENCES "public"."tenders"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "submission_receipts" ADD CONSTRAINT "submission_receipts_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_tender_id_tenders_id_fk" FOREIGN KEY ("tender_id") REFERENCES "public"."tenders"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_executions" ADD CONSTRAINT "workflow_executions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workflow_executions" ADD CONSTRAINT "workflow_executions_tender_id_tenders_id_fk" FOREIGN KEY ("tender_id") REFERENCES "public"."tenders"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "organizations_slug_uq" ON "organizations" USING btree ("slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "amendments_tender_id_idx" ON "amendments" USING btree ("tender_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assignments_tender_id_idx" ON "assignments" USING btree ("tender_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "assignments_pic_id_idx" ON "assignments" USING btree ("pic_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "customers_organization_id_idx" ON "customers" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_tender_id_idx" ON "documents" USING btree ("tender_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_source_parent_doc_id_idx" ON "documents" USING btree ("source_parent_doc_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "documents_uploaded_by_idx" ON "documents" USING btree ("uploaded_by");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "suppliers_organization_id_idx" ON "suppliers" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "tenders_organization_id_source_vergabe_id_uq" ON "tenders" USING btree ("organization_id","source","vergabe_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tenders_customer_id_idx" ON "tenders" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tenders_organization_id_idx" ON "tenders" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_email_uq" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_organization_id_idx" ON "users" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "line_items_tender_id_idx" ON "line_items" USING btree ("tender_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "line_items_source_doc_id_idx" ON "line_items" USING btree ("source_doc_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "line_items_parent_id_idx" ON "line_items" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "price_observations_line_item_id_idx" ON "price_observations" USING btree ("line_item_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "price_observations_supplier_id_idx" ON "price_observations" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "price_observations_created_by_idx" ON "price_observations" USING btree ("created_by");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pricings_tender_id_idx" ON "pricings" USING btree ("tender_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pricings_decided_by_idx" ON "pricings" USING btree ("decided_by");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approval_requests_tender_id_idx" ON "approval_requests" USING btree ("tender_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approval_requests_requested_by_idx" ON "approval_requests" USING btree ("requested_by");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approval_requests_decided_by_idx" ON "approval_requests" USING btree ("decided_by");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "compliance_checks_tender_id_idx" ON "compliance_checks" USING btree ("tender_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "compliance_checks_reviewed_by_idx" ON "compliance_checks" USING btree ("reviewed_by");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "doc_packages_tender_id_idx" ON "doc_packages" USING btree ("tender_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "submission_receipts_tender_id_idx" ON "submission_receipts" USING btree ("tender_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "submission_receipts_submitted_by_idx" ON "submission_receipts" USING btree ("submitted_by");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_runs_tender_id_idx" ON "ai_runs" USING btree ("tender_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_runs_organization_id_idx" ON "ai_runs" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_actor_id_idx" ON "audit_log" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_entity_idx" ON "audit_log" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "audit_log_organization_id_idx" ON "audit_log" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "embeddings_ref_idx" ON "embeddings" USING btree ("ref_type","ref_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "embeddings_vector_hnsw_idx" ON "embeddings" USING hnsw ("vector" vector_cosine_ops);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "workflow_executions_n8n_execution_id_uq" ON "workflow_executions" USING btree ("n8n_execution_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_executions_tender_id_idx" ON "workflow_executions" USING btree ("tender_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "workflow_executions_organization_id_idx" ON "workflow_executions" USING btree ("organization_id");