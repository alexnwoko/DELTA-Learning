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
import {
	getChoropleth,
	type GeoRequest,
} from "~/backend.server/models/geo/queries";
import { clearGeoCache } from "~/backend.server/models/geo/cache";
import { parseDeltaQuery } from "~/utils/deltaQuery";
import type { ApprovalAudience } from "~/utils/approvalBasis";

// The geo result cache (I-6, option A) serves an answer until the tenant's
// next refresh, and never across audiences.

const ids = createTestIds();
ids.userEmail = ids.userEmail.replace("@", "-geocache@");
const div = randomUUID();
const recPublished = randomUUID();
const recDraft = randomUUID();

function req(audience: ApprovalAudience): GeoRequest {
	const { query } = parseDeltaQuery(
		new URLSearchParams({ measure: "deaths", level: "1" }),
	);
	return { query, level: 1, audience, notApplied: [] };
}

async function deaths(audience: ApprovalAudience) {
	const body = await getChoropleth(ids.countryAccountId, req(audience));
	return body.cells.find((c) => c.division_id === div)?.value ?? null;
}

describe("geo result cache", () => {
	beforeAll(async () => {
		clearGeoCache();
		await createTestUser(ids);
		const t = ids.countryAccountId;
		await dr.execute(sql`
			INSERT INTO division (id, country_accounts_id, name, level, import_id, geom, bbox)
			VALUES (${div}, ${t}, '{"en":"Cached"}'::jsonb, 1, 'C1',
				ST_MakeEnvelope(0, 0, 1, 1, 4326), ST_MakeEnvelope(0, 0, 1, 1, 4326))
		`);
		for (const [id, status, n] of [
			[recPublished, "published", 5],
			[recDraft, "draft", 100],
		] as const) {
			await dr.execute(sql`
				INSERT INTO disaster_records (id, country_accounts_id, "approvalStatus", start_date)
				VALUES (${id}, ${t}, ${status}, '2020')
			`);
			await dr.execute(sql`
				INSERT INTO human_category_presence (record_id, deaths, deaths_total)
				VALUES (${id}, true, ${n})
			`);
			await dr.execute(sql`
				INSERT INTO disaster_records_division (disaster_record_id, division_id)
				VALUES (${id}, ${div})
			`);
		}
		await refreshGeoReadModel(t);
	});

	afterAll(async () => {
		const t = ids.countryAccountId;
		for (const tbl of [
			"geo.impact_atom",
			"geo.event_atom",
			"geo.division_ancestor",
			"geo.division_geom_cache",
			"geo.refresh_log",
		]) {
			await dr.execute(
				sql`DELETE FROM ${sql.raw(tbl)} WHERE country_accounts_id = ${t}`,
			);
		}
		await dr.execute(
			sql`DELETE FROM disaster_records_division WHERE division_id = ${div}`,
		);
		await dr.execute(
			sql`DELETE FROM human_category_presence WHERE record_id IN (${recPublished}, ${recDraft})`,
		);
		await dr.execute(
			sql`DELETE FROM disaster_records WHERE country_accounts_id = ${t}`,
		);
		await dr.execute(sql`DELETE FROM division WHERE id = ${div}`);
		await cleanupTestUser(ids);
	});

	it("never serves a reviewer's figure to a published-only reader", async () => {
		expect(await deaths("reviewer-provisional")).toBe(105);
		expect(await deaths("signed-in")).toBe(5);
		expect(await deaths("reviewer-provisional")).toBe(105);
	});

	it("keeps an answer until the next refresh, then recomputes", async () => {
		await dr.execute(sql`
			UPDATE human_category_presence SET deaths_total = 7 WHERE record_id = ${recPublished}
		`);
		// The read model has not been refreshed, so the answer is unchanged.
		expect(await deaths("signed-in")).toBe(5);
		await new Promise((r) => setTimeout(r, 5));
		await refreshGeoReadModel(ids.countryAccountId);
		expect(await deaths("signed-in")).toBe(7);
	});
});
