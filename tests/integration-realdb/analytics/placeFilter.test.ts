import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { dr } from "~/db.server";
import {
	createTestIds,
	createTestUser,
	cleanupTestUser,
} from "../test-helpers";
import { refreshGeoReadModel } from "~/backend.server/models/geo/refresh";
import { getRecordsByApproval } from "~/backend.server/models/analytics/dashboard/recordsByApproval.server";
import { clearDashboardCache } from "~/backend.server/models/analytics/dashboard/dashboardCache.server";
import { DEFAULT_QUERY } from "~/utils/deltaQuery";

// The place filter: a division and its descendants, never its whole
// level-1 parent; a region through its member divisions (RG-1).
// North (level 1) has districts East and West; South is level 1.
// Records: a in East, b in West, c in South.

const ids = createTestIds();
ids.userEmail = ids.userEmail.replace("@", "-placefilter@");
const div = {
	north: randomUUID(),
	east: randomUUID(),
	west: randomUUID(),
	south: randomUUID(),
};
const rec = { a: randomUUID(), b: randomUUID(), c: randomUUID() };
const region = randomUUID();

const ctx = () => ({
	countryAccountsId: ids.countryAccountId,
	audience: "public" as const,
	tenantName: "Testland",
	provisional: false,
});
const count = async (where: object) => {
	clearDashboardCache();
	return (await getRecordsByApproval({ ...DEFAULT_QUERY, where }, ctx()))
		.published;
};

describe("place filter", () => {
	beforeAll(async () => {
		await createTestUser(ids);
		const t = ids.countryAccountId;
		await dr.execute(sql`
			INSERT INTO division (id, country_accounts_id, name, level, parent_id, national_id) VALUES
			(${div.north}, ${t}, '{"en":"North"}', 1, NULL, 'N'),
			(${div.south}, ${t}, '{"en":"South"}', 1, NULL, 'S'),
			(${div.east}, ${t}, '{"en":"East"}', 2, ${div.north}, 'NE'),
			(${div.west}, ${t}, '{"en":"West"}', 2, ${div.north}, 'NW')`);
		for (const [id, d] of [
			[rec.a, div.east],
			[rec.b, div.west],
			[rec.c, div.south],
		]) {
			await dr.execute(sql`
				INSERT INTO disaster_records (id, country_accounts_id, "approvalStatus", start_date)
				VALUES (${id}, ${t}, 'published', '2020')`);
			await dr.execute(sql`
				INSERT INTO disaster_records_division (disaster_record_id, division_id) VALUES (${id}, ${d})`);
		}
		await refreshGeoReadModel(t);
		await dr.execute(sql`
			INSERT INTO geo.region (region_id, country_accounts_id, name, kind, member_level)
			VALUES (${region}, ${t}, '{"en":"Southern"}', 'planning', 1)`);
		await dr.execute(sql`
			INSERT INTO geo.region_member (region_id, country_accounts_id, division_id)
			VALUES (${region}, ${t}, ${div.south})`);
	});

	afterAll(async () => {
		const t = ids.countryAccountId;
		await dr.execute(
			sql`DELETE FROM geo.region_member WHERE country_accounts_id = ${t}`,
		);
		await dr.execute(
			sql`DELETE FROM geo.region WHERE country_accounts_id = ${t}`,
		);
		for (const table of [
			"event_atom",
			"impact_atom",
			"division_ancestor",
			"refresh_log",
		])
			await dr.execute(
				sql`DELETE FROM ${sql.raw(`geo.${table}`)} WHERE country_accounts_id = ${t}`,
			);
		await dr.execute(
			sql`DELETE FROM disaster_records_division WHERE disaster_record_id IN (${rec.a}, ${rec.b}, ${rec.c})`,
		);
		await dr.execute(
			sql`DELETE FROM disaster_records WHERE country_accounts_id = ${t}`,
		);
		await dr.execute(
			sql`DELETE FROM division WHERE country_accounts_id = ${t} AND level = 2`,
		);
		await dr.execute(
			sql`DELETE FROM division WHERE country_accounts_id = ${t}`,
		);
		await cleanupTestUser(ids);
	});

	it("keeps a district to itself, not its whole province", async () => {
		expect(await count({ geo: { divisionId: div.east } })).toBe(1);
	});

	it("takes a province with its districts", async () => {
		expect(await count({ geo: { divisionId: div.north } })).toBe(2);
	});

	it("takes a region through its member divisions", async () => {
		expect(await count({ region: { regionId: region } })).toBe(1);
		expect(await count({})).toBe(3);
	});
});
