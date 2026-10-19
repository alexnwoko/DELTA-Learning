import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { dr } from "~/db.server";
import { createTestIds, createTestUser, cleanupTestUser } from "../test-helpers";
import { getHazardMonth } from "~/backend.server/models/analytics/dashboard/hazardMonth.server";
import { DEFAULT_QUERY } from "~/utils/deltaQuery";
import { clearDashboardCache } from "~/backend.server/models/analytics/dashboard/dashboardCache.server";

// Cluster 1046: r1 2020-03 (10 deaths), r2 2021-03 (confirmed zero), r3 2022-07
// (nothing reported), r4 2023 (no month). Cluster 1053: twelve records, one per
// month of 2019; January to November 2 deaths each, December 100 (the outlier).
// Event E1 (2020-03-01) links r1; event E2 starts "2021" (no month), no records.
const ids = createTestIds();
ids.userEmail = ids.userEmail.replace("@", "-hazardmonth@");
const r = { r1: randomUUID(), r2: randomUUID(), r3: randomUUID(), r4: randomUUID() };
const monthly = Array.from({ length: 12 }, () => randomUUID());
const ev = { e1: randomUUID(), e2: randomUUID() };
const Q = { ...DEFAULT_QUERY, measure: "deaths" as const };
const ctx = () => ({ countryAccountsId: ids.countryAccountId, audience: "public" as const, tenantName: "Testland", provisional: false });

describe("getHazardMonth", () => {
	beforeAll(async () => {
		await createTestUser(ids);
		for (const [id, start] of [[ev.e1, "2020-03-01"], [ev.e2, "2021"]]) {
			await dr.execute(sql`INSERT INTO event (id) VALUES (${id})`);
			await dr.execute(sql`
				INSERT INTO disaster_event (id, country_accounts_id, "approvalStatus", start_date)
				VALUES (${id}, ${ids.countryAccountId}, 'published', ${start})`);
		}
		const recs: [string, string, string, string | null][] = [
			[r.r1, "2020-03-05", "1046", ev.e1],
			[r.r2, "2021-03-01", "1046", null],
			[r.r3, "2022-07-01", "1046", null],
			[r.r4, "2023", "1046", null],
			...monthly.map((id, i): [string, string, string, string | null] => [id, `2019-${String(i + 1).padStart(2, "0")}-10`, "1053", null]),
		];
		for (const [id, start, cl, e] of recs) {
			await dr.execute(sql`
				INSERT INTO disaster_records (id, country_accounts_id, "approvalStatus", start_date, hip_cluster_id, disaster_event_id)
				VALUES (${id}, ${ids.countryAccountId}, 'published', ${start}, ${cl}, ${e})`);
		}
		await dr.execute(sql`INSERT INTO human_category_presence (record_id, deaths, deaths_total) VALUES (${r.r1}, true, 10), (${r.r2}, true, 0)`);
		for (const [i, id] of monthly.entries()) {
			await dr.execute(sql`INSERT INTO human_category_presence (record_id, deaths, deaths_total) VALUES (${id}, true, ${i === 11 ? 100 : 2})`);
		}
	});

	afterAll(async () => {
		const all = sql.join([...Object.values(r), ...monthly].map((x) => sql`${x}`), sql`, `);
		await dr.execute(sql`DELETE FROM human_category_presence WHERE record_id IN (${all})`);
		await dr.execute(sql`DELETE FROM disaster_records WHERE country_accounts_id = ${ids.countryAccountId}`);
		await dr.execute(sql`DELETE FROM disaster_event WHERE country_accounts_id = ${ids.countryAccountId}`);
		await dr.execute(sql`DELETE FROM event WHERE id IN (${ev.e1}, ${ev.e2})`);
		await cleanupTestUser(ids);
	});

	it("records: all 12 months per hazard, value states kept, year-only records counted apart", async () => {
		const p = await getHazardMonth(Q, ctx(), "disaster_record");
		expect(p.unit).toBe("disaster_record");
		expect(p.rows.map((x) => [x.hipClusterId, x.total])).toEqual([["1053", 12], ["1046", 3]]);
		const c1046 = p.rows.find((x) => x.hipClusterId === "1046")!;
		expect(c1046.cells).toHaveLength(12);
		const mar = c1046.cells[2];
		expect(mar).toMatchObject({ month: 3, count: 2 });
		expect(mar.people).toMatchObject({ value: 10, valueState: "reported", recordsZeroConfirmed: 1 });
		expect(c1046.cells[6].people.valueState).toBe("not_reported");
		expect(c1046.cells[6].people.value).toBeNull();
		expect(p.withoutMonth).toBe(1);
		expect(p.years).toEqual({ from: 2019, to: 2023 });
	});

	it("records: flags the month where one occurrence carries a toll far above the hazard's median", async () => {
		const p = await getHazardMonth(Q, ctx(), "disaster_record");
		const c1053 = p.rows.find((x) => x.hipClusterId === "1053")!;
		expect(c1053.cells.filter((c) => c.rare).map((c) => c.month)).toEqual([12]);
		// 1046 has too few reporting records for the rule.
		expect(p.rows.find((x) => x.hipClusterId === "1046")!.cells.some((c) => c.rare)).toBe(false);
		expect(p.meta.method).toContain("Rare severe");
	});

	it("events: an event takes its linked records' cluster and its own start month", async () => {
		const p = await getHazardMonth(Q, ctx(), "disaster_event");
		expect(p.unit).toBe("disaster_event");
		const c1046 = p.rows.find((x) => x.hipClusterId === "1046")!;
		expect(c1046.total).toBe(1);
		expect(c1046.cells[2]).toMatchObject({ month: 3, count: 1 });
		expect(c1046.cells[2].people.value).toBe(10);
		expect(p.withoutMonth).toBe(1);
	});

	it("treats a calendar day used as a default as no month, and counts it apart", async () => {
		const extra = Array.from({ length: 10 }, () => randomUUID());
		for (const [i, id] of extra.entries()) {
			await dr.execute(sql`
				INSERT INTO disaster_records (id, country_accounts_id, "approvalStatus", start_date, hip_cluster_id)
				VALUES (${id}, ${ids.countryAccountId}, 'published', ${`${2000 + i}-01-31`}, '1046')`);
		}
		clearDashboardCache(ids.countryAccountId);
		try {
			const p = await getHazardMonth(Q, ctx(), "disaster_record");
			expect(p.placeholderDates).toBe(10);
			expect(p.rows.find((x) => x.hipClusterId === "1046")!.cells[0].count).toBe(0);
			expect(p.meta.method).toContain("placeholder dates");
		} finally {
			const all = sql.join(extra.map((x) => sql`${x}`), sql`, `);
			await dr.execute(sql`DELETE FROM disaster_records WHERE id IN (${all})`);
			clearDashboardCache(ids.countryAccountId);
		}
	});

	it("a record under review never makes its month rare", async () => {
		const outlier = monthly[11];
		await dr.execute(sql`
			UPDATE disaster_records SET legacy_data = ${JSON.stringify({ migration: { plausibility_flags: [{ code: "IMPLAUSIBLE_MAGNITUDE", fields: ["muertos"] }] } })}::jsonb
			WHERE id = ${outlier}`);
		clearDashboardCache(ids.countryAccountId);
		try {
			const p = await getHazardMonth(Q, ctx(), "disaster_record");
			const c1053 = p.rows.find((x) => x.hipClusterId === "1053")!;
			expect(c1053.cells.some((c) => c.rare)).toBe(false);
			expect(c1053.cells[11].count).toBe(1);
			expect(p.meta.method).toContain("under review");
		} finally {
			await dr.execute(sql`UPDATE disaster_records SET legacy_data = NULL WHERE id = ${outlier}`);
			clearDashboardCache(ids.countryAccountId);
		}
	});

	it("defaults the people measure to directly affected when the query names none", async () => {
		const p = await getHazardMonth(DEFAULT_QUERY, ctx(), "disaster_record");
		expect(p.measure).toBe("affected_direct");
		expect(p.meta.method).toContain("affected_direct");
	});

	it("names specific hazards and keeps a hazard whose dates are mostly a source default", async () => {
		// Ten drought records on 7 September (a source default) and two dated in August.
		const drought = Array.from({ length: 12 }, () => randomUUID());
		for (const [i, id] of drought.entries()) {
			const start = i < 10 ? `${2000 + i}-09-07` : `${2010 + i}-08-15`;
			await dr.execute(sql`
				INSERT INTO disaster_records (id, country_accounts_id, "approvalStatus", start_date, hip_cluster_id, hip_hazard_id)
				VALUES (${id}, ${ids.countryAccountId}, 'published', ${start}, '1076', '78600')`);
			await dr.execute(sql`INSERT INTO human_category_presence (record_id, affected_direct, affected_direct_total) VALUES (${id}, true, 1000)`);
		}
		clearDashboardCache(ids.countryAccountId);
		try {
			const p = await getHazardMonth(DEFAULT_QUERY, ctx(), "disaster_record");
			const d = p.rows.find((x) => x.key === "78600")!;
			expect(d).toMatchObject({ level: "hazard", label: "Drought", hipClusterId: "1076", total: 2, allOccurrences: 12 });
			expect(d.unplaced).toEqual({ placeholder: 10, noMonth: 0 });
			expect(d.cells[7]).toMatchObject({ month: 8, count: 2 });
			expect(d.cells[7].people.value).toBe(2000);
			expect(d.people.value).toBe(2000);
			expect(p.placeholderDays[0]).toEqual({ day: "09-07", occurrences: 10 });
			// Records coded only to a cluster keep a cluster row.
			expect(p.rows.find((x) => x.key === "cluster:1053")!.level).toBe("cluster");
		} finally {
			const all = sql.join(drought.map((x) => sql`${x}`), sql`, `);
			await dr.execute(sql`DELETE FROM human_category_presence WHERE record_id IN (${all})`);
			await dr.execute(sql`DELETE FROM disaster_records WHERE id IN (${all})`);
			clearDashboardCache(ids.countryAccountId);
		}
	});
});
