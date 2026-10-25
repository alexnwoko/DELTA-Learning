-- BM-5 review (D-BM-06): the licence guards must see every tenant's values.
-- Under row-level security a non-owner caller sees only its own tenant, so a
-- guard run as the caller could miss another tenant's values and let a source
-- become excluded or per_resource, or a release move, beneath them. Each guard
-- runs as its owner (the migration role, which bypasses RLS) with a pinned
-- search_path; the functions already schema-qualify every table.
ALTER FUNCTION "ref"."value_licence_guard"() SECURITY DEFINER SET search_path = pg_catalog, ref;
--> statement-breakpoint
ALTER FUNCTION "ref"."source_licence_guard"() SECURITY DEFINER SET search_path = pg_catalog, ref;
--> statement-breakpoint
ALTER FUNCTION "ref"."release_source_guard"() SECURITY DEFINER SET search_path = pg_catalog, ref;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "ref"."value_licence_guard"(), "ref"."source_licence_guard"(), "ref"."release_source_guard"() FROM PUBLIC;
