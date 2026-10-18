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
const boundaries = { outline: { type: "Polygon", coordinates: [] }, countryLabelPoint: [35, -18] as [number, number], countryName: "Mozambique" };
const layers = { basemaps, boundaries };

describe("Analysis map layers", () => {
	it("ImpactMap hands basemaps and boundaries to MapChart", () => {
		seen.length = 0;
		const map = { areas: [], recordsWithoutDivision: 0, multiDivisionRecords: 0, legend: {}, meta: { method: "", notApplied: [] } } as never;
		renderToString(<ImpactMap ctx={ctx} map={map} scope={scope} layers={layers} />);
		expect(seen[0]?.basemaps).toBe(basemaps);
		expect(seen[0]?.boundaries).toBe(boundaries);
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
