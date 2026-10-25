-- BM-3 (D-BM-05): contract delta_reference_value.schema.json v0.3
-- (GEO-N01, GEO-N03, DRR-N04) and the seven SEC-19 redistribution rules.
-- Additive: new columns are nullable or carry a constant default, so no
-- table rewrite and no change to existing values. PostgreSQL 17 has no
-- ADD CONSTRAINT IF NOT EXISTS or CREATE POLICY IF NOT EXISTS, so each
-- constraint is dropped if present and re-added. The ref.value CHECKs are
-- added NOT VALID, so the large table is not scanned under an exclusive
-- lock; 20261026100000_ref_contract_v0_3_validate validates them.
ALTER TABLE "ref"."source" DROP CONSTRAINT IF EXISTS "ref_source_redistribution_rule_check";
--> statement-breakpoint
ALTER TABLE "ref"."source" ADD CONSTRAINT "ref_source_redistribution_rule_check" CHECK ("redistribution_rule" IN ('display_and_redistribute', 'redistribute_share_alike', 'display_only', 'signed_in_only', 'analysis_only', 'per_resource', 'excluded'));
--> statement-breakpoint
ALTER TABLE "ref"."release" ADD COLUMN IF NOT EXISTS "grid_resolution" text;
--> statement-breakpoint
ALTER TABLE "ref"."release" DROP CONSTRAINT IF EXISTS "ref_release_grid_resolution_check";
--> statement-breakpoint
ALTER TABLE "ref"."release" ADD CONSTRAINT "ref_release_grid_resolution_check" CHECK ("grid_resolution" IS NULL OR "grid_resolution" ~ '^[0-9]+(\.[0-9]+)? (m|km|arcsec|arcmin|deg)$');
--> statement-breakpoint
ALTER TABLE "ref"."value" ADD COLUMN IF NOT EXISTS "is_monetary" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "ref"."value" ADD COLUMN IF NOT EXISTS "quality_flags" text[] DEFAULT '{}'::text[] NOT NULL;
--> statement-breakpoint
ALTER TABLE "ref"."value" ADD COLUMN IF NOT EXISTS "cell_coverage_sum" double precision;
--> statement-breakpoint
ALTER TABLE "ref"."value" ADD COLUMN IF NOT EXISTS "redistribution_rule" text;
--> statement-breakpoint
ALTER TABLE "ref"."value" DROP CONSTRAINT IF EXISTS "ref_value_monetary_check";
--> statement-breakpoint
ALTER TABLE "ref"."value" ADD CONSTRAINT "ref_value_monetary_check" CHECK (NOT "is_monetary" OR ("currency" IS NOT NULL AND "price_basis" IS NOT NULL AND "unit_mult" IS NOT NULL)) NOT VALID;
--> statement-breakpoint
ALTER TABLE "ref"."value" DROP CONSTRAINT IF EXISTS "ref_value_constant_base_year_check";
--> statement-breakpoint
ALTER TABLE "ref"."value" ADD CONSTRAINT "ref_value_constant_base_year_check" CHECK ("price_basis" IS DISTINCT FROM 'constant' OR "base_year" IS NOT NULL) NOT VALID;
--> statement-breakpoint
-- One flag in the codelist today: the cardinality bound stands in for
-- uniqueness and is replaced when the codelist grows.
ALTER TABLE "ref"."value" DROP CONSTRAINT IF EXISTS "ref_value_quality_flags_check";
--> statement-breakpoint
ALTER TABLE "ref"."value" ADD CONSTRAINT "ref_value_quality_flags_check" CHECK ("quality_flags" <@ ARRAY['coarse_grid']::text[] AND cardinality("quality_flags") <= 1) NOT VALID;
--> statement-breakpoint
ALTER TABLE "ref"."value" DROP CONSTRAINT IF EXISTS "ref_value_coarse_grid_grade_check";
--> statement-breakpoint
ALTER TABLE "ref"."value" ADD CONSTRAINT "ref_value_coarse_grid_grade_check" CHECK (NOT ('coarse_grid' = ANY ("quality_flags")) OR "grade" = 'REF-D') NOT VALID;
--> statement-breakpoint
ALTER TABLE "ref"."value" DROP CONSTRAINT IF EXISTS "ref_value_cell_coverage_sum_check";
--> statement-breakpoint
ALTER TABLE "ref"."value" ADD CONSTRAINT "ref_value_cell_coverage_sum_check" CHECK ("cell_coverage_sum" IS NULL OR "cell_coverage_sum" >= 0) NOT VALID;
--> statement-breakpoint
ALTER TABLE "ref"."value" DROP CONSTRAINT IF EXISTS "ref_value_interpolation_grade_check";
--> statement-breakpoint
ALTER TABLE "ref"."value" ADD CONSTRAINT "ref_value_interpolation_grade_check" CHECK ("method" NOT IN ('areal_interpolation', 'raked_to_official') OR "grade" IN ('REF-C', 'REF-D')) NOT VALID;
--> statement-breakpoint
ALTER TABLE "ref"."value" DROP CONSTRAINT IF EXISTS "ref_value_interval_type_required_check";
--> statement-breakpoint
ALTER TABLE "ref"."value" ADD CONSTRAINT "ref_value_interval_type_required_check" CHECK (("lower_bound" IS NULL AND "upper_bound" IS NULL) OR "interval_type" IS NOT NULL) NOT VALID;
--> statement-breakpoint
ALTER TABLE "ref"."value" DROP CONSTRAINT IF EXISTS "ref_value_redistribution_rule_check";
--> statement-breakpoint
ALTER TABLE "ref"."value" ADD CONSTRAINT "ref_value_redistribution_rule_check" CHECK ("redistribution_rule" IS NULL OR "redistribution_rule" IN ('display_and_redistribute', 'redistribute_share_alike', 'display_only', 'signed_in_only', 'analysis_only')) NOT VALID;
--> statement-breakpoint
-- SEC-19 rules 6 and 7 (TR-162): an excluded source writes no value; a
-- per_resource source needs the resolved rule on the value; any other
-- source's value carries no rule or the source's own rule.
CREATE OR REPLACE FUNCTION "ref"."value_licence_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
	src_rule text;
BEGIN
	SELECT s."redistribution_rule" INTO src_rule
	FROM "ref"."release" r JOIN "ref"."source" s ON s."id" = r."source_id"
	WHERE r."id" = NEW."release_id";
	IF src_rule = 'excluded' THEN
		RAISE EXCEPTION 'ref.value: the source of release % is excluded (SEC-19 rule 7)', NEW."release_id" USING ERRCODE = 'check_violation';
	ELSIF src_rule = 'per_resource' AND NEW."redistribution_rule" IS NULL THEN
		RAISE EXCEPTION 'ref.value: per_resource source needs the resolved redistribution_rule (SEC-19 rule 6)' USING ERRCODE = 'check_violation';
	ELSIF src_rule <> 'per_resource' AND NEW."redistribution_rule" IS NOT NULL AND NEW."redistribution_rule" <> src_rule THEN
		RAISE EXCEPTION 'ref.value: redistribution_rule % differs from source rule %', NEW."redistribution_rule", src_rule USING ERRCODE = 'check_violation';
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "ref_value_licence_guard" ON "ref"."value";
--> statement-breakpoint
CREATE TRIGGER "ref_value_licence_guard" BEFORE INSERT OR UPDATE OF "release_id", "redistribution_rule" ON "ref"."value" FOR EACH ROW EXECUTE FUNCTION "ref"."value_licence_guard"();
--> statement-breakpoint
-- A source or release change must not bypass the value guard: a source
-- cannot become excluded or per_resource, and a release cannot move to
-- another source, while values hang from it.
CREATE OR REPLACE FUNCTION "ref"."source_licence_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
	IF NEW."redistribution_rule" IN ('excluded', 'per_resource')
		AND NEW."redistribution_rule" IS DISTINCT FROM OLD."redistribution_rule"
		AND EXISTS (
			SELECT 1 FROM "ref"."value" v
			JOIN "ref"."release" r ON r."id" = v."release_id"
			WHERE r."source_id" = NEW."id"
		) THEN
		RAISE EXCEPTION 'ref.source: cannot change the rule of % to % while values exist; deprecate its releases first', NEW."id", NEW."redistribution_rule" USING ERRCODE = 'check_violation';
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "ref_source_licence_guard" ON "ref"."source";
--> statement-breakpoint
CREATE TRIGGER "ref_source_licence_guard" BEFORE UPDATE OF "redistribution_rule" ON "ref"."source" FOR EACH ROW EXECUTE FUNCTION "ref"."source_licence_guard"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "ref"."release_source_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
	IF NEW."source_id" IS DISTINCT FROM OLD."source_id"
		AND EXISTS (SELECT 1 FROM "ref"."value" v WHERE v."release_id" = NEW."id") THEN
		RAISE EXCEPTION 'ref.release: cannot move release % to another source while values exist', NEW."id" USING ERRCODE = 'check_violation';
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "ref_release_source_guard" ON "ref"."release";
--> statement-breakpoint
CREATE TRIGGER "ref_release_source_guard" BEFORE UPDATE OF "source_id" ON "ref"."release" FOR EACH ROW EXECUTE FUNCTION "ref"."release_source_guard"();
