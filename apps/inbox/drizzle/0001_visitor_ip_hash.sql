ALTER TABLE "visitors" ADD COLUMN "ip_hash" text;--> statement-breakpoint
CREATE INDEX "visitors_ip_hash_created_at_idx" ON "visitors" USING btree ("ip_hash","created_at");