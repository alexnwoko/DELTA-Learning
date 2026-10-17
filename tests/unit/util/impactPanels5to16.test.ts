import { describe, it, expect } from "vitest";
import { IMPACT_PANELS_5TO16_FIXTURE as F } from "~/utils/dashboard/impactPanels5to16";
import type { PanelCell } from "~/utils/dashboard/impactPanels";

// Panels 5 to 16 fixture: value states stay honest and the O-2 figures stay apart.

const isCell = (v: unknown): v is PanelCell =>
	typeof v === "object" && v !== null && "valueState" in v && "value" in v;

function cells(v: unknown, out: PanelCell[] = []): PanelCell[] {
	if (isCell(v)) out.push(v);
	else if (Array.isArray(v)) v.forEach((x) => cells(x, out));
	else if (typeof v === "object" && v !== null)
		Object.values(v).forEach((x) => cells(x, out));
	return out;
}

describe("Disaster impact panels 5 to 16: payload fixture", () => {
	it("never pairs a null value with reported", () => {
		const all = cells(F);
		expect(all.length).toBeGreaterThan(30);
		for (const c of all) {
			if (c.value === null) expect(c.valueState).not.toBe("reported");
			if (c.valueState === "reported") expect(c.value).not.toBeNull();
		}
	});

	it("gives every panel a not-reported cell, except where no cell can be missing", () => {
		const { meta, completeness, extensiveIntensive, largestRecords, ...rest } =
			F;
		for (const [name, panel] of Object.entries(rest)) {
			expect(
				cells(panel).some((c) => c.valueState === "not_reported"),
				name,
			).toBe(true);
		}
	});

	it("keeps the matrix widths", () => {
		for (const r of F.hazardEffect.rows)
			expect(r.cells).toHaveLength(F.hazardEffect.effects.length);
		for (const r of F.hazardSector.rows)
			expect(r.cells).toHaveLength(F.hazardSector.sectors.length);
	});

	it("labels every panel's meta as example data", () => {
		for (const m of Object.values(F.meta))
			expect(m.coverage).toBe("EXAMPLE DATA");
	});
});
