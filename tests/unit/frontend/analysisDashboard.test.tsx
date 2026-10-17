import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createRoutesStub } from "react-router";
import { AboutTheData } from "~/frontend/analytics/dashboard/AboutTheData";
import { DashboardShell } from "~/frontend/analytics/dashboard/DashboardShell";
import { PanelGrid } from "~/frontend/analytics/dashboard/PanelGrid";
import { cellRow, cellText, coverageText, flaggedText } from "~/frontend/analytics/dashboard/panelCell";
import { waffleShares } from "~/frontend/analytics/dashboard/panels/impact/CoverageWaffle";
import { rankHazards, wrapLabel } from "~/frontend/analytics/dashboard/panels/impact/HazardRanking";
import { impactDashboardPanels } from "~/frontend/analytics/dashboard/panels/impact/impactDashboardPanels";
import { collapsesGaps, type DashboardPanel } from "~/frontend/analytics/dashboard/types";
import type { ViewContext } from "~/frontend/context";
import { IMPACT_PANELS_FIXTURE, type PanelCell } from "~/utils/dashboard/impactPanels";
import { createMockTranslator } from "~/utils/translator";

const ctx = { t: createMockTranslator(), lang: "en", url: (p: string) => `/en/${p}` } as unknown as ViewContext;
// renderToString marks text boundaries with <!-- -->; strip them to read text.
const text = (html: string) => html.replace(/<!-- -->/g, "");

const cell = (over: Partial<PanelCell>): PanelCell => ({
	value: null,
	valueState: "not_reported",
	recordsReported: 0,
	recordsZeroConfirmed: 0,
	recordsNotReported: 10,
	recordsTotal: 10,
	recordsFlagged: 0,
	...over,
});

describe("panel figures (TR-076)", () => {
	it("show a number, a confirmed zero, or a state word, never a bare 0", () => {
		expect(cellText(ctx, cell({ value: 1234, valueState: "reported", recordsReported: 4 }))).toBe("1,234");
		expect(cellText(ctx, cell({ value: 0, valueState: "zero_confirmed", recordsZeroConfirmed: 3 }))).toBe(
			"0 (confirmed)",
		);
		expect(cellText(ctx, cell({}))).toBe("No data");
		expect(cellText(ctx, cell({ valueState: "suppressed" }))).toBe("Suppressed");
		// A reported state with no value is not drawn as 0.
		expect(cellText(ctx, cell({ valueState: "reported", value: null }))).toBe("No data");
	});

	it("carry coverage and flagged counts in words", () => {
		const c = cell({ value: 615, valueState: "reported", recordsReported: 243, recordsTotal: 534, recordsFlagged: 2 });
		expect(coverageText(ctx, c)).toBe("243 of 534 records report this");
		expect(flaggedText(ctx, c)).toBe("2 flagged for review");
		expect(flaggedText(ctx, cell({}))).toBeNull();
	});

	it("export a missing figure as blank, not zero", () => {
		expect(cellRow("Floods", cell({})).value).toBeNull();
		expect(cellRow("Floods", cell({ valueState: "zero_confirmed", value: 0 })).value).toBe(0);
	});
});

describe("coverage waffle shares", () => {
	it("always add up to 100 squares and keep every non-empty part", () => {
		for (const counts of [
			[235, 8, 291],
			[1, 0, 999],
			[333, 333, 334],
			[1, 1, 1],
			[0, 0, 7],
		]) {
			const shares = waffleShares(counts);
			expect(shares.reduce((a, b) => a + b, 0), counts.join()).toBe(100);
			counts.forEach((c, i) => expect(shares[i] > 0, `${counts} part ${i}`).toBe(c > 0));
		}
		expect(waffleShares([0, 0, 0])).toEqual([0, 0, 0]);
	});
});

describe("hazard ranking order", () => {
	it("puts reported figures first, largest first, and every other state after", () => {
		const rows = [
			{ hipTypeId: "1041", label: "Geological", cell: cell({}) },
			{ hipTypeId: "1037", label: "Biological", cell: cell({ value: 55, valueState: "reported", recordsReported: 2 }) },
			{ hipTypeId: "1042", label: "Met", cell: cell({ value: 560, valueState: "reported", recordsReported: 5 }) },
			{ hipTypeId: "1038", label: "Chemical", cell: cell({ value: 0, valueState: "zero_confirmed" }) },
		];
		expect(rankHazards(rows).map((r) => r.hipTypeId)).toEqual(["1042", "1037", "1038", "1041"]);
	});
});

describe("hazard names", () => {
	it("wrap over two lines at a word break, never cut mid-word", () => {
		expect(wrapLabel("Biological")).toEqual(["Biological"]);
		expect(wrapLabel("Meteorological and Hydrological")).toEqual(["Meteorological and", "Hydrological"]);
	});
});

describe("panel grid (decision 1)", () => {
	const panels: DashboardPanel[] = Array.from({ length: 16 }, (_, i) => ({
		id: `p-${i + 1}`,
		n: i + 1,
		title: `Panel ${i + 1}`,
		...(i % 2 === 0
			? { render: () => <p>chart {i + 1}</p> }
			: { gap: { code: "G-01", text: "No events recorded", count: i === 1 ? 0 : 42, countLabel: "draft records" } }),
	}));

	it("puts panels 13 to 16 under Show more, opened for print", () => {
		const html = text(renderToString(<PanelGrid ctx={ctx} panels={panels} collapseGaps={false} />));
		expect(html).toContain("Show 4 more panels");
		expect(html).toContain('data-print="expand"');
		expect(html).toContain("chart 1");
	});

	it("keeps each gap in its own frame on Disaster impact", () => {
		const html = text(renderToString(<PanelGrid ctx={ctx} panels={panels} collapseGaps={collapsesGaps("disaster_impact")} />));
		// Six gaps among panels 1 to 12, two more in the closed "Show more" part.
		expect(html.match(/data-panel-state="gap"/g)?.length).toBe(8);
		expect(html).not.toContain("Not yet available");
	});

	it("folds gaps into one strip on the event dimensions, with code and count, never 0", () => {
		expect(collapsesGaps("hazardous_event")).toBe(true);
		expect(collapsesGaps("disaster_event")).toBe(true);
		const html = text(renderToString(<PanelGrid ctx={ctx} panels={panels} collapseGaps />));
		expect(html).toContain("Not yet available");
		expect(html).toContain("Panel 4</span>");
		expect(html).toContain("No events recorded (G-01) · 42 draft records");
		// Panel 2's count is 0: it is left out, not shown as a figure.
		expect(html).toMatch(/Panel 2<\/span><span[^>]*>: No events recorded \(G-01\)<\/span>/);
		expect(html).not.toContain('data-panel-state="gap"');
	});
});

describe("Disaster impact panels 1 to 4 on the example payload", () => {
	const panels = impactDashboardPanels(ctx, IMPACT_PANELS_FIXTURE, "EXAMPLE DATA");

	it("number 16 panels, 1 to 4 drawn and 5 to 16 saying they are being built", () => {
		expect(panels.map((p) => p.n)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
		expect(panels.filter((p) => p.render).map((p) => p.n)).toEqual([1, 2, 3, 4]);
		expect(panels.filter((p) => p.gap).every((p) => p.gap!.code === "D1 step 2")).toBe(true);
	});

	it("headline tiles show state words and coverage, and refuse money", () => {
		const html = text(renderToString(<>{panels[0].render!()}</>));
		expect(html).toContain("615");
		expect(html).toContain("243 of 534 records report this");
		expect(html).toContain("2 flagged for review");
		expect(html).toContain("No data"); // missing
		expect(html).toContain("0 (confirmed)"); // injured
		expect(html).toContain("Not shown: monetary convention pending");
		expect(html).toContain("Basis: PROVISIONAL");
	});

	it("waffle legend sums to the records in scope", () => {
		const html = text(renderToString(<>{panels[1].render!()}</>));
		expect(html.match(/<rect /g)!.length).toBeGreaterThanOrEqual(100);
		expect(html).toContain("Reported: <span");
		expect(html).toContain("Outlined: 2 reported records flagged for review");
	});

	it("timeline marks a year with no report as a gap, with its caveat", () => {
		const html = text(renderToString(<>{panels[2].render!()}</>));
		expect(html).toContain("2023: No data");
		expect(html).toContain("Highest year in scope");
		expect(html).toContain("More records in later years can reflect more reporting, not more impact.");
	});

	it("hazard ranking gives an unreported hazard its word and no stem", () => {
		const html = text(renderToString(<>{panels[3].render!()}</>));
		expect(html).toMatch(/Geological.*No data/s);
		expect(html.match(/<circle /g)!.length).toBe(2);
		expect(html).toContain('fill="#1f6fb2"'); // Meteorological and Hydrological identity colour
	});
});

describe("dashboard shell", () => {
	const renderShell = (dimension: "disaster_impact" | "hazardous_event", provisional = false) => {
		const Stub = createRoutesStub([
			{
				path: "/",
				Component: () => (
					<DashboardShell
						ctx={ctx}
						dimension={dimension}
						onDimensionChange={() => {}}
						summary="Angola · 2015 to 2024 · Basis: published"
						provisional={provisional}
						panels={[{ id: "x", n: 1, title: "X", gap: { code: "G-01", text: "No events" } }]}
						about={<AboutTheData ctx={ctx} country="Angola" dimension={dimension} provisional={provisional} />}
					/>
				),
			},
		]);
		return text(renderToString(<Stub />));
	};

	it("has one h1, the scope line, three dimension tabs and Print", () => {
		const html = renderShell("disaster_impact");
		expect(html.match(/<h1/g)!.length).toBe(1);
		expect(html).toContain("Angola · 2015 to 2024 · Basis: published");
		expect(html.match(/role="tab"/g)!.length).toBe(3);
		expect(html).toMatch(/aria-selected="true"[^>]*role="tab"[^>]*>Disaster impact/);
		expect(html).toContain("Print or save as PDF");
	});

	it("shows the provisional banner on the reviewer basis only", () => {
		expect(renderShell("disaster_impact")).not.toContain("Not for publication");
		expect(renderShell("disaster_impact", true)).toContain("Not for publication");
	});

	it("names no warnings on Hazardous events, and partners as text", () => {
		const html = renderShell("hazardous_event");
		expect(html).toContain("DELTA Resilience issues no warnings.");
		expect(html).toContain("not the official Sendai Framework Monitor submission of Angola");
		expect(html).toContain("World Meteorological Organization (WMO)");
		expect(html).not.toMatch(/<img/);
		expect(html).toContain("Contact details not yet set");
	});
});
