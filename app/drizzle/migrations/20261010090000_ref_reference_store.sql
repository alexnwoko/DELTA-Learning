-- E1 (Enrichment Data Integration, section 8): the reference store.
-- Schema "ref" holds enrichment values (population first) with full
-- provenance. Hand-written; no Drizzle schema file, so drizzle-kit generate
-- and push (public schema only) never touch it. Rules from section 4:
--   R6 every value carries source, release, period, method, boundary vintage,
--      licence and source status;
--   R7 null is not zero: a value exists only when reported or zero_confirmed;
--   grade scale REF-A..REF-D (REF-A official national only; modelled values
--   REF-C or REF-D only).
-- source_status is carried down source -> release -> value by composite
-- foreign keys, so the grade checks on ref.value cannot disagree with the
-- source they cite.
CREATE SCHEMA IF NOT EXISTS "ref";
--> statement-breakpoint
CREATE TABLE "ref"."source" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"provider" text,
	"documentation_url" text,
	"licence" text NOT NULL,
	"redistribution_rule" text NOT NULL,
	"attribution_text" text,
	"source_status" text NOT NULL,
	"rdls_id" text,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT "ref_source_name_unique" UNIQUE ("name"),
	CONSTRAINT "ref_source_id_status_unique" UNIQUE ("id", "source_status"),
	CONSTRAINT "ref_source_name_check" CHECK (length(btrim("name")) > 0),
	CONSTRAINT "ref_source_licence_check" CHECK (length(btrim("licence")) > 0),
	CONSTRAINT "ref_source_redistribution_rule_check" CHECK ("redistribution_rule" IN ('display_and_redistribute', 'display_only', 'signed_in_only', 'analysis_only')),
	CONSTRAINT "ref_source_status_check" CHECK ("source_status" IN ('official_national', 'international_official', 'modelled'))
);
--> statement-breakpoint
CREATE TABLE "ref"."release" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"source_status" text NOT NULL,
	"version" text NOT NULL,
	"release_date" date,
	"reference_period_start" date,
	"reference_period_end" date,
	"checksum" text,
	"deprecated_by" uuid,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT "ref_release_source_fk" FOREIGN KEY ("source_id", "source_status") REFERENCES "ref"."source" ("id", "source_status") ON UPDATE CASCADE ON DELETE RESTRICT,
	CONSTRAINT "ref_release_deprecated_by_fk" FOREIGN KEY ("deprecated_by") REFERENCES "ref"."release" ("id") ON DELETE SET NULL,
	CONSTRAINT "ref_release_source_version_unique" UNIQUE ("source_id", "version"),
	CONSTRAINT "ref_release_id_status_unique" UNIQUE ("id", "source_status"),
	CONSTRAINT "ref_release_version_check" CHECK (length(btrim("version")) > 0),
	CONSTRAINT "ref_release_period_check" CHECK ("reference_period_end" IS NULL OR "reference_period_start" IS NULL OR "reference_period_end" >= "reference_period_start"),
	CONSTRAINT "ref_release_not_self_deprecated_check" CHECK ("deprecated_by" IS NULL OR "deprecated_by" <> "id")
);
--> statement-breakpoint
CREATE TABLE "ref"."indicator" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text,
	"family" text NOT NULL,
	"quantity_type" text NOT NULL,
	"unit" text NOT NULL,
	"rdls_exposure_category" text,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT "ref_indicator_code_check" CHECK ("code" ~ '^[A-Z][A-Z0-9_]{2,40}$'),
	CONSTRAINT "ref_indicator_family_check" CHECK ("family" IN ('population', 'exposure', 'vulnerability', 'climate_driver')),
	CONSTRAINT "ref_indicator_quantity_type_check" CHECK ("quantity_type" IN ('extensive', 'intensive', 'index')),
	CONSTRAINT "ref_indicator_unit_check" CHECK (length(btrim("unit")) > 0)
);
--> statement-breakpoint
CREATE TABLE "ref"."value" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"country_accounts_id" uuid NOT NULL,
	"division_id" uuid,
	"boundary_vintage" text NOT NULL,
	"indicator_code" text NOT NULL,
	"release_id" uuid NOT NULL,
	"source_status" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"value" double precision,
	"value_state" text NOT NULL,
	"lower_bound" double precision,
	"upper_bound" double precision,
	"method" text NOT NULL,
	"grade" text NOT NULL,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT "ref_value_country_accounts_fk" FOREIGN KEY ("country_accounts_id") REFERENCES "public"."country_accounts" ("id") ON DELETE CASCADE,
	CONSTRAINT "ref_value_division_fk" FOREIGN KEY ("division_id") REFERENCES "public"."division" ("id") ON DELETE RESTRICT,
	CONSTRAINT "ref_value_indicator_fk" FOREIGN KEY ("indicator_code") REFERENCES "ref"."indicator" ("code") ON UPDATE CASCADE ON DELETE RESTRICT,
	CONSTRAINT "ref_value_release_fk" FOREIGN KEY ("release_id", "source_status") REFERENCES "ref"."release" ("id", "source_status") ON UPDATE CASCADE ON DELETE RESTRICT,
	CONSTRAINT "ref_value_boundary_vintage_check" CHECK (length(btrim("boundary_vintage")) > 0),
	CONSTRAINT "ref_value_period_check" CHECK ("period_end" >= "period_start"),
	CONSTRAINT "ref_value_value_state_check" CHECK ("value_state" IN ('reported', 'zero_confirmed', 'not_reported', 'not_applicable', 'suppressed')),
	CONSTRAINT "ref_value_null_is_not_zero_check" CHECK (("value_state" IN ('reported', 'zero_confirmed')) = ("value" IS NOT NULL)),
	CONSTRAINT "ref_value_zero_confirmed_check" CHECK ("value_state" <> 'zero_confirmed' OR "value" = 0),
	CONSTRAINT "ref_value_bounds_check" CHECK ("lower_bound" IS NULL OR "upper_bound" IS NULL OR "lower_bound" <= "upper_bound"),
	CONSTRAINT "ref_value_method_check" CHECK ("method" IN ('as_published', 'zonal_sum', 'weighted_mean', 'admin_join')),
	CONSTRAINT "ref_value_grade_check" CHECK ("grade" IN ('REF-A', 'REF-B', 'REF-C', 'REF-D')),
	CONSTRAINT "ref_value_source_status_check" CHECK ("source_status" IN ('official_national', 'international_official', 'modelled')),
	CONSTRAINT "ref_value_grade_a_official_check" CHECK ("grade" <> 'REF-A' OR "source_status" = 'official_national'),
	CONSTRAINT "ref_value_modelled_grade_check" CHECK ("source_status" <> 'modelled' OR "grade" IN ('REF-C', 'REF-D'))
);
--> statement-breakpoint
-- One value per tenant, division (NULL = national), indicator, release and
-- period start. COALESCE maps the national row to a fixed key, so two
-- national rows conflict (a plain UNIQUE treats NULLs as distinct).
CREATE UNIQUE INDEX "ref_value_natural_key_idx" ON "ref"."value" ("country_accounts_id", COALESCE("division_id", '00000000-0000-0000-0000-000000000000'::uuid), "indicator_code", "release_id", "period_start");
--> statement-breakpoint
-- Denominator lookup: tenant, indicator, division, then the period.
CREATE INDEX "ref_value_lookup_idx" ON "ref"."value" ("country_accounts_id", "indicator_code", "division_id", "period_start");
--> statement-breakpoint
CREATE INDEX "ref_value_release_id_idx" ON "ref"."value" ("release_id");
--> statement-breakpoint
CREATE INDEX "ref_value_division_id_idx" ON "ref"."value" ("division_id");
--> statement-breakpoint
CREATE INDEX "ref_release_source_id_idx" ON "ref"."release" ("source_id");
--> statement-breakpoint
CREATE TABLE "ref"."driver_index" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"index_name" text NOT NULL,
	"averaging_window" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"value" double precision,
	"value_state" text NOT NULL,
	"provider" text NOT NULL,
	"release_id" uuid,
	"created_at" timestamptz DEFAULT now() NOT NULL,
	CONSTRAINT "ref_driver_index_release_fk" FOREIGN KEY ("release_id") REFERENCES "ref"."release" ("id") ON DELETE RESTRICT,
	CONSTRAINT "ref_driver_index_period_check" CHECK ("period_end" >= "period_start"),
	CONSTRAINT "ref_driver_index_value_state_check" CHECK ("value_state" IN ('reported', 'zero_confirmed', 'not_reported', 'not_applicable', 'suppressed')),
	CONSTRAINT "ref_driver_index_null_is_not_zero_check" CHECK (("value_state" IN ('reported', 'zero_confirmed')) = ("value" IS NOT NULL)),
	CONSTRAINT "ref_driver_index_zero_confirmed_check" CHECK ("value_state" <> 'zero_confirmed' OR "value" = 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ref_driver_index_natural_key_idx" ON "ref"."driver_index" ("index_name", "averaging_window", "provider", "period_start");
--> statement-breakpoint
CREATE INDEX "ref_driver_index_release_id_idx" ON "ref"."driver_index" ("release_id");
--> statement-breakpoint
INSERT INTO "ref"."indicator" ("code", "name", "family", "quantity_type", "unit") VALUES
	('POP_TOTAL', 'Total population', 'population', 'extensive', 'persons'),
	('POP_FEMALE', 'Female population', 'population', 'extensive', 'persons'),
	('POP_MALE', 'Male population', 'population', 'extensive', 'persons')
ON CONFLICT ("code") DO NOTHING;
