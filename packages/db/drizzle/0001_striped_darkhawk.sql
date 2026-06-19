ALTER TYPE "public"."query_status" ADD VALUE 'AWAITING_ACKNOWLEDGMENT' BEFORE 'EXECUTING';--> statement-breakpoint
ALTER TABLE "query_logs" ADD COLUMN "masked_columns" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "query_logs" ADD COLUMN "row_cap" integer;--> statement-breakpoint
ALTER TABLE "query_logs" ADD COLUMN "simulation_result" jsonb;