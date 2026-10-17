import { describe, expect, it } from "vitest";
import {
	DASHBOARD_VIEWS,
	legacyAnalyticsTarget,
	searchForView,
	toggleDivision,
	viewFromSearch,
} from "~/frontend/analytics/dashboard/views";
import { parseDeltaQuery } from "~/utils/deltaQuery";

const q = (s: string) => parseDeltaQuery(new URLSearchParams(s)).query;

describe("dashboard views (Alex, 2026-10-17)", () => {
	it("are four, in Alex's order", () => {
		expect(DASHBOARD_VIEWS).toEqual(["sectors", "hazardous_event", "disaster_event", "disaster_impact"]);
	});

	it("read the dimension from delta.query/1 and Sectors from view=sectors", () => {
		expect(viewFromSearch(new URLSearchParams(""), q(""))).toBe("disaster_impact");
		expect(viewFromSearch(new URLSearchParams("dim=disaster_event"), q("dim=disaster_event"))).toBe("disaster_event");
		expect(viewFromSearch(new URLSearchParams("view=sectors"), q("view=sectors"))).toBe("sectors");
	});

	it("write a link that keeps every filter, and never puts sectors in dim", () => {
		const query = q("hipType=1042&from=2015&to=2024&basis=provisional");
		const toEvents = searchForView(query, "disaster_event");
		expect(toEvents.get("dim")).toBe("disaster_event");
		expect(toEvents.get("hipType")).toBe("1042");
		expect(toEvents.get("from")).toBe("2015");
		expect(toEvents.get("basis")).toBe("provisional");
		const toSectors = searchForView(query, "sectors");
		expect(toSectors.get("view")).toBe("sectors");
		expect(toSectors.get("dim")).toBeNull(); // Disaster impact is the default dimension
		expect(toSectors.get("hipType")).toBe("1042");
		// Sectors and back: the view param is gone, the filters stay.
		const back = searchForView(q(toSectors.toString()), "disaster_impact");
		expect(back.get("view")).toBeNull();
		expect(back.get("hipType")).toBe("1042");
	});

	it("round-trip through the parser without a refusal", () => {
		for (const v of DASHBOARD_VIEWS) {
			const params = searchForView(q("from=2020"), v);
			const { query, issues } = parseDeltaQuery(params);
			expect(issues, v).toEqual([]);
			expect(viewFromSearch(params, query)).toBe(v);
		}
	});
});

describe("old analysis pages", () => {
	it("map onto the dashboard with their filters", () => {
		expect(legacyAnalyticsTarget("sectors", new URLSearchParams(""))).toBe("/analytics?view=sectors");
		expect(legacyAnalyticsTarget("hazards", new URLSearchParams("hipType=1042"))).toBe("/analytics?hipType=1042");
		expect(legacyAnalyticsTarget("disaster-events", new URLSearchParams("from=2015"))).toBe(
			"/analytics?dim=disaster_event&from=2015",
		);
		expect(legacyAnalyticsTarget("plausibility-review", new URLSearchParams(""))).toBeNull();
	});
});

describe("map clicks set the place filter", () => {
	it("select a division, replace a region, and clear on a second click", () => {
		const before = q("region=00000000-0000-0000-0000-000000000001&from=2015");
		expect(before.where.region).toEqual({ regionId: "00000000-0000-0000-0000-000000000001" });
		const picked = toggleDivision(before, "d1");
		expect(picked.where.geo).toEqual({ divisionId: "d1" });
		expect(picked.where.region).toBeUndefined();
		expect(picked.where.time).toEqual({ from: "2015" });
		expect(toggleDivision(picked, "d1").where.geo).toBeUndefined();
		expect(toggleDivision(picked, "d2").where.geo).toEqual({ divisionId: "d2" });
	});
});
