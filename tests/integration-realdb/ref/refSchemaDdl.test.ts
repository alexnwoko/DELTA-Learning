import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { dr } from "~/db.server";

// E1 (Enrichment Data Integration, section 8): the ref schema indexes are
// hand-written in 20261010090000_ref_reference_store.sql. Each must exist
// with the expected definition, because the denominator lookup and the
// loader's idempotent upsert depend on them.
const EXPECTED_INDEXES: { name: string; table: string; contains: string[] }[] =
	[
		{
			name: "ref_value_natural_key_idx",
			table: "value",
			contains: [
				"CREATE UNIQUE INDEX",
				"country_accounts_id",
				"COALESCE(division_id, '00000000-0000-0000-0000-000000000000'::uuid)",
				"indicator_code",
				"release_id",
				"period_start",
			],
		},
		{
			name: "ref_value_lookup_idx",
			table: "value",
			contains: [
				"(country_accounts_id, indicator_code, division_id, period_start)",
			],
		},
		{
			name: "ref_value_release_id_idx",
			table: "value",
			contains: ["(release_id)"],
		},
		{
			name: "ref_value_division_id_idx",
			table: "value",
			contains: ["(division_id)"],
		},
		{
			name: "ref_release_source_id_idx",
			table: "release",
			contains: ["(source_id)"],
		},
		{
			name: "ref_driver_index_natural_key_idx",
			table: "driver_index",
			contains: [
				"CREATE UNIQUE INDEX",
				"(index_name, averaging_window, provider, period_start)",
			],
		},
		{
			name: "ref_driver_index_release_id_idx",
			table: "driver_index",
			contains: ["(release_id)"],
		},
	];

const EXPECTED_CHECKS = [
	"ref_value_value_state_check",
	"ref_value_null_is_not_zero_check",
	"ref_value_zero_confirmed_check",
	"ref_value_grade_check",
	"ref_value_grade_a_official_check",
	"ref_value_modelled_grade_check",
	"ref_value_method_check",
	"ref_value_index_method_check",
	"ref_value_lower_bound_check",
	"ref_value_upper_bound_check",
	"ref_value_key_scheme_check",
	"ref_value_key_scheme_division_check",
	"ref_value_boundary_vintage_check",
	"ref_value_interval_type_check",
	"ref_value_currency_check",
	"ref_value_price_basis_check",
	"ref_source_redistribution_rule_check",
	"ref_source_status_check",
];

describe("ref schema DDL", () => {
	it("has the five tables", async () => {
		const res = await dr.execute(sql`
			SELECT tablename FROM pg_tables WHERE schemaname = 'ref' ORDER BY tablename
		`);
		expect(res.rows.map((r: any) => r.tablename)).toEqual([
			"driver_index",
			"indicator",
			"release",
			"source",
			"value",
		]);
	});

	it.each(EXPECTED_INDEXES)("index $name exists on ref.$table", async (ix) => {
		const res = await dr.execute(sql`
			SELECT tablename, indexdef FROM pg_indexes
			WHERE schemaname = 'ref' AND indexname = ${ix.name}
		`);
		expect(res.rows).toHaveLength(1);
		const row = res.rows[0] as { tablename: string; indexdef: string };
		expect(row.tablename).toBe(ix.table);
		for (const part of ix.contains) {
			expect(row.indexdef).toContain(part);
		}
	});

	it.each(EXPECTED_CHECKS)("check constraint %s exists", async (name) => {
		const res = await dr.execute(sql`
			SELECT 1 FROM pg_constraint c
			JOIN pg_namespace n ON n.oid = c.connamespace
			WHERE n.nspname = 'ref' AND c.conname = ${name} AND c.contype = 'c'
		`);
		expect(res.rows).toHaveLength(1);
	});

	it("ref.value carries the tenant column as NOT NULL and division as nullable", async () => {
		const res = await dr.execute(sql`
			SELECT column_name, is_nullable, data_type FROM information_schema.columns
			WHERE table_schema = 'ref' AND table_name = 'value'
				AND column_name IN ('country_accounts_id', 'division_id', 'created_at')
			ORDER BY column_name
		`);
		expect(res.rows).toEqual([
			{
				column_name: "country_accounts_id",
				is_nullable: "NO",
				data_type: "uuid",
			},
			{
				column_name: "created_at",
				is_nullable: "NO",
				data_type: "timestamp with time zone",
			},
			{ column_name: "division_id", is_nullable: "YES", data_type: "uuid" },
		]);
	});

	it("seeds the three population indicators as extensive persons", async () => {
		const res = await dr.execute(sql`
			SELECT code, family, quantity_type, unit FROM ref.indicator
			WHERE code IN ('POP_TOTAL', 'POP_FEMALE', 'POP_MALE') ORDER BY code
		`);
		expect(res.rows).toEqual([
			{
				code: "POP_FEMALE",
				family: "population",
				quantity_type: "extensive",
				unit: "persons",
			},
			{
				code: "POP_MALE",
				family: "population",
				quantity_type: "extensive",
				unit: "persons",
			},
			{
				code: "POP_TOTAL",
				family: "population",
				quantity_type: "extensive",
				unit: "persons",
			},
		]);
	});

	it("seeds HH_AVG_OCCUPANTS as intensive persons per household", async () => {
		const res = await dr.execute(sql`
			SELECT family, quantity_type, unit FROM ref.indicator WHERE code = 'HH_AVG_OCCUPANTS'
		`);
		expect(res.rows).toEqual([
			{
				family: "population",
				quantity_type: "intensive",
				unit: "persons per household",
			},
		]);
	});
});
