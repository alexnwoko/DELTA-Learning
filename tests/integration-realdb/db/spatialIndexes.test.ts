import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { dr } from "~/db.server";

// drizzle-kit does not emit the GiST indexes declared in table extras, so
// their existence is asserted against the migrated database directly.
const EXPECTED_GIST_INDEXES = [
	{ table: "division", column: "geom", index: "division_geom_idx" },
	{ table: "division", column: "bbox", index: "division_bbox_idx" },
	{
		table: "hazardous_event_spatial_observation_geom",
		column: "geom",
		index: "hazardous_event_spatial_observation_geom_geom_idx",
	},
];

describe("spatial indexes", () => {
	it.each(EXPECTED_GIST_INDEXES)(
		"$index is a GiST index on $table ($column)",
		async ({ table, column, index }) => {
			const res = await dr.execute(sql`
				SELECT indexdef
				FROM pg_indexes
				WHERE schemaname = 'public'
					AND tablename = ${table}
					AND indexname = ${index}
			`);
			expect(res.rows).toHaveLength(1);
			const def = String(res.rows[0].indexdef);
			expect(def).toMatch(/USING gist/i);
			expect(def).toContain(`(${column})`);
		},
	);

	it("every geometry column in public has a GiST index", async () => {
		const res = await dr.execute(sql`
			SELECT c.table_name, c.column_name
			FROM information_schema.columns c
			WHERE c.table_schema = 'public'
				AND c.udt_name = 'geometry'
				AND NOT EXISTS (
					SELECT 1
					FROM pg_indexes i
					WHERE i.schemaname = 'public'
						AND i.tablename = c.table_name
						AND i.indexdef ILIKE '%USING gist%'
						AND i.indexdef LIKE '%(' || c.column_name || ')%'
				)
		`);
		expect(res.rows).toEqual([]);
	});
});
