import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { dr } from "~/db.server";
import {
	createTestIds,
	createTestUser,
	cleanupTestUser,
} from "../test-helpers";
import { createTestBackendContext } from "~/backend.server/context";
import { getAffectedPeopleByHazardFilters } from "~/backend.server/models/analytics/hazard-analysis";
import { fetchDisasterEvents } from "~/backend.server/models/analytics/disaster-events";
import { getAffected } from "~/backend.server/models/analytics/affected-people-by-disaster-event-v2";
import {
	reconciliationBasis,
	reconciliationReadBack,
} from "~/backend.server/models/reconciliationBasis.server";
import { getTotalRecords } from "~/components/ContentPicker/DataSource";
import { contentPickerConfig } from "~/routes/$lang+/analytics+/content-picker-config";
import {
	approvalBasis,
	provisionalSql,
	type ApprovalAudience,
} from "~/utils/approvalBasis";
import { disasterRecordsTable } from "~/drizzle/schema/disasterRecordsTable";

// C23 items 1 to 4 and 6. Tenant A holds one published, one validated, one
// migrated draft and one retired record; tenant B holds one published
// record. Every basis must keep the tenants apart, show published records
// only by default, drop retired records, and let only the reconciliation
// basis see the draft.

const a = createTestIds();
a.userEmail = a.userEmail.replace("@", "-basis-a@");
const b = createTestIds();
b.userEmail = b.userEmail.replace("@", "-basis-b@");
b.countryId = randomUUID();

const runId = `test-run-${randomUUID()}`;
const eventA = randomUUID();
const eventB = randomUUID();
const recA = {
	published: randomUUID(),
	validated: randomUUID(),
	draft: randomUUID(),
	retired: randomUUID(),
};
const recB = randomUUID();
const migration = (extra: string = "") =>
	`{"migration": {"run_id": "${runId}"${extra}}}`;

const filters = (countryAccountsId: string, audience: ApprovalAudience) =>
	({
		countryAccountsId,
		audience,
		hazardTypeId: null,
		hazardClusterId: null,
		specificHazardId: null,
		geographicLevelId: null,
		fromDate: null,
		toDate: null,
	}) as any;

async function insertRecord(
	id: string,
	tenant: string,
	event: string,
	status: string,
	legacy: string | null,
	deaths: number,
) {
	await dr.execute(sql`
		INSERT INTO disaster_records (id, country_accounts_id, "approvalStatus", disaster_event_id, legacy_data)
		VALUES (${id}, ${tenant}, ${status}, ${event}, ${legacy}::jsonb)
	`);
	await dr.execute(sql`
		INSERT INTO human_category_presence (record_id, deaths, deaths_total)
		VALUES (${id}, true, ${deaths})
	`);
}

describe("C23 approval basis and tenant isolation", () => {
	beforeAll(async () => {
		await createTestUser(a);
		await createTestUser(b);
		for (const [ev, tenant, name] of [
			[eventA, a.countryAccountId, "Cyclone Alpha C23"],
			[eventB, b.countryAccountId, "Cyclone Beta C23"],
		]) {
			await dr.execute(sql`INSERT INTO event (id) VALUES (${ev})`);
			await dr.execute(sql`
				INSERT INTO disaster_event (id, country_accounts_id, "approvalStatus", name_national)
				VALUES (${ev}, ${tenant}, 'published', ${name})
			`);
		}
		await insertRecord(
			recA.published,
			a.countryAccountId,
			eventA,
			"published",
			migration(),
			5,
		);
		await insertRecord(
			recA.validated,
			a.countryAccountId,
			eventA,
			"validated",
			null,
			7,
		);
		await insertRecord(
			recA.draft,
			a.countryAccountId,
			eventA,
			"draft",
			migration(),
			11,
		);
		await insertRecord(
			recA.retired,
			a.countryAccountId,
			eventA,
			"published",
			migration(`, "retired": {"run_id": "later", "reason": "absent"}`),
			13,
		);
		await insertRecord(recB, b.countryAccountId, eventB, "published", null, 2);
	});

	afterAll(async () => {
		const all = [...Object.values(recA), recB];
		await dr.execute(
			sql`DELETE FROM human_category_presence WHERE record_id IN (${sql.join(all, sql`, `)})`,
		);
		await dr.execute(
			sql`DELETE FROM disaster_records WHERE id IN (${sql.join(all, sql`, `)})`,
		);
		await dr.execute(
			sql`DELETE FROM disaster_event WHERE id IN (${eventA}, ${eventB})`,
		);
		await dr.execute(sql`DELETE FROM event WHERE id IN (${eventA}, ${eventB})`);
		await cleanupTestUser(a);
		await cleanupTestUser(b);
	});

	it("counts published, non-retired records only, for public and signed-in views", async () => {
		for (const audience of ["public", "signed-in"] as const) {
			const res = await getAffectedPeopleByHazardFilters(
				filters(a.countryAccountId, audience),
			);
			expect(res.totalDeaths).toBe(5);
			expect(res.measures.deaths.recordsTotal).toBe(1);
		}
		const ev = await getAffected(dr as any, eventA, { audience: "public" });
		expect(Number(ev.noDisaggregations.tables.deaths)).toBe(5);
	});

	it("never shows tenant A's rows to tenant B", async () => {
		const res = await getAffectedPeopleByHazardFilters(
			filters(b.countryAccountId, "signed-in"),
		);
		expect(res.totalDeaths).toBe(2);
		expect(res.measures.deaths.recordsTotal).toBe(1);

		const events = await fetchDisasterEvents(b.countryAccountId, "public");
		expect(events.rows.map((r: any) => r.id)).toEqual([eventB]);
		// A search term must not widen the tenant filter.
		const search = await fetchDisasterEvents(
			b.countryAccountId,
			"public",
			"alpha c23",
		);
		expect(search.rows).toHaveLength(0);
	});

	it("keeps the content picker inside the tenant", async () => {
		const ctx = createTestBackendContext();
		const cfg = contentPickerConfig(ctx, "public");
		expect(Number(await getTotalRecords(cfg, "c23", a.countryAccountId))).toBe(
			1,
		);
		expect(Number(await getTotalRecords(cfg, "c23", b.countryAccountId))).toBe(
			1,
		);
		expect(
			Number(await getTotalRecords(cfg, "alpha c23", b.countryAccountId)),
		).toBe(0);
		expect(Number(await getTotalRecords(cfg, "c23", undefined))).toBe(0);
	});

	it("keeps provisional and retired records out of the official basis", async () => {
		const res = await dr.execute(sql`
			SELECT id FROM disaster_records
			WHERE country_accounts_id = ${a.countryAccountId}
				AND ${approvalBasis("official", disasterRecordsTable)}
		`);
		expect(res.rows.map((r: any) => r.id)).toEqual([recA.published]);
	});

	it("labels the migrated draft provisional", async () => {
		const res = await dr
			.select({
				id: disasterRecordsTable.id,
				provisional: provisionalSql(disasterRecordsTable),
			})
			.from(disasterRecordsTable)
			.where(
				sql`${disasterRecordsTable.countryAccountsId} = ${a.countryAccountId}`,
			);
		const byId = Object.fromEntries(res.map((r) => [r.id, r.provisional]));
		expect(byId[recA.draft]).toBe(true);
		expect(byId[recA.published]).toBe(false);
		expect(byId[recA.validated]).toBe(false);
	});

	it("reads back one run for one tenant, drafts included, retired excluded", async () => {
		const rb = await reconciliationReadBack({
			countryAccountsId: a.countryAccountId,
			runId,
		});
		expect(rb.records).toBe(2);
		expect(rb.byApprovalStatus).toEqual({ published: 1, draft: 1 });
		expect(rb.measures.deaths.sum).toBe(16);
		expect(rb.measures.deaths.valuePositive).toBe(2);
		expect(rb.measures.injured.totalNull).toBe(2);
	});

	it("gives tenant B nothing from tenant A's run", async () => {
		const rb = await reconciliationReadBack({
			countryAccountsId: b.countryAccountId,
			runId,
		});
		expect(rb.records).toBe(0);
		expect(rb.measures.deaths.sum).toBe(0);
	});

	it("refuses a reconciliation basis without a tenant or run", () => {
		expect(() =>
			reconciliationBasis({ countryAccountsId: "", runId } as any),
		).toThrow();
		expect(() =>
			reconciliationBasis({ countryAccountsId: a.countryAccountId, runId: "" }),
		).toThrow();
	});
});
