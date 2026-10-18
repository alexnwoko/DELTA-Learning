import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HazardRail, withHazardType } from "~/frontend/analytics/dashboard/HazardRail";
import type { ViewContext } from "~/frontend/context";
import type { HazardTree } from "~/frontend/geoportal/GeoFilterBar";
import { parseDeltaQuery } from "~/utils/deltaQuery";
import { createMockTranslator } from "~/utils/translator";

const ctx = { t: createMockTranslator(), lang: "en", url: (p: string) => `/en/${p}` } as unknown as ViewContext;
const text = (html: string) => html.replace(/<!-- -->/g, "");
const TREE: HazardTree = {
	types: [
		{ id: "1042", name: "Meteorological and Hydrological", recordCountSubtree: 1240 },
		{ id: "1041", name: "Geological", recordCountSubtree: 0 },
		{ id: "1037", name: "Biological", recordCountSubtree: 12 },
	],
	clusters: [],
	hazards: [],
};
const render = (selected: string | null, showCounts = true) =>
	text(renderToString(<HazardRail ctx={ctx} tree={TREE} selected={selected} onChange={() => {}} showCounts={showCounts} />));

describe("left hazard rail (mockup option A)", () => {
	it("is a radio group: All hazards, then one button per HIPs type with its short name", () => {
		const html = render(null);
		expect(html).toContain('role="radiogroup"');
		expect(html.match(/type="radio"/g)).toHaveLength(4);
		expect(html).toContain("All hazards");
		expect(html).toContain("Hydro-Met");
		expect(html).toContain("Biological");
	});

	it("draws OCHA's hazard icon in the hazard's identity colour", () => {
		const html = render(null);
		expect(html).toMatch(/data-icon="flood"[^>]*background-color:var\(--delta-data-hazard-meteorological-hydrological\)/);
		expect(html).toMatch(/data-icon="earthquake"[^>]*background-color:var\(--delta-data-hazard-geological\)/);
		expect(html).toMatch(/data-icon="epidemic"[^>]*background-color:var\(--delta-data-hazard-biological\)/);
	});

	it("shows record counts on record views, in the accessible name too, and disables a type with none, never a 0", () => {
		const html = render(null);
		expect(html).toContain("1,240");
		expect(html).toContain('aria-label="Meteorological and Hydrological, 1,240 records"');
		expect(html).toMatch(/aria-label="Geological"[^>]*disabled|disabled[^>]*aria-label="Geological"/);
		expect(html).not.toMatch(/>0</);
	});

	it("shows no counts on event views (the tree counts records, not events)", () => {
		const html = render(null, false);
		expect(html).not.toContain("1,240");
		expect(html).toContain('aria-label="Meteorological and Hydrological"');
	});

	it("marks the selected type", () => {
		const html = render("1037");
		const sel = html.slice(html.indexOf('data-selected="true"'));
		expect(html.match(/data-selected="true"/g)).toHaveLength(1);
		expect(sel.indexOf("Biological")).toBeGreaterThan(-1);
		expect(sel.indexOf("Biological")).toBeLessThan(sel.indexOf("</label>"));
	});

	it("sets the hazard type and clears finer levels; All hazards clears it", () => {
		const q = parseDeltaQuery(new URLSearchParams("hipType=1042&hipCluster=7&from=2015")).query;
		expect(withHazardType(q, "1037").where.hazard).toEqual({ typeId: "1037" });
		expect(withHazardType(q, null).where.hazard).toBeUndefined();
		expect(withHazardType(q, null).where.time).toEqual({ from: "2015" });
	});
});
