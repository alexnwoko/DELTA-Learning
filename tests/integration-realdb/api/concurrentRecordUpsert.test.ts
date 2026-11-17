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
import { jsonUpsert } from "~/backend.server/handlers/form/form_api";
import {
	disasterRecordsCreate,
	disasterRecordsUpdate,
	disasterRecordsIdByImportIdAndCountryAccountsId,
} from "~/backend.server/models/disaster_record";
import { fieldsDefApi } from "~/frontend/disaster-record/form";

// Bulk-load blocker (2026-09-30): record upserts held a transaction while
// the footprint and hazard lookups took a second connection from the global
// pool. With more concurrent upserts than pool connections, every connection
// sat "idle in transaction" waiting for another and the API stopped
// responding. The lookups now run on the upsert's own transaction.

const ids = createTestIds();
ids.userEmail = ids.userEmail.replace("@", "-concurrent@");
const divisionId = randomUUID();
const CONCURRENT = 30; // above the node-postgres default pool size of 10
const importIds = Array.from(
	{ length: CONCURRENT },
	(_, i) => `concurrent-${i}-${randomUUID()}`,
);

describe("concurrent disaster record upserts", () => {
	let hip = { hazard: "", cluster: "", type: "" };

	beforeAll(async () => {
		await createTestUser(ids);
		const geojson = {
			type: "Polygon",
			coordinates: [
				[
					[13, -9],
					[14, -9],
					[14, -8],
					[13, -8],
					[13, -9],
				],
			],
		};
		await dr.execute(sql`
			INSERT INTO division (id, country_accounts_id, name, level, geojson)
			VALUES (${divisionId}, ${ids.countryAccountId}, '{"en":"Luanda"}'::jsonb, 1,
				${JSON.stringify(geojson)}::jsonb)
		`);
		const chain = await dr.execute(sql`
			SELECT h.id AS hazard, c.id AS cluster, c.type_id AS type
			FROM hip_hazard h JOIN hip_cluster c ON c.id = h.cluster_id
			LIMIT 1
		`);
		const row = chain.rows[0] as Record<string, string>;
		hip = { hazard: row.hazard, cluster: row.cluster, type: row.type };
	});

	afterAll(async () => {
		await dr.execute(sql`
			DELETE FROM disaster_records_division WHERE disaster_record_id IN (
				SELECT id FROM disaster_records WHERE country_accounts_id = ${ids.countryAccountId})
		`);
		await dr.execute(
			sql`DELETE FROM disaster_records WHERE country_accounts_id = ${ids.countryAccountId}`,
		);
		await dr.execute(sql`DELETE FROM division WHERE id = ${divisionId}`);
		await cleanupTestUser(ids);
	});

	it("completes more concurrent upserts than pool connections", async () => {
		const ctx = createTestBackendContext();
		const fieldsDef = [
			...fieldsDefApi(ctx),
			{ key: "countryAccountsId", label: "", type: "text" },
		] as any;
		const upsert = (apiImportId: string) =>
			jsonUpsert({
				ctx,
				data: [
					{
						apiImportId,
						countryAccountsId: ids.countryAccountId,
						hipHazardId: hip.hazard,
						hipClusterId: hip.cluster,
						hipTypeId: hip.type,
						endDate: null,
						startDate: "2020-01-01",
						primaryDataSource: "Test",
						originatorRecorderInst: "Test",
						spatialFootprint: [
							{
								id: randomUUID(),
								title: "Division",
								map_option: "Geographic level",
								division_id: divisionId,
							},
						],
					},
				],
				fieldsDef,
				create: disasterRecordsCreate,
				update: (c: any, tx: any, id: string, fields: any) =>
					disasterRecordsUpdate(c, tx, id, fields, ids.countryAccountId),
				idByImportIdAndCountryAccountsId:
					disasterRecordsIdByImportIdAndCountryAccountsId,
				countryAccountsId: ids.countryAccountId,
			});

		const stalled = new Promise((_, reject) =>
			setTimeout(
				() => reject(new Error("pool deadlock: upserts stalled")),
				30_000,
			),
		);
		const results = (await Promise.race([
			Promise.all(importIds.map(upsert)),
			stalled,
		])) as Awaited<ReturnType<typeof upsert>>[];

		for (const r of results) {
			expect(r.ok, JSON.stringify(r.res)).toBe(true);
		}
		const n = await dr.execute(sql`
			SELECT count(*)::int AS n FROM disaster_records
			WHERE country_accounts_id = ${ids.countryAccountId}
		`);
		expect(n.rows[0].n).toBe(CONCURRENT);

		// The division lookups ran inside each transaction: every record is
		// linked to its division.
		const links = await dr.execute(sql`
			SELECT count(*)::int AS n FROM disaster_records_division
			WHERE division_id = ${divisionId}
		`);
		expect(links.rows[0].n).toBe(CONCURRENT);
	}, 60_000);
});
