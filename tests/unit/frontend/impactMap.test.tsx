import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ImpactMap, toMapArea } from "~/frontend/analytics/dashboard/panels/impact/ImpactMap";
import type { ViewContext } from "~/frontend/context";
import type { PanelCell } from "~/utils/dashboard/impactPanels";
import type { ImpactMapPayload } from "~/utils/dashboard/impactMap";
import { createMockTranslator } from "~/utils/translator";

const ctx = { t: createMockTranslator(), lang: "en", url: (p: string) => `/en/${p}` } as unknown as ViewContext;
const text = (html: string) => html.replace(/<!-- -->/g, "");
const cell = (value: number | null, valueState: PanelCell["valueState"], flagged = 0): PanelCell => ({
	value,
	valueState,
	recordsReported: valueState === "reported" ? 3 : 0,
	recordsZeroConfirmed: valueState === "zero_confirmed" ? 2 : 0,
	recordsNotReported: 5,
	recordsTotal: 10,
	recordsFlagged: flagged,
});
const square = { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] };
const MAP: ImpactMapPayload = {
	areas: [
		{ divisionId: "a", name: "Luanda", geojson: square, labelPoint: [0.5, 0.5], deaths: cell(120, "reported", 1), dwellingsDestroyed: cell(40, "reported"), dwellingsDamaged: cell(null, "not_reported") },
		{ divisionId: "b", name: "Cunene", geojson: null, labelPoint: null, deaths: cell(0, "zero_confirmed"), dwellingsDestroyed: cell(null, "not_reported"), dwellingsDamaged: cell(9, "reported") },
	],
	recordsWithoutDivision: 4,
	multiDivisionRecords: 7,
	legend: {
		shading: "Number of deaths",
		bars: ["Dwellings destroyed", "Dwellings damaged"],
		note: "Sub-national figures. Not a Sendai indicator value.",
	},
	meta: { method: "Sum per division", notApplied: [] },
};
const labels = { destroyed: "Dwellings destroyed", damaged: "Dwellings damaged" };

describe("map M0 areas", () => {
	it("shade by deaths and carry the two dwelling counts as separate parts, never added", () => {
		const a = toMapArea(MAP.areas[0], labels);
		expect(a.total).toBe(120);
		expect(a.valueState).toBe("reported");
		expect(a.recordsFlagged).toBe(1);
		expect(a.parts).toEqual([
			{ key: "destroyed", label: "Dwellings destroyed", value: 40, valueState: "reported", recordsFlagged: 0 },
			{ key: "damaged", label: "Dwellings damaged", value: null, valueState: "not_reported", recordsFlagged: 0 },
		]);
	});

	it("keep a confirmed zero as 0 with its state, never a missing figure", () => {
		const b = toMapArea(MAP.areas[1], labels);
		expect(b.total).toBe(0);
		expect(b.valueState).toBe("zero_confirmed");
		expect(b.parts![0].value).toBeNull();
	});
});

describe("map M0 words", () => {
	const html = text(renderToString(<ImpactMap ctx={ctx} map={MAP} scope={{ tenant: "Angola", audience: "public" }} />));

	it("says the figures are sub-national, with no Sendai indicator code", () => {
		expect(html).toContain("Sub-national figures. Not a Sendai indicator value.");
		expect(html).not.toMatch(/\b(A-2|B-3|B-4)\b/);
	});

	it("names what the map cannot show", () => {
		expect(html).toContain("4 records in scope have no division and are not on the map.");
		expect(html).toContain("7 records touch several divisions and count in each, so areas do not add up.");
		expect(html).toContain("Not on the map (no boundary held):");
		expect(html).toContain("Cunene (Number of deaths: Zero, confirmed; Dwellings destroyed: No data; Dwellings damaged: 9)");
		expect(html).toContain("Boundaries simplified to about 500 m for display.");
	});

	it("offers every area, mapped or not, as a table that prints open", () => {
		expect(html).toContain("Map data as a table");
		expect(html).toContain('data-print="expand"');
		expect(html.match(/<th scope="row"/g)!.length).toBe(2);
	});
});
