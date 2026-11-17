import { describe, it, expect, beforeEach } from "vitest";
import {
	cachedGeo,
	clearGeoCache,
	geoCacheSize,
	stableKey,
} from "~/backend.server/models/geo/cache";

describe("geo result cache (I-6, option A)", () => {
	beforeEach(() => clearGeoCache());

	it("keys equal requests equally, whatever their key order", () => {
		expect(stableKey({ b: 1, a: { d: 2, c: [3, { f: 4, e: 5 }] } })).toBe(
			stableKey({ a: { c: [3, { e: 5, f: 4 }], d: 2 }, b: 1 }),
		);
		expect(stableKey({ a: 1, x: undefined })).toBe(stableKey({ a: 1 }));
	});

	it("computes once per tenant, refresh time and request, and shares in-flight work", async () => {
		let n = 0;
		const compute = async () => ++n;
		const [a, b] = await Promise.all([
			cachedGeo("m", "t1", "2026-10-18T00:00:00Z", { q: 1 }, compute),
			cachedGeo("m", "t1", "2026-10-18T00:00:00Z", { q: 1 }, compute),
		]);
		expect([a, b, n]).toEqual([1, 1, 1]);
		// Another tenant, another audience or a new refresh time: new entries.
		expect(
			await cachedGeo("m", "t2", "2026-10-18T00:00:00Z", { q: 1 }, compute),
		).toBe(2);
		expect(
			await cachedGeo(
				"m",
				"t1",
				"2026-10-18T00:00:00Z",
				{ q: 1, audience: "signed-in" },
				compute,
			),
		).toBe(3);
		expect(
			await cachedGeo("m", "t1", "2026-10-19T00:00:00Z", { q: 1 }, compute),
		).toBe(4);
	});

	it("never caches before the first refresh, and drops failures", async () => {
		let n = 0;
		await cachedGeo("m", "t1", null, {}, async () => ++n);
		await cachedGeo("m", "t1", null, {}, async () => ++n);
		expect(n).toBe(2);
		await expect(
			cachedGeo("m", "t1", "r", {}, async () => {
				throw new Error("refused");
			}),
		).rejects.toThrow("refused");
		await Promise.resolve();
		expect(await cachedGeo("m", "t1", "r", {}, async () => "ok")).toBe("ok");
	});

	it("stays bounded, dropping the least recently used entry", async () => {
		for (let i = 0; i < 520; i++) {
			await cachedGeo("m", "t", "r", { i }, async () => i);
		}
		expect(geoCacheSize()).toBe(500);
		let recomputed = false;
		await cachedGeo("m", "t", "r", { i: 0 }, async () => {
			recomputed = true;
			return 0;
		});
		expect(recomputed).toBe(true);
	});
});

import { admin0Key, admin0Name } from "../../../scripts/seed-admin0";

describe("admin-0 seed keys (Natural Earth properties)", () => {
	it("prefers ISO_A3_EH and skips the -99 placeholders", () => {
		expect(admin0Key({ ISO_A3: "-99", ISO_A3_EH: "FRA", ADM0_A3: "FRA" })).toBe(
			"FRA",
		);
		expect(admin0Key({ ISO_A3: "MOZ" })).toBe("MOZ");
		expect(admin0Key({ ISO_A3: "-99", ADM0_A3: "KOS" })).toBe("KOS");
		expect(admin0Key({ ISO_A3: "-99" })).toBeNull();
		expect(admin0Name({ NAME_EN: "Mozambique", NAME: "Mozambique" })).toBe(
			"Mozambique",
		);
	});
});
