import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { dr } from "~/db.server";

// Lookups by disaster event, division, sector and import id scanned the whole
// table on the largest record tables (audit 11 October 2026, register H-17).
const EXPECTED = [
	{ table: "disaster_records", column: "disaster_event_id" },
	{ table: "disaster_records_division", column: "division_id" },
	{ table: "damages", column: "sector_id" },
	{ table: "sector_disaster_records_relation", column: "disaster_record_id" },
	{ table: "damages", column: "api_import_id" },
	{ table: "sector_disaster_records_relation", column: "api_import_id" },
];

describe("foreign-key lookup indexes", () => {
	it.each(EXPECTED)(
		"$table.$column leads an index",
		async ({ table, column }) => {
			const res = await dr.execute(sql`
				SELECT i.indexname
				FROM pg_index x
				JOIN pg_class t ON t.oid = x.indrelid
				JOIN pg_class ic ON ic.oid = x.indexrelid
				JOIN pg_indexes i ON i.indexname = ic.relname AND i.schemaname = 'public'
				JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = x.indkey[0]
				WHERE t.relname = ${table} AND a.attname = ${column}
			`);
			expect(res.rows.length).toBeGreaterThan(0);
		},
	);
});
