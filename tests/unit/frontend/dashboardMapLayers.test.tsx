// The Analysis maps pass the loader's basemaps and country boundary to
// MapChart unchanged (Alex, 2026-10-18: basemap on by default, outline and
// labels in light grey).
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const seen: Record<string, unknown>[] = [];
vi.mock("~/components/MapChart", () => ({
	default: (props: Record<string, unknown>) => {
		seen.push(props);
		return null;
	},
}));

const { ImpactMap } = await import("~/frontend/analytics/dashboard/panels/impact/ImpactMap");
const { EventMap } = await import("~/frontend/analytics/dashboard/panels/events/EventMap");
const { createMockTranslator } = await import("~/utils/translator");

const ctx = { t: createMockTranslator(), lang: "en", url: (p: string) => `/en/${p}` } as never;
const scope = {} as never;
const basemaps = [{ id: "osm", label: "OpenStreetMap", url: "/tiles/basemap/{z}/{x}/{y}.png", thirdParty: false }] as never;
const boundaries = { outline: { type: "Polygon", coordinates: [] }, countryLabelPoint: [35, -18] as [number, number], countryName: "Mozambique",
	neighbours: [{ iso3: "MWI", name: "Malawi", geojson: { type: "Polygon", coordinates: [] }, labelPoint: [34, -13] as [number, number] }],
	world: { url: "/en/api/geo/world", iso3: "MOZ" },
};
const layers = { basemaps, boundaries };

describe("Analysis map layers", () => {
	it("ImpactMap hands basemaps and boundaries to MapChart", () => {
		seen.length = 0;
		const map = { areas: [], recordsWithoutDivision: 0, multiDivisionRecords: 0, legend: {}, meta: { method: "", notApplied: [] } } as never;
		renderToString(<ImpactMap ctx={ctx} map={map} scope={scope} layers={layers} />);
		expect(seen[0]?.basemaps).toBe(basemaps);
		expect(seen[0]?.boundaries).toBe(boundaries);
		expect((seen[0]?.boundaries as typeof boundaries).neighbours[0].name).toBe("Malawi");
		expect((seen[0]?.boundaries as typeof boundaries).world).toEqual({ url: "/en/api/geo/world", iso3: "MOZ" });
	});

	it("EventMap hands basemaps and boundaries to MapChart", () => {
		seen.length = 0;
		const map = { areas: [], unplacedReasons: {}, meta: { method: "", notApplied: [] } } as never;
		renderToString(<EventMap ctx={ctx} map={map} scope={scope} layers={layers} />);
		expect(seen[0]?.basemaps).toBe(basemaps);
		expect(seen[0]?.boundaries).toBe(boundaries);
	});

	it("draws no extra layer when the loader sends none", () => {
		seen.length = 0;
		const map = { areas: [], unplacedReasons: {}, meta: { method: "", notApplied: [] } } as never;
		renderToString(<EventMap ctx={ctx} map={map} scope={scope} />);
		expect(seen[0]?.basemaps).toBeUndefined();
		expect(seen[0]?.boundaries).toBeUndefined();
	});
});

describe("Analysis maps take the dashboard palette (Alex, 2026-10-18)", () => {
	it("passes DASHBOARD_RAMP to MapChart on both maps", async () => {
		const { DASHBOARD_RAMP } = await import("~/frontend/charts/sectionPalette");
		seen.length = 0;
		renderToString(<ImpactMap ctx={ctx} map={{ areas: [], recordsWithoutDivision: 0, multiDivisionRecords: 0, legend: {}, meta: { method: "", notApplied: [] } } as never} scope={scope} />);
		renderToString(<EventMap ctx={ctx} map={{ areas: [], unplacedReasons: {}, meta: { method: "", notApplied: [] } } as never} scope={scope} />);
		expect(seen.map((p) => p.ramp)).toEqual([DASHBOARD_RAMP, DASHBOARD_RAMP]);
	});
});
