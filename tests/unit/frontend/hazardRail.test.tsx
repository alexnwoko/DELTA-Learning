import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HazardRail, withHazardType } from "~/frontend/analytics/dashboard/HazardRail";
import { SendaiToggle } from "~/frontend/analytics/dashboard/panels/sendai/sendaiSection";
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

	it("draws each type's icon at 26 px in its identity colour, All hazards in the dashboard blue", () => {
		const html = render(null);
		expect(html).toMatch(/data-icon="multi-hazard"[^>]*width:26px;height:26px;background-color:var\(--panel-icon, var\(--delta-data-icon\)\)/);
		for (const [name, colour] of [["flood", "meteorological-hydrological"], ["earthquake", "geological"], ["epidemic", "biological"]]) {
			expect(html).toMatch(new RegExp(`data-icon="${name}"[^>]*width:26px;height:26px;background-color:var\\(--delta-data-hazard-${colour}\\)`));
		}
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

describe("Sendai square in the rail (Alex, 2026-10-22)", () => {
	const html = (on: boolean) =>
		text(renderToString(<HazardRail ctx={ctx} tree={TREE} selected={null} onChange={() => {}} showCounts after={<SendaiToggle ctx={ctx} on={on} rail onChange={() => {}} />} />));

	it("sits below the hazard types, outside the radio group, as a toggle with the full name", () => {
		const out = html(false);
		expect(out.indexOf("Biological")).toBeLessThan(out.indexOf("Sendai"));
		expect(out.match(/type="radio"/g)).toHaveLength(4);
		expect(out).toContain('aria-label="Sendai Framework Monitoring"');
		expect(out).toContain('aria-pressed="false"');
	});

	it("takes the hazard square's shape and turns orange when on", () => {
		const out = html(true);
		expect(out).toContain('aria-pressed="true"');
		expect(out).toContain("w-[88px]");
		expect(out).toContain("data-[selected]:bg-data-sfm-on");
	});
});
