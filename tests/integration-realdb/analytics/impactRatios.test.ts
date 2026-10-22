import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { dr } from "~/db.server";
import { createTestIds, createTestUser, cleanupTestUser } from "../test-helpers";
import { getImpactRatios, RATIO_MIN_RECORDS } from "~/backend.server/models/analytics/dashboard/impactRatios.server";
import { DEFAULT_QUERY } from "~/utils/deltaQuery";

// Flooding (94492): 11 records with 2 deaths and 4 injured (ratio 2), plus one
// flagged record with 1 death and 100 injured that must be left out. Drought
// (78600): 5 records with both figures, too few for a ratio.
const ids = createTestIds();
ids.userEmail = ids.userEmail.replace("@", "-ratios@");
const recs: string[] = [];
const ctx = () => ({ countryAccountsId: ids.countryAccountId, audience: "public" as const, tenantName: "Testland", provisional: false });

async function add(hazard: string, deaths: number, injured: number, flagged = false) {
	const id = randomUUID();
	recs.push(id);
	await dr.execute(sql`
		INSERT INTO disaster_records (id, country_accounts_id, "approvalStatus", start_date, hip_hazard_id, legacy_data)
		VALUES (${id}, ${ids.countryAccountId}, 'published', '2020-01-01', ${hazard},
			${flagged ? JSON.stringify({ migration: { plausibility_flags: [{ code: "IMPLAUSIBLE_MAGNITUDE", fields: ["heridos"] }] } }) : null}::jsonb)`);
	await dr.execute(sql`INSERT INTO human_category_presence (record_id, deaths, deaths_total, injured, injured_total) VALUES (${id}, true, ${deaths}, true, ${injured})`);
}

describe("getImpactRatios", () => {
	beforeAll(async () => {
		await createTestUser(ids);
		for (let i = 0; i < 11; i++) await add("94492", 2, 4);
		await add("94492", 1, 100, true);
		for (let i = 0; i < 5; i++) await add("78600", 1, 3);
	});

	afterAll(async () => {
		const all = sql.join(recs.map((x) => sql`${x}`), sql`, `);
		await dr.execute(sql`DELETE FROM human_category_presence WHERE record_id IN (${all})`);
		await dr.execute(sql`DELETE FROM disaster_records WHERE country_accounts_id = ${ids.countryAccountId}`);
		await cleanupTestUser(ids);
	});

	it("gives the median injured per death by specific hazard, leaving out records under review", async () => {
		const p = await getImpactRatios(DEFAULT_QUERY, ctx());
		const flood = p.rows.find((r) => r.key === "94492")!;
		expect(flood.label).toBe("Flooding");
		expect(flood.injuredPerDeath).toEqual({ median: 2, records: 11, suppressed: false });
		expect(flood.displacedPerDwellingDestroyed).toEqual({ median: null, records: 0, suppressed: true });
	});

	it("suppresses a ratio with too few records instead of showing 0", async () => {
		const p = await getImpactRatios(DEFAULT_QUERY, ctx());
		const drought = p.rows.find((r) => r.key === "78600")!;
		expect(drought.injuredPerDeath).toEqual({ median: null, records: 5, suppressed: true });
		expect(p.minRecords).toBe(RATIO_MIN_RECORDS);
		expect(p.meta.method).toContain("not a rate");
	});
});
