-- BM-3 (D-BM-05): validate the contract v0.3 CHECKs added NOT VALID in
-- 20261026090000_ref_contract_v0_3. VALIDATE CONSTRAINT takes SHARE UPDATE
-- EXCLUSIVE, so reads and writes of ref.value continue while rows are
-- checked. Validating an already valid constraint is a no-op.
ALTER TABLE "ref"."value" VALIDATE CONSTRAINT "ref_value_monetary_check";
--> statement-breakpoint
ALTER TABLE "ref"."value" VALIDATE CONSTRAINT "ref_value_constant_base_year_check";
--> statement-breakpoint
ALTER TABLE "ref"."value" VALIDATE CONSTRAINT "ref_value_quality_flags_check";
--> statement-breakpoint
ALTER TABLE "ref"."value" VALIDATE CONSTRAINT "ref_value_coarse_grid_grade_check";
--> statement-breakpoint
ALTER TABLE "ref"."value" VALIDATE CONSTRAINT "ref_value_cell_coverage_sum_check";
--> statement-breakpoint
ALTER TABLE "ref"."value" VALIDATE CONSTRAINT "ref_value_interpolation_grade_check";
--> statement-breakpoint
ALTER TABLE "ref"."value" VALIDATE CONSTRAINT "ref_value_interval_type_required_check";
--> statement-breakpoint
ALTER TABLE "ref"."value" VALIDATE CONSTRAINT "ref_value_redistribution_rule_check";
