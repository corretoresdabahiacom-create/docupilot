ALTER TABLE "reports" ADD COLUMN "owner_notified_at" bigint;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "removal_after" bigint;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "resolution" text;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "resolved_by" text;--> statement-breakpoint
CREATE INDEX "reports_status_idx" ON "reports" USING btree ("status","created_at");--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_status_ck" CHECK ("reports"."status" IN ('open','owner_notified','dismissed','removed'));--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_target_ck" CHECK ("reports"."target_type" IN ('document','shared_link','other'));