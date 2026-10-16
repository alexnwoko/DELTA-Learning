import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BASEMAP_ATTRIBUTION } from "~/utils/basemap";
import { dataEntryBasemap, inlineBasemapScript } from "~/utils/leafletBasemap";

const ORIGIN = "https://delta.example.org";

describe("dataEntryBasemap (SEC-20, TR-166)", () => {
	it("draws nothing when no basemap is configured", () => {
		expect(dataEntryBasemap(undefined, ORIGIN)).toBeNull();
		expect(dataEntryBasemap(null, ORIGIN)).toBeNull();
	});

	it("refuses outside tile hosts", () => {
		for (const url of [
			"https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
			"https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
			"//tiles.example.com/{z}/{x}/{y}.png",
		]) {
			expect(dataEntryBasemap(url, ORIGIN), url).toBeNull();
		}
	});

	it("accepts a self-hosted URL and always attributes it", () => {
		expect(dataEntryBasemap("/tiles/basemap/{z}/{x}/{y}.png", ORIGIN)).toEqual({
			url: "/tiles/basemap/{z}/{x}/{y}.png",
			attribution: BASEMAP_ATTRIBUTION,
			maxZoom: 19,
		});
		expect(dataEntryBasemap(`${ORIGIN}/tiles/{z}/{x}/{y}.png`, ORIGIN)?.attribution).toBe(BASEMAP_ATTRIBUTION);
	});
});

describe("inlineBasemapScript", () => {
	it("keeps the {z}/{x}/{y} placeholders of a root-relative template", () => {
		(globalThis as any).window = { location: { origin: ORIGIN } };
		try {
			const script = inlineBasemapScript("map", dataEntryBasemap("/tiles/basemap/{z}/{x}/{y}.png", ORIGIN));
			expect(script).toContain('L.tileLayer("https://delta.example.org/tiles/basemap/{z}/{x}/{y}.png"');
			expect(script).not.toContain("%7B");
		} finally {
			delete (globalThis as any).window;
		}
	});

	it("writes nothing without a basemap", () => {
		expect(inlineBasemapScript("map", null)).toBe("");
	});

	it("writes an attributed tile layer, with < escaped", () => {
		const script = inlineBasemapScript("map", {
			url: "https://delta.example.org/tiles/{z}/{x}/{y}.png",
			attribution: BASEMAP_ATTRIBUTION,
			maxZoom: 19,
		});
		expect(script.startsWith('L.tileLayer("https://delta.example.org/tiles/{z}/{x}/{y}.png", {"attribution":')).toBe(true);
		expect(script).toContain(".addTo(map);");
		expect(script).not.toContain("<a");
		expect(script).toContain("\\u003ca href=");
	});
});

describe("no Leaflet map calls an outside tile service", () => {
	const OUTSIDE = /tile\.openstreetmap\.org|cartocdn\.com|tiles\.mapbox|tile\.thunderforest|arcgisonline/;
	it.each([
		"app/components/MapChart.tsx",
		"app/components/SpatialFootprintMapViewer.tsx",
		"app/components/SpatialFootprintsMapViewer.tsx",
		"app/components/ContentRepeater/index.tsx",
		"app/components/ContentRepeater/controls/mapper/index.tsx",
		"app/frontend/disaster-event/DisasterEventReviewStep.tsx",
	])("%s", (file) => {
		expect(readFileSync(join(process.cwd(), file), "utf8")).not.toMatch(OUTSIDE);
	});
});
