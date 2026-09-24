import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { dr } from "~/db.server";
import {
	createTestIds,
	createTestUser,
	cleanupTestUser,
} from "../test-helpers";
import { getGeographicImpact } from "~/backend.server/models/analytics/geographicImpact";

// Regression suite for the geographic impact map on the post-footprint
// schema: records reach a division through disaster_records_division or
// through a disaster_records_geom geometry, never through JSON footprints.

const ids = createTestIds();
ids.userEmail = ids.userEmail.replace("@", "-geoimpact@");

const div = {
	parent: randomUUID(),
	child: randomUUID(),
	other: randomUUID(),
};
const rec = {
	linkedToChild: randomUUID(),
	geomInParent: randomUUID(),
	unpublished: randomUUID(),
};
let hazardA = "";
let hazardB = "";
let sectorId = "";

function box(x0: number, y0: number, x1: number, y1: number) {
	return sql.raw(`ST_MakeEnvelope(${x0}, ${y0}, ${x1}, ${y1}, 4326)`);
}

async function insertDivision(
	id: string,
	parentId: string | null,
	level: number,
	geom: ReturnType<typeof box>,
) {
	await dr.execute(sql`
		INSERT INTO division (id, parent_id, country_accounts_id, name, level, geom, bbox)
		VALUES (${id}, ${parentId}, ${ids.countryAccountId},
			${JSON.stringify({ en: `Division ${id.slice(0, 8)}` })}::jsonb,
			${level}, ${geom}, ${geom})
	`);
}

async function insertRecord(
	id: string,
	hipTypeId: string,
	approvalStatus: string,
	damageCost: number,
) {
	await dr.execute(sql`
		INSERT INTO disaster_records (id, country_accounts_id, "approvalStatus", hip_type_id, start_date, end_date)
		VALUES (${id}, ${ids.countryAccountId}, ${approvalStatus}, ${hipTypeId}, '2020-05-01', '2020-05-10')
	`);
	await dr.execute(sql`
		INSERT INTO sector_disaster_records_relation (sector_id, disaster_record_id, with_damage, damage_cost)
		VALUES (${sectorId}, ${id}, true, ${damageCost})
	`);
}

async function cleanup() {
	const recordIds = Object.values(rec);
	await dr.execute(sql`
		DELETE FROM sector_disaster_records_relation
		WHERE disaster_record_id IN (${sql.join(recordIds, sql`, `)})
	`);
	await dr.execute(sql`
		DELETE FROM disaster_records WHERE id IN (${sql.join(recordIds, sql`, `)})
	`);
	await dr.execute(sql`
		DELETE FROM division WHERE country_accounts_id = ${ids.countryAccountId} AND parent_id IS NOT NULL
	`);
	await dr.execute(sql`
		DELETE FROM division WHERE country_accounts_id = ${ids.countryAccountId}
	`);
}

describe("getGeographicImpact", () => {
	beforeAll(async () => {
		await createTestUser(ids);
		const hips = await dr.execute(
			sql`SELECT id FROM hip_class ORDER BY id LIMIT 2`,
		);
		hazardA = String(hips.rows[0].id);
		hazardB = String(hips.rows[1].id);
		const sectors = await dr.execute(sql`SELECT id FROM sector LIMIT 1`);
		sectorId = String(sectors.rows[0].id);

		await cleanup();
		await insertDivision(div.parent, null, 1, box(0, 0, 10, 10));
		await insertDivision(div.child, div.parent, 2, box(0, 0, 5, 5));
		await insertDivision(div.other, null, 1, box(20, 20, 30, 30));

		// Reaches the parent through a link to its child division.
		await insertRecord(rec.linkedToChild, hazardA, "published", 100);
		await dr.execute(sql`
			INSERT INTO disaster_records_division (disaster_record_id, division_id)
			VALUES (${rec.linkedToChild}, ${div.child})
		`);

		// Reaches the parent through a drawn point inside it.
		await insertRecord(rec.geomInParent, hazardB, "published", 50);
		await dr.execute(sql`
			INSERT INTO disaster_records_geom (disaster_record_id, geom)
			VALUES (${rec.geomInParent}, ST_SetSRID(ST_MakePoint(7, 7), 4326))
		`);

		// Never counted: not published.
		await insertRecord(rec.unpublished, hazardA, "draft", 1000);
		await dr.execute(sql`
			INSERT INTO disaster_records_division (disaster_record_id, division_id)
			VALUES (${rec.unpublished}, ${div.parent})
		`);
	});

	afterAll(async () => {
		await cleanup();
		await cleanupTestUser(ids);
	});

	it("counts linked and geometry-matched published records", async () => {
		const result = await getGeographicImpact(ids.countryAccountId, {});
		expect(result.success).toBe(true);
		expect(result.values[div.parent]).toMatchObject({
			totalDamage: 150,
			dataAvailability: "available",
		});
		expect(result.values[div.other].dataAvailability).toBe("no_data");
	});

	it("applies the hazard type filter instead of emptying the map", async () => {
		const a = await getGeographicImpact(ids.countryAccountId, {
			hazardTypeId: hazardA,
		});
		expect(a.values[div.parent].totalDamage).toBe(100);

		const b = await getGeographicImpact(ids.countryAccountId, {
			hazardTypeId: hazardB,
		});
		expect(b.values[div.parent].totalDamage).toBe(50);
	});

	it("applies the date range filter", async () => {
		const outside = await getGeographicImpact(ids.countryAccountId, {
			fromDate: "2021-01-01",
		});
		expect(outside.values[div.parent].dataAvailability).toBe("no_data");
	});
});
