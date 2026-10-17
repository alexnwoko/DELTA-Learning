// A short-lived, per-process cache for the D1 Analysis dashboard loaders.
// The largest tenants take 10 to 20 seconds to compute a view (a dozen
// passes over 130,000 records); a reader switching tabs or filters back
// should not pay that twice. Entries are keyed by loader, the whole context
// (tenant, approval audience, provisional flag) and the query, so tenants
// and approval bases never share an entry. Concurrent callers share one
// computation; a failed computation is not cached.

/** How long a computed view is reused. Figures may lag a save by this much. */
export const DASHBOARD_CACHE_TTL_MS = 10 * 60 * 1000;
/** Upper bound on cached views per process; the oldest is dropped first. */
export const DASHBOARD_CACHE_MAX_ENTRIES = 200;

const cache = new Map<string, { at: number; value: Promise<unknown> }>();

export function cachedDashboard<T>(
	loader: string,
	parts: unknown[],
	compute: () => Promise<T>,
	now: () => number = Date.now,
): Promise<T> {
	const key = `${loader}:${JSON.stringify(parts)}`;
	const hit = cache.get(key);
	if (hit && now() - hit.at < DASHBOARD_CACHE_TTL_MS) {
		return hit.value as Promise<T>;
	}
	const value = compute();
	cache.set(key, { at: now(), value });
	value.catch(() => {
		if (cache.get(key)?.value === value) cache.delete(key);
	});
	while (cache.size > DASHBOARD_CACHE_MAX_ENTRIES) {
		cache.delete(cache.keys().next().value as string);
	}
	return value;
}

/** Drops cached views, for one tenant or all (tests, data loads). */
export function clearDashboardCache(countryAccountsId?: string): void {
	if (!countryAccountsId) {
		cache.clear();
		return;
	}
	for (const k of [...cache.keys()]) {
		if (k.includes(`"countryAccountsId":"${countryAccountsId}"`))
			cache.delete(k);
	}
}
