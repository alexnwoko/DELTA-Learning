import { describe, it, expect } from "vitest";
import { declutterLabels, worldNamesAt, type WorldBoundaries } from "~/components/MapChart";

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

describe("label decluttering", () => {
	// One degree = 10 px, so positions are easy to read.
	const project = (at: [number, number]) => ({ x: at[0] * 10, y: -at[1] * 10 });

	it("keeps the tenant and its areas over other countries' names", () => {
		const shown = declutterLabels(
			[
				{ name: "Malawi", at: [35, -13], priority: 2 },
				{ name: "Niassa", at: [35.2, -13], priority: 1 },
				{ name: "Mozambique", at: [35.5, -18], strong: true, priority: 0 },
			],
			project,
		).map((l) => l.name);
		expect(shown).toEqual(["Mozambique", "Niassa"]);
	});

	it("keeps names that do not touch", () => {
		const shown = declutterLabels(
			[
				{ name: "Angola", at: [17, -12], priority: 2 },
				{ name: "Kenya", at: [38, 0], priority: 2 },
			],
			project,
		);
		expect(shown).toHaveLength(2);
	});
});
