import { describe, it, expect, beforeEach } from "vitest";
import {
	cachedDashboard,
	clearDashboardCache,
	DASHBOARD_CACHE_TTL_MS,
} from "~/backend.server/models/analytics/dashboard/dashboardCache.server";

const ctxA = { countryAccountsId: "a", audience: "public" };
const ctxB = { countryAccountsId: "b", audience: "public" };

describe("cachedDashboard", () => {
	beforeEach(() => clearDashboardCache());

	it("reuses a view within the TTL and recomputes after it", async () => {
		let t = 0;
		let n = 0;
		const run = () =>
			cachedDashboard(
				"x",
				[ctxA, {}],
				async () => ++n,
				() => t,
			);
		expect(await run()).toBe(1);
		t = DASHBOARD_CACHE_TTL_MS - 1;
		expect(await run()).toBe(1);
		t = DASHBOARD_CACHE_TTL_MS + 1;
		expect(await run()).toBe(2);
	});

	it("never shares an entry across tenants, audiences or queries", async () => {
		let n = 0;
		const f = async () => ++n;
		await cachedDashboard("x", [ctxA, {}], f);
		await cachedDashboard("x", [ctxB, {}], f);
		await cachedDashboard("x", [{ ...ctxA, audience: "signed-in" }, {}], f);
		await cachedDashboard("x", [ctxA, { measure: "deaths" }], f);
		await cachedDashboard("y", [ctxA, {}], f);
		expect(n).toBe(5);
	});

	it("shares one computation between concurrent callers", async () => {
		let n = 0;
		const f = () => new Promise<number>((r) => setTimeout(() => r(++n), 5));
		const [a, b] = await Promise.all([
			cachedDashboard("x", [ctxA, {}], f),
			cachedDashboard("x", [ctxA, {}], f),
		]);
		expect([a, b, n]).toEqual([1, 1, 1]);
	});

	it("does not keep a failed computation", async () => {
		await expect(
			cachedDashboard("x", [ctxA, {}], async () => {
				throw new Error("boom");
			}),
		).rejects.toThrow("boom");
		await new Promise((r) => setTimeout(r, 0));
		expect(await cachedDashboard("x", [ctxA, {}], async () => 7)).toBe(7);
	});

	it("clears one tenant's views only", async () => {
		let n = 0;
		const f = async () => ++n;
		await cachedDashboard("x", [ctxA, {}], f);
		await cachedDashboard("x", [ctxB, {}], f);
		clearDashboardCache("a");
		await cachedDashboard("x", [ctxA, {}], f);
		await cachedDashboard("x", [ctxB, {}], f);
		expect(n).toBe(3);
	});
});
