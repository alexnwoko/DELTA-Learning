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
	ensureFreshReadModel,
	readModelIsStale,
	resetFreshness,
	settleFreshness,
} from "~/backend.server/models/geo/freshness";

// TR-149 (gap review step 5): a change to a record after the last refresh
// makes the read model stale, and the first read starts a background
// refresh that brings it back in step.

const ids = createTestIds();
ids.userEmail = ids.userEmail.replace("@", "-geofresh@");
const div = randomUUID();
const rec = randomUUID();

async function refreshedAt(): Promise<string | null> {
	const res = await dr.execute(sql`
		SELECT refreshed_at::text AS at FROM geo.refresh_log
		WHERE country_accounts_id = ${ids.countryAccountId}
	`);
	return (res.rows[0] as { at: string } | undefined)?.at ?? null;
}

describe("geo read model freshness", () => {
	beforeAll(async () => {
		await resetFreshness();
		await createTestUser(ids);
		const t = ids.countryAccountId;
		await dr.execute(sql`
			INSERT INTO division (id, country_accounts_id, name, level, import_id, geom, bbox)
			VALUES (${div}, ${t}, '{"en":"Fresh"}'::jsonb, 1, 'F1',
				ST_MakeEnvelope(0, 0, 1, 1, 4326), ST_MakeEnvelope(0, 0, 1, 1, 4326))
		`);
		await dr.execute(sql`
			INSERT INTO disaster_records (id, country_accounts_id, "approvalStatus", start_date)
			VALUES (${rec}, ${t}, 'draft', '2020')
		`);
		await dr.execute(sql`
			INSERT INTO disaster_records_division (disaster_record_id, division_id)
			VALUES (${rec}, ${div})
		`);
	});

	afterAll(async () => {
		await resetFreshness();
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
		await dr.execute(sql`DELETE FROM disaster_records WHERE country_accounts_id = ${t}`);
		await dr.execute(sql`DELETE FROM division WHERE id = ${div}`);
		await cleanupTestUser(ids);
	});

	it("is stale before the first refresh, fresh after it", async () => {
		expect(await readModelIsStale(ids.countryAccountId)).toBe(true);
		await refreshGeoReadModel(ids.countryAccountId);
		expect(await readModelIsStale(ids.countryAccountId)).toBe(false);
	});

	it("goes stale when a record changes (an approval), and a read refreshes it in the background", async () => {
		const before = await refreshedAt();
		await new Promise((r) => setTimeout(r, 5));
		await dr.execute(sql`
			UPDATE disaster_records SET "approvalStatus" = 'published', updated_at = now()
			WHERE id = ${rec}
		`);
		expect(await readModelIsStale(ids.countryAccountId)).toBe(true);

		// The page never waits: the call returns at once.
		expect(ensureFreshReadModel(ids.countryAccountId)).toBe("fresh");
		await resetFreshness(); // waits for the background check and refresh
		expect(await readModelIsStale(ids.countryAccountId)).toBe(false);
		expect(await refreshedAt()).not.toBe(before);
		const status = await dr.execute(sql`
			SELECT DISTINCT record_status FROM geo.impact_atom
			WHERE country_accounts_id = ${ids.countryAccountId}
		`);
		expect(status.rows).toEqual([{ record_status: "published" }]);
	});

	it("checks at most once a minute per tenant", async () => {
		const t0 = Date.now();
		ensureFreshReadModel(ids.countryAccountId, t0);
		await settleFreshness(); // the check at t0 is done, and found it fresh
		await new Promise((r) => setTimeout(r, 5));
		await dr.execute(sql`UPDATE disaster_records SET updated_at = now() WHERE id = ${rec}`);
		// Within the minute: no new check, so no refresh starts.
		expect(ensureFreshReadModel(ids.countryAccountId, t0 + 1_000)).toBe("fresh");
		await new Promise((r) => setTimeout(r, 50));
		expect(await readModelIsStale(ids.countryAccountId)).toBe(true);
	});
});
