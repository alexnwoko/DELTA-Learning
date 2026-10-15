-- Foreign-key and import-id columns on the largest record tables had no
-- leading index, so lookups by disaster event, division, sector and import id
-- scanned the whole table (audit 11 October 2026, register H-17). The
-- api_import_id indexes are plain, not unique, by Alex's ruling of
-- 11 October 2026.
CREATE INDEX IF NOT EXISTS "ix_disaster_records_disaster_event_id" ON "disaster_records" ("disaster_event_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_disaster_records_division_division_id" ON "disaster_records_division" ("division_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_damages_sector_id" ON "damages" ("sector_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_sdrr_disaster_record_id" ON "sector_disaster_records_relation" ("disaster_record_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_damages_api_import_id" ON "damages" ("api_import_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ix_sdrr_api_import_id" ON "sector_disaster_records_relation" ("api_import_id");
