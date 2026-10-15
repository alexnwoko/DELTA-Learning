-- Lookup and foreign-key columns on the human-effects and sector-effect tables
-- had no index, so every human-effects write and every per-record read
-- scanned the whole table. Found during the 85-country bulk load: writes
-- slowed to a crawl once the tables passed about 300,000 rows. The names
-- match the indexes added by hand to the local database during diagnosis,
-- so this migration is a no-op there.
CREATE INDEX IF NOT EXISTS "ix_hcp_record_id" ON "human_category_presence" ("record_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_human_dsg_record_id" ON "human_dsg" ("record_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_deaths_dsg_id" ON "deaths" ("dsg_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_injured_dsg_id" ON "injured" ("dsg_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_missing_dsg_id" ON "missing" ("dsg_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_affected_dsg_id" ON "affected" ("dsg_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_displaced_dsg_id" ON "displaced" ("dsg_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_disaster_records_tenant" ON "disaster_records" ("country_accounts_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_damages_record_id" ON "damages" ("record_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_losses_record_id" ON "losses" ("record_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_disruption_record_id" ON "disruption" ("record_id");
