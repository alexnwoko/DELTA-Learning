import { describe, it, expect } from "vitest";
import {
	IMPACT_HEADLINE_MEASURES,
	IMPACT_PANELS_FIXTURE,
	type PanelCell,
} from "~/utils/dashboard/impactPanels";

// The fixture Frontend builds against must show every value state honestly:
// a null value is never 0 and is never "reported".

const allCells = (): PanelCell[] => {
	const f = IMPACT_PANELS_FIXTURE;
	return [
		...f.tiles.flatMap((t) => [t.cell, ...t.sparkline.map((s) => s.cell)]),
		...f.timeline.years.map((y) => y.cell),
		...f.hazardRanking.map((r) => r.cell),
	];
};

describe("Disaster impact panels 1 to 4: payload fixture", () => {
	it("has one tile per headline measure, in order", () => {
		expect(IMPACT_PANELS_FIXTURE.tiles.map((t) => t.measure)).toEqual([
			...IMPACT_HEADLINE_MEASURES,
		]);
	});

	it("never pairs a null value with reported, or a reported state with no value", () => {
		for (const c of allCells()) {
			if (c.value === null) expect(c.valueState).not.toBe("reported");
			if (c.valueState === "reported") expect(c.value).not.toBeNull();
			if (c.valueState === "not_reported") expect(c.value).toBeNull();
		}
	});

	it("covers reported, confirmed zero and not reported, and labels itself as example data", () => {
		const states = new Set(allCells().map((c) => c.valueState));
		for (const s of ["reported", "zero_confirmed", "not_reported"]) {
			expect(states.has(s as PanelCell["valueState"])).toBe(true);
		}
		expect(IMPACT_PANELS_FIXTURE.scopeText).toContain("EXAMPLE DATA");
	});

	it("keeps the coverage waffle consistent with its total", () => {
		const c = IMPACT_PANELS_FIXTURE.coverage;
		expect(
			c.recordsReported + c.recordsZeroConfirmed + c.recordsNotReported,
		).toBe(c.recordsTotal);
	});
});
