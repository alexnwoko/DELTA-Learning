import { describe, it, expect } from "vitest";
import { worldNamesAt, type WorldBoundaries } from "~/components/MapChart";

// Every country's name from its minZoom; never the tenant's own, never one
// without a point (Alex, 2026-10-18; Geoportal /api/geo/world).
const labels: WorldBoundaries["labels"] = [
	{ iso3: "AGO", name: "Angola", labelPoint: [17.5, -12.3], minZoom: 2 },
	{ iso3: "ZMB", name: "Zambia", labelPoint: [27.8, -13.4], minZoom: 3 },
	{ iso3: "NAM", name: "Namibia", labelPoint: [17.2, -22.1], minZoom: 2 },
	{ iso3: "XXX", name: "No point", labelPoint: null, minZoom: 0 },
];

describe("world names", () => {
	it("shows each name from its minZoom", () => {
		expect(worldNamesAt(labels, 2).map((l) => l.name)).toEqual(["Angola", "Namibia"]);
		expect(worldNamesAt(labels, 3).map((l) => l.name)).toEqual(["Angola", "Zambia", "Namibia"]);
	});

	it("leaves out the tenant's own name and names without a point", () => {
		expect(worldNamesAt(labels, 5, "AGO").map((l) => l.name)).toEqual(["Zambia", "Namibia"]);
	});
});
