import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { dr } from "~/db.server";
import { createTestBackendContext } from "~/backend.server/context";
import {
	createTestIds,
	createTestUser,
	cleanupTestUser,
} from "../test-helpers";
import { getEffectDetails } from "~/backend.server/models/analytics/effectDetails";

// Regression suite for the sector effect-detail tables: they selected the
// dropped spatialFootprint columns, compared the specific hazard with the
// hazard type, and filtered hazards through event joins that dropped records
// without a disaster event.

const ids = createTestIds();
ids.userEmail = ids.userEmail.replace("@", "-effects@");

const recordId = randomUUID();
let hipTypeId = "";
let hipHazardId = "";
let otherHipHazardId = "";
let sectorId = "";

const noFilters = {
	sectorId: null,
	subSectorId: null,
	hazardTypeId: null,
	hazardClusterId: null,
	specificHazardId: null,
	geographicLevelId: null,
	fromDate: null,
	toDate: null,
	disasterEventId: null,
};

async function cleanup() {
	await dr.execute(sql`DELETE FROM losses WHERE record_id = ${recordId}`);
	await dr.execute(sql`DELETE FROM disruption WHERE record_id = ${recordId}`);
	await dr.execute(sql`DELETE FROM disaster_records WHERE id = ${recordId}`);
}

describe("getEffectDetails", () => {
	beforeAll(async () => {
		await createTestUser(ids);
		const hazards = await dr.execute(sql`
			SELECT h.id AS hazard_id, c.type_id
			FROM hip_hazard h JOIN hip_cluster c ON c.id = h.cluster_id
			ORDER BY h.id LIMIT 2
		`);
		hipHazardId = String(hazards.rows[0].hazard_id);
		hipTypeId = String(hazards.rows[0].type_id);
		otherHipHazardId = String(hazards.rows[1].hazard_id);
		const sectors = await dr.execute(sql`SELECT id FROM sector LIMIT 1`);
		sectorId = String(sectors.rows[0].id);

		await cleanup();
		// A published record with no disaster event: it must still count.
		await dr.execute(sql`
			INSERT INTO disaster_records (id, country_accounts_id, "approvalStatus", hip_type_id, hip_hazard_id)
			VALUES (${recordId}, ${ids.countryAccountId}, 'published', ${hipTypeId}, ${hipHazardId})
		`);
		await dr.execute(sql`
			INSERT INTO losses (record_id, sector_id, sector_is_agriculture, public_cost_total, public_cost_total_override)
			VALUES (${recordId}, ${sectorId}, false, 500, true)
		`);
		await dr.execute(sql`
			INSERT INTO disruption (record_id, sector_id, duration_days)
			VALUES (${recordId}, ${sectorId}, 3)
		`);
	});

	afterAll(async () => {
		await cleanup();
		await cleanupTestUser(ids);
	});

	it("returns effects for records without a disaster event", async () => {
		const res = await getEffectDetails(
			createTestBackendContext(),
			ids.countryAccountId,
			noFilters,
		);
		expect(res.losses).toHaveLength(1);
		expect(res.disruptions).toHaveLength(1);
	});

	it("filters on the specific hazard, not the hazard type", async () => {
		const match = await getEffectDetails(
			createTestBackendContext(),
			ids.countryAccountId,
			{ ...noFilters, hazardTypeId: hipTypeId, specificHazardId: hipHazardId },
		);
		expect(match.losses).toHaveLength(1);

		const other = await getEffectDetails(
			createTestBackendContext(),
			ids.countryAccountId,
			{ ...noFilters, specificHazardId: otherHipHazardId },
		);
		expect(other.losses).toHaveLength(0);
	});

	it("returns nothing for an unknown division rather than national figures", async () => {
		const res = await getEffectDetails(
			createTestBackendContext(),
			ids.countryAccountId,
			{ ...noFilters, geographicLevelId: randomUUID() },
		);
		expect(res.losses).toHaveLength(0);
		expect(res.disruptions).toHaveLength(0);
	});
});
