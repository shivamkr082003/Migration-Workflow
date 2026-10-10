CREATE TYPE "public"."agent_run_status" AS ENUM('running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."run_kind" AS ENUM('dry_run', 'execute');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('running', 'succeeded', 'failed', 'rolled_back');--> statement-breakpoint
CREATE TYPE "public"."plan_version_origin" AS ENUM('agent', 'user');--> statement-breakpoint
CREATE TYPE "public"."plan_version_status" AS ENUM('draft', 'approved', 'superseded', 'rejected');--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"model" text,
	"status" "agent_run_status" DEFAULT 'running' NOT NULL,
	"guidance" text,
	"base_version_id" uuid,
	"trace" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"usage" jsonb,
	"error" text,
	"output_version_id" uuid,
	"requested_by" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"plan_id" uuid,
	"plan_version_id" uuid,
	"run_id" uuid,
	"agent_run_id" uuid,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "execution_locks" (
	"resource" text PRIMARY KEY NOT NULL,
	"holder" text NOT NULL,
	"acquired_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" "plan_version_status" DEFAULT 'draft' NOT NULL,
	"origin" "plan_version_origin" NOT NULL,
	"content" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"issues" jsonb NOT NULL,
	"note" text,
	"parent_version_id" uuid,
	"agent_run_id" uuid,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"decision_note" text
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"source_entity" text NOT NULL,
	"target_entity" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "record_results" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"run_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"source_key" text,
	"target_key" text,
	"status" text NOT NULL,
	"output" jsonb,
	"errors" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_version_id" uuid NOT NULL,
	"kind" "run_kind" NOT NULL,
	"status" "run_status" DEFAULT 'running' NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"retry_of_run_id" uuid,
	"plan_hash" text NOT NULL,
	"checksum" text,
	"counts" jsonb,
	"errors_by_code" jsonb,
	"errors_by_field" jsonb,
	"inserted" integer DEFAULT 0 NOT NULL,
	"skipped_existing" integer DEFAULT 0 NOT NULL,
	"fault_injection" jsonb,
	"error" text,
	"triggered_by" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"rolled_back_at" timestamp with time zone,
	"rolled_back_by" text,
	"rows_deleted_on_rollback" integer
);
--> statement-breakpoint
CREATE TABLE "source_records" (
	"row_number" integer PRIMARY KEY NOT NULL,
	"source_key" text,
	"payload" jsonb NOT NULL,
	"loaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "target_customers_v2" (
	"customer_id" text PRIMARY KEY NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text,
	"email" text NOT NULL,
	"phone_e164" text,
	"signup_date" date NOT NULL,
	"is_active" boolean NOT NULL,
	"country_code" text NOT NULL,
	"lifetime_value_cents" integer NOT NULL,
	"loyalty_tier" text NOT NULL,
	"marketing_opt_in" boolean NOT NULL,
	"_plan_version_id" uuid NOT NULL,
	"_run_id" uuid NOT NULL,
	"_loaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_versions" ADD CONSTRAINT "plan_versions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "record_results" ADD CONSTRAINT "record_results_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_plan_version_id_plan_versions_id_fk" FOREIGN KEY ("plan_version_id") REFERENCES "public"."plan_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_plan_idx" ON "audit_events" USING btree ("plan_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "plan_versions_plan_version_uq" ON "plan_versions" USING btree ("plan_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "plan_versions_one_approved_uq" ON "plan_versions" USING btree ("plan_id") WHERE "plan_versions"."status" = 'approved';--> statement-breakpoint
CREATE UNIQUE INDEX "record_results_run_row_uq" ON "record_results" USING btree ("run_id","row_number");--> statement-breakpoint
CREATE INDEX "record_results_status_idx" ON "record_results" USING btree ("run_id","status");--> statement-breakpoint
CREATE INDEX "runs_version_idx" ON "runs" USING btree ("plan_version_id","kind");--> statement-breakpoint
CREATE INDEX "target_version_idx" ON "target_customers_v2" USING btree ("_plan_version_id");