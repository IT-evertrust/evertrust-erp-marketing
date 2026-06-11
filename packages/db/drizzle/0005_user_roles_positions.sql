CREATE TYPE "public"."user_position" AS ENUM('CEO', 'CTO', 'CFO', 'COO', 'DEPT_MANAGER', 'EXECUTIVE', 'OFFICER', 'SPECIALIST');--> statement-breakpoint
CREATE TYPE "public"."department" AS ENUM('OPERATIONS', 'IT', 'CONSULTING', 'MARKETING', 'BUSINESS', 'HR');--> statement-breakpoint
CREATE TYPE "public"."user_role_new" AS ENUM('SUPER_ADMIN', 'ADMIN', 'MANAGER', 'EMPLOYEE');--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DATA TYPE "public"."user_role_new" USING (CASE "role"::text WHEN 'L1' THEN 'SUPER_ADMIN' WHEN 'L2' THEN 'ADMIN' WHEN 'L3' THEN 'MANAGER' WHEN 'L4' THEN 'MANAGER' WHEN 'L5' THEN 'EMPLOYEE' ELSE 'EMPLOYEE' END)::"public"."user_role_new";--> statement-breakpoint
DROP TYPE "public"."user_role";--> statement-breakpoint
ALTER TYPE "public"."user_role_new" RENAME TO "user_role";--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'EMPLOYEE';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "department" "public"."department";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "position" "public"."user_position";--> statement-breakpoint
UPDATE "users" SET "department" = "lane"::text::"public"."department";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "lane";--> statement-breakpoint
DROP TYPE "public"."lane";
