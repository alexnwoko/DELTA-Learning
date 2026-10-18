// Result cache for geo reads (I-6, NFR-113; Alex chose option A,
// 2026-10-18). The read model changes only when geo.refresh_log moves for a
// tenant, so an answer is valid until that tenant's next refresh: the key
// carries the tenant, the refresh time and the whole resolved request
// (selection, level, audience, notApplied), so a published reader and a
// reviewer never share an entry, and a refresh retires every old entry.
// In-process and bounded (least recently used goes first); concurrent calls
// for the same key share one query.

const MAX_ENTRIES = 500;

const entries = new Map<string, Promise<unknown>>();

/** Stable JSON: object keys sorted, so equal requests give equal keys. */
export function stableKey(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(stableKey).join(",")}]`;
	const obj = value as Record<string, unknown>;
	return `{${Object.keys(obj)
		.filter((k) => obj[k] !== undefined)
		.sort()
		.map((k) => `${JSON.stringify(k)}:${stableKey(obj[k])}`)
		.join(",")}}`;
}

/**
 * Returns the cached answer for `parts`, or runs `compute` once and keeps
 * its result. A failed computation is not kept, so a refusal or an error is
 * recomputed next time.
 */
export async function cachedGeo<T>(
	name: string,
	countryAccountsId: string,
	refreshedAt: string | null,
	parts: unknown,
	compute: () => Promise<T>,
): Promise<T> {
	// Nothing to key on before the first refresh: never cache.
	if (refreshedAt === null) return compute();
	const key = `${name}|${countryAccountsId}|${refreshedAt}|${stableKey(parts)}`;
	const hit = entries.get(key);
	if (hit) {
		// Least recently used order: move to the end.
		entries.delete(key);
		entries.set(key, hit);
		return hit as Promise<T>;
	}
	const pending = compute();
	entries.set(key, pending);
	pending.catch(() => {
		if (entries.get(key) === pending) entries.delete(key);
	});
	while (entries.size > MAX_ENTRIES) {
		const oldest = entries.keys().next().value as string;
		entries.delete(oldest);
	}
	return pending;
}

/** For tests: empty the cache. */
export function clearGeoCache(): void {
	entries.clear();
}

/** For tests and monitoring: entries held. */
export function geoCacheSize(): number {
	return entries.size;
}
