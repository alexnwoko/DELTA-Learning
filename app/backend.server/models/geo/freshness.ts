// Keeps the geo read model in step with the records (TR-149; gap review
// step 5). The read model is rebuilt per tenant by refreshGeoReadModel,
// which holds a per-tenant advisory lock. Nothing called it after an
// approval change or a migration load, so the maps could lag the records
// until someone ran scripts/geo-refresh.ts.
//
// Rather than hook every place that changes a record (record and event
// approval, editing, imports, migration loads, owned by other lanes), the
// geoportal checks freshness when it is read: if a disaster record, disaster
// event or hazardous event of the tenant changed after the last refresh, a
// background refresh starts and the page says the figures are being
// updated. Limits: a deleted row is not seen (records are retired, not
// deleted, in normal use), and the check runs at most once a minute per
// tenant and server.
import { sql } from "drizzle-orm";
import { dr } from "~/db.server";
import { refreshGeoReadModel } from "~/backend.server/models/geo/refresh";

const CHECK_EVERY_MS = 60_000;

const lastCheck = new Map<string, { at: number; stale: boolean }>();
const running = new Map<string, Promise<unknown>>();
/** Tenants whose read model is being rebuilt now (not just checked). */
const refreshing = new Set<string>();

/** True when a record or event changed after the tenant's last refresh. */
export async function readModelIsStale(countryAccountsId: string): Promise<boolean> {
	const t = countryAccountsId;
	const res = await dr.execute(sql`
		WITH last AS (
			SELECT refreshed_at FROM geo.refresh_log WHERE country_accounts_id = ${t}
		),
		changed AS (
			SELECT GREATEST(
				(SELECT max(GREATEST(updated_at, created_at)) FROM disaster_records
					WHERE country_accounts_id = ${t}),
				(SELECT max(GREATEST(updated_at, created_at)) FROM disaster_event
					WHERE country_accounts_id = ${t}),
				(SELECT max(GREATEST(updated_at, created_at)) FROM hazardous_event
					WHERE country_accounts_id = ${t})
			) AS at
		)
		SELECT
			(SELECT refreshed_at FROM last) IS NULL AS never,
			(SELECT at FROM changed) > (SELECT refreshed_at FROM last) AS newer
	`);
	const row = res.rows[0] as { never: boolean; newer: boolean | null };
	return Boolean(row.never) || Boolean(row.newer);
}

export type Freshness = "fresh" | "updating";

/**
 * Never makes the caller wait: the staleness check (about 1 s on the largest
 * tenant, 2026-10-22) and any refresh run in the background, at most one at
 * a time per tenant on this server (the advisory lock in
 * refreshGeoReadModel serialises servers). Returns "updating" while a
 * refresh runs, so the page can say the figures are being updated. Never
 * throws: a failed check or refresh leaves the maps as they were.
 */
export function ensureFreshReadModel(
	countryAccountsId: string,
	now = Date.now(),
): Freshness {
	const t = countryAccountsId;
	if (refreshing.has(t)) return "updating";
	const prev = lastCheck.get(t);
	if (!running.has(t) && (!prev || now - prev.at >= CHECK_EVERY_MS)) {
		lastCheck.set(t, { at: now, stale: false });
		const job = readModelIsStale(t)
			.then(async (stale) => {
				lastCheck.set(t, { at: now, stale });
				if (!stale) return;
				refreshing.add(t);
				try {
					await refreshGeoReadModel(t);
				} finally {
					refreshing.delete(t);
				}
			})
			.catch((err) => console.error("geo freshness or refresh failed", t, err))
			.finally(() => {
				running.delete(t);
			});
		running.set(t, job);
	}
	return "fresh";
}

/** For tests: wait for running checks and refreshes, keeping what was checked. */
export async function settleFreshness(): Promise<void> {
	await Promise.all(running.values());
}

/** For tests: forget checks and wait for running refreshes. */
export async function resetFreshness(): Promise<void> {
	await Promise.all(running.values());
	running.clear();
	refreshing.clear();
	lastCheck.clear();
}
