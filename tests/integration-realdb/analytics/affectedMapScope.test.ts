import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { dr } from "~/db.server";
import {
	createTestIds,
	createTestUser,
	cleanupTestUser,
} from "../test-helpers";
import { getTotalAffectedPeopleByDivision } from "~/backend.server/models/analytics/hazard-analysis";

// The affected-people division map selected records through their disaster
// event, so migrated records (no event) were dropped. Upstream 56c70a87
// removed that event filter, which also removed the only tenant and hazard
// scope. The map now scopes records directly: records without an event
// count, and another tenant's records never do.

const own = createTestIds();
own.userEmail = own.userEmail.replace("@", "-affscope-a@");
const other = createTestIds();
other.userEmail = other.userEmail.replace("@", "-affscope-b@");
const prov = { own: randomUUID(), other: randomUUID() };
const rec = { own: randomUUID(), other: randomUUID() };

const filters = (countryAccountsId: string) => ({
	countryAccountsId,
	audience: "public" as const,
	hazardTypeId: null,
	hazardClusterId: null,
	specificHazardId: null,
	geographicLevelId: null,
	fromDate: null,
	toDate: null,
});

describe("affected-people division map scope", () => {
	beforeAll(async () => {
		await createTestUser(own);
		await createTestUser(other);
		for (const [t, d, r, injured] of [
			[own.countryAccountId, prov.own, rec.own, 7],
			[other.countryAccountId, prov.other, rec.other, 1000],
		] as const) {
			await dr.execute(sql`
				INSERT INTO division (id, country_accounts_id, name, level)
				VALUES (${d}, ${t}, '{"en":"P"}'::jsonb, 1)
			`);
			// No disaster event: the shape of every migrated record.
			await dr.execute(sql`
				INSERT INTO disaster_records (id, country_accounts_id, "approvalStatus")
				VALUES (${r}, ${t}, 'published')
			`);
			await dr.execute(sql`
				INSERT INTO disaster_records_division (disaster_record_id, division_id)
				VALUES (${r}, ${d})
			`);
			await dr.execute(sql`
				INSERT INTO human_category_presence (record_id, injured, injured_total)
				VALUES (${r}, true, ${injured})
			`);
		}
	});

	afterAll(async () => {
		for (const r of Object.values(rec)) {
			await dr.execute(
				sql`DELETE FROM human_category_presence WHERE record_id = ${r}`,
			);
			await dr.execute(
				sql`DELETE FROM disaster_records_division WHERE disaster_record_id = ${r}`,
			);
			await dr.execute(sql`DELETE FROM disaster_records WHERE id = ${r}`);
		}
		await dr.execute(
			sql`DELETE FROM division WHERE id IN (${prov.own}, ${prov.other})`,
		);
		await cleanupTestUser(own);
		await cleanupTestUser(other);
	});

	it("counts records without a disaster event", async () => {
		const rows = await getTotalAffectedPeopleByDivision(
			filters(own.countryAccountId),
		);
		const row = rows.find((r) => r.divisionId === prov.own);
		expect(row?.totalAffected).toBe(7);
	});

	it("never includes another tenant's records", async () => {
		const rows = await getTotalAffectedPeopleByDivision(
			filters(own.countryAccountId),
		);
		expect(rows.map((r) => r.divisionId)).not.toContain(prov.other);
		const total = rows.reduce((s, r) => s + (r.totalAffected ?? 0), 0);
		expect(total).toBe(7);
	});
});
