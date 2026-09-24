import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq, sql, SQL } from "drizzle-orm";
import { randomUUID } from "crypto";
import { dr } from "~/db.server";
import { disasterRecordsTable } from "~/drizzle/schema/disasterRecordsTable";
import {
	createTestIds,
	createTestUser,
	cleanupTestUser,
} from "../test-helpers";
import { applyGeographicFilters } from "~/backend.server/utils/geographicFilters";

// applyGeographicFilters is shared by the sector, effect-detail, hazard-impact
// and most-damaging-event analytics. It must match records through the
// division link tables and fail closed, never fall back to national figures.

const ids = createTestIds();
ids.userEmail = ids.userEmail.replace("@", "-geofilter@");

const div = { parent: randomUUID(), child: randomUUID() };
const rec = {
	linkedToChild: randomUUID(),
	geomInParent: randomUUID(),
	nameOnly: randomUUID(),
};

async function recordIdsIn(divisionId: string): Promise<string[]> {
	const conditions: SQL[] = [
		eq(disasterRecordsTable.countryAccountsId, ids.countryAccountId),
	];
	await applyGeographicFilters(
		{ id: divisionId, names: { en: "Parent" }, geometry: null },
		disasterRecordsTable,
		conditions,
	);
	const rows = await dr
		.select({ id: disasterRecordsTable.id })
		.from(disasterRecordsTable)
		.where(and(...conditions));
	return rows.map((r) => r.id).sort();
}

async function cleanup() {
	await dr.execute(sql`
		DELETE FROM disaster_records WHERE country_accounts_id = ${ids.countryAccountId}
	`);
	await dr.execute(sql`
		DELETE FROM division WHERE country_accounts_id = ${ids.countryAccountId} AND parent_id IS NOT NULL
	`);
	await dr.execute(sql`
		DELETE FROM division WHERE country_accounts_id = ${ids.countryAccountId}
	`);
}

describe("applyGeographicFilters", () => {
	beforeAll(async () => {
		await createTestUser(ids);
		await cleanup();
		for (const [id, parentId, level, env] of [
			[div.parent, null, 1, "0, 0, 10, 10"],
			[div.child, div.parent, 2, "0, 0, 5, 5"],
		] as const) {
			await dr.execute(sql`
				INSERT INTO division (id, parent_id, country_accounts_id, name, level, geom, bbox)
				VALUES (${id}, ${parentId}, ${ids.countryAccountId}, '{"en":"Parent"}'::jsonb, ${level},
					${sql.raw(`ST_MakeEnvelope(${env}, 4326)`)}, ${sql.raw(`ST_MakeEnvelope(${env}, 4326)`)})
			`);
		}
		for (const id of Object.values(rec)) {
			await dr.execute(sql`
				INSERT INTO disaster_records (id, country_accounts_id, "approvalStatus", location_desc)
				VALUES (${id}, ${ids.countryAccountId}, 'published', 'Parent')
			`);
		}
		await dr.execute(sql`
			INSERT INTO disaster_records_division (disaster_record_id, division_id)
			VALUES (${rec.linkedToChild}, ${div.child})
		`);
		await dr.execute(sql`
			INSERT INTO disaster_records_geom (disaster_record_id, geom)
			VALUES (${rec.geomInParent}, ST_SetSRID(ST_MakePoint(7, 7), 4326))
		`);
	});

	afterAll(async () => {
		await cleanup();
		await cleanupTestUser(ids);
	});

	it("matches descendant links and intersecting geometries", async () => {
		expect(await recordIdsIn(div.parent)).toEqual(
			[rec.linkedToChild, rec.geomInParent].sort(),
		);
	});

	it("does not match on location text alone", async () => {
		expect(await recordIdsIn(div.parent)).not.toContain(rec.nameOnly);
	});

	it("restricts a child division to its own records", async () => {
		expect(await recordIdsIn(div.child)).toEqual([rec.linkedToChild]);
	});

	it("fails closed for an unknown division", async () => {
		expect(await recordIdsIn(randomUUID())).toEqual([]);
	});
});
