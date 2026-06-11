-- Performance Management System (PMS) foundations: KPI scorecards, revenue
-- attribution, and AI Management Layer reports. All additive (new enums + tables,
-- no changes to existing objects), so safe in the migration transaction.

CREATE TYPE "public"."kpi_category" AS ENUM('OUTPUT', 'QUALITY', 'SPEED', 'COMPLIANCE', 'REVENUE');--> statement-breakpoint
CREATE TYPE "public"."kpi_period" AS ENUM('WEEKLY', 'MONTHLY');--> statement-breakpoint
CREATE TYPE "public"."kpi_source" AS ENUM('AUTO', 'MANUAL', 'PARTIAL', 'NA');--> statement-breakpoint
CREATE TYPE "public"."scorecard_zone" AS ENUM('GREEN', 'YELLOW', 'ORANGE', 'RED');--> statement-breakpoint
CREATE TYPE "public"."contribution_role" AS ENUM('RESEARCH', 'QUALIFICATION', 'VALIDATION', 'SALES', 'ACCOUNT_MANAGER');--> statement-breakpoint
CREATE TYPE "public"."report_period" AS ENUM('DAILY', 'WEEKLY');--> statement-breakpoint
CREATE TYPE "public"."report_scope" AS ENUM('COMPANY', 'DEPARTMENT', 'USER');--> statement-breakpoint

CREATE TABLE "kpi_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL REFERENCES "organizations"("id"),
	"department" "department",
	"key" text NOT NULL,
	"label" text NOT NULL,
	"category" "kpi_category" NOT NULL,
	"weight_pct" integer DEFAULT 0 NOT NULL,
	"period" "kpi_period" DEFAULT 'WEEKLY' NOT NULL,
	"target" text,
	"source" "kpi_source" DEFAULT 'MANUAL' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "kpi_definitions_organization_id_idx" ON "kpi_definitions" ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "kpi_definitions_org_dept_key_uq" ON "kpi_definitions" ("organization_id","department","key");--> statement-breakpoint

CREATE TABLE "kpi_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL REFERENCES "organizations"("id"),
	"user_id" uuid NOT NULL REFERENCES "users"("id"),
	"kpi_key" text NOT NULL,
	"period" "kpi_period" DEFAULT 'WEEKLY' NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"numeric_value" numeric,
	"display_value" text,
	"source" "kpi_source" DEFAULT 'MANUAL' NOT NULL,
	"entered_by" uuid REFERENCES "users"("id"),
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "kpi_values_organization_id_idx" ON "kpi_values" ("organization_id");--> statement-breakpoint
CREATE INDEX "kpi_values_user_id_idx" ON "kpi_values" ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "kpi_values_user_kpi_period_uq" ON "kpi_values" ("user_id","kpi_key","period_start");--> statement-breakpoint

CREATE TABLE "scorecards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL REFERENCES "organizations"("id"),
	"user_id" uuid NOT NULL REFERENCES "users"("id"),
	"period" "kpi_period" DEFAULT 'WEEKLY' NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"category_scores" jsonb,
	"composite" integer NOT NULL,
	"zone" "scorecard_zone" NOT NULL,
	"report_id" uuid,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "scorecards_organization_id_idx" ON "scorecards" ("organization_id");--> statement-breakpoint
CREATE INDEX "scorecards_user_id_idx" ON "scorecards" ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "scorecards_user_period_start_uq" ON "scorecards" ("user_id","period","period_start");--> statement-breakpoint

CREATE TABLE "tender_contributions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tender_id" uuid NOT NULL REFERENCES "tenders"("id"),
	"user_id" uuid NOT NULL REFERENCES "users"("id"),
	"role" "contribution_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "tender_contributions_tender_id_idx" ON "tender_contributions" ("tender_id");--> statement-breakpoint
CREATE INDEX "tender_contributions_user_id_idx" ON "tender_contributions" ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tender_contributions_tender_user_role_uq" ON "tender_contributions" ("tender_id","user_id","role");--> statement-breakpoint

CREATE TABLE "performance_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL REFERENCES "organizations"("id"),
	"scope" "report_scope" NOT NULL,
	"scope_id" text,
	"period" "report_period" NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"summary" jsonb,
	"ai_run_id" uuid,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE INDEX "performance_reports_organization_id_idx" ON "performance_reports" ("organization_id");
