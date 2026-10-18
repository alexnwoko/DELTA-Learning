-- The Analysis dashboard's year filter reads the span of start dates per
-- tenant. Without an index that pairs the tenant with the start date, the
-- largest tenant took about 1.2 s even as a text range with MIN and MAX.
-- Approved by Alex on 18 October 2026.
CREATE INDEX IF NOT EXISTS "ix_disaster_records_tenant_start_date" ON "disaster_records" ("country_accounts_id", "start_date");
