import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { dr } from "~/db.server";

// Every human-effects write and per-record read filters on these columns.
// Without an index each is a full-table scan, which stalled the 85-country
// bulk load once the tables passed about 300,000 rows.
const EXPECTED = [
	{ table: "human_category_presence", column: "record_id" },
	{ table: "human_dsg", column: "record_id" },
	{ table: "deaths", column: "dsg_id" },
	{ table: "injured", column: "dsg_id" },
	{ table: "missing", column: "dsg_id" },
	{ table: "affected", column: "dsg_id" },
	{ table: "displaced", column: "dsg_id" },
	{ table: "disaster_records", column: "country_accounts_id" },
	{ table: "damages", column: "record_id" },
	{ table: "losses", column: "record_id" },
	{ table: "disruption", column: "record_id" },
];

describe("effect lookup indexes", () => {
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
