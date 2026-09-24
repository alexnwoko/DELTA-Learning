-- GiST indexes declared in divisionTable.ts extras but never emitted by drizzle-kit,
-- plus the observation geometry table, which shipped without one.
-- geoDatabase.updateSpatialIndexes() runs REINDEX on division_geom_idx and fails without it.
CREATE INDEX IF NOT EXISTS "division_geom_idx" ON "division" USING GIST ("geom");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "division_bbox_idx" ON "division" USING GIST ("bbox");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hazardous_event_spatial_observation_geom_geom_idx"
	ON "hazardous_event_spatial_observation_geom" USING GIST ("geom");
