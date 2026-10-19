// Print view of the Analysis page: sections flow one after another.
// Chrome does not pass the height that page breaks add inside a nested flex
// item up to the flex container around it, so in print "About the data" was
// drawn over the Sendai section (Alex, 2026-10-19). The layout columns carry
// data-print="flow" and print.css prints them as plain blocks.
import { readFileSync } from "node:fs";
import { renderToString } from "react-dom/server";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vitest";
import { DashboardShell } from "~/frontend/analytics/dashboard/DashboardShell";
import { SendaiSectionView } from "~/frontend/analytics/dashboard/panels/sendai/sendaiSection";
import type { ViewContext } from "~/frontend/context";
import type { SendaiSection } from "~/utils/dashboard/sendaiPanels";
import { createMockTranslator } from "~/utils/translator";

const ctx = { t: createMockTranslator(), lang: "en", url: (p: string) => `/en/${p}` } as unknown as ViewContext;
const meta = { method: "Sum over records in scope", notApplied: [] };
const gap = { gap: { code: "G-00", reason: "Not yet available" } };
// Only the parts the section's frame reads; the slots are stubs.
const D = {
	nationalOnly: true,
	provisional: false,
	coverage: { recordsWith: 1, recordsTotal: 2 },
	s0: gap, a1: gap, a2: gap, b1: gap, b2: gap, c1: gap, c2: gap, d1: gap, d2: gap,
	meta: { s0: meta, a1: meta, a2: meta, b1: meta, b2: meta, c1: meta, c2: meta, d1: meta, d2: meta },
} as unknown as SendaiSection;
const slots = ["s0", "a1", "a2", "b1", "b2", "c1", "c2", "d1", "d2"].map((id, i) => ({
	id: `sfm-${id}`, n: i, title: id, group: (id === "s0" ? "S" : id[0].toUpperCase()) as "S" | "A" | "B" | "C" | "D",
	render: () => <p>SLOT {id}</p>,
}));

const page = (sfmOn: boolean) => {
	const Stub = createRoutesStub([{ path: "/", Component: () => (
		<DashboardShell ctx={ctx} view="disaster_impact" onViewChange={() => {}} summary="Angola" provisional={false}
			sfmOn={sfmOn} sendai={<SendaiSectionView ctx={ctx} d={D} panels={slots} country="Angola" />}
			panels={[{ id: "x", n: 1, title: "X", render: () => <p>VIEW PANEL</p> }]} about={<section>ABOUT</section>} />
	) }]);
	// React Aria's server render puts a hidden copy of the Tabs children in a template first.
	return renderToString(<Stub />).replace(/<template>[\s\S]*?<\/template>/g, "");
};

/** The opening tags of the elements that hold the given marker, outermost first. */
function ancestors(html: string, marker: string): string[] {
	const at = html.lastIndexOf(marker);
	const stack: string[] = [];
	for (const m of html.slice(0, at).matchAll(/<(\/?)([a-z][a-z0-9]*)\b[^>]*?(\/?)>/g)) {
		if (m[3] === "/" || ["img", "br", "input", "meta", "link", "path", "rect", "circle", "line"].includes(m[2])) continue;
		if (m[1]) stack.pop();
		else stack.push(m[0]);
	}
	return stack;
}

const css = readFileSync("app/styles/print.css", "utf8");

describe("Analysis page print flow (no section drawn over another)", () => {
	for (const sfmOn of [false, true]) {
		it(`every flex column round the Sendai section and About the data prints as a block (Sendai toggle ${sfmOn ? "on" : "off"})`, () => {
			const html = page(sfmOn);
			for (const marker of ["SLOT s0", "SLOT d2", "ABOUT"]) {
				const flexCols = ancestors(html, marker).filter((tag) => /class="[^"]*\bflex\b[^"]*\bflex-col\b/.test(tag) && !/delta-panel-card/.test(tag));
				expect(flexCols.length, marker).toBeGreaterThan(0);
				for (const tag of flexCols) expect(tag, marker).toContain('data-print="flow"');
			}
		});
	}

	it("print.css prints flow containers as blocks and takes nothing out of flow", () => {
		expect(css).toMatch(/\[data-print="flow"\]\s*\{\s*display:\s*block !important;/);
		expect(css).toMatch(/h1,\s*h2,\s*h3\s*\{\s*break-after:\s*avoid;/);
		expect(css).toMatch(/tr,/);
		for (const bad of [/position:\s*(fixed|absolute|sticky)/, /float:/, /transform:/, /margin[a-z-]*:\s*-/, /(^|[^-])height:\s*\d/]) {
			expect(css).not.toMatch(bad);
		}
	});
});
