import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createRoutesStub } from "react-router";
import { AboutTheData } from "~/frontend/analytics/dashboard/AboutTheData";
import { dashboardPanelsCsv } from "~/frontend/analytics/dashboard/DashboardDownload";
import { DashboardShell } from "~/frontend/analytics/dashboard/DashboardShell";
import { PanelGrid } from "~/frontend/analytics/dashboard/PanelGrid";
import { cellRow, cellText, coverageText, flaggedText } from "~/frontend/analytics/dashboard/panelCell";
import { waffleShares } from "~/frontend/analytics/dashboard/panels/impact/CoverageWaffle";
import { rankHazards, wrapLabel } from "~/frontend/analytics/dashboard/panels/impact/HazardRanking";
import { impactDashboardPanels } from "~/frontend/analytics/dashboard/panels/impact/impactDashboardPanels";
import { collapsesGaps, type DashboardPanel } from "~/frontend/analytics/dashboard/types";
import type { ViewContext } from "~/frontend/context";
import { IMPACT_PANELS_FIXTURE, type PanelCell } from "~/utils/dashboard/impactPanels";
import { IMPACT_PANELS_5TO16_FIXTURE } from "~/utils/dashboard/impactPanels5to16";
import { SHADE_STEPS, shadeFor } from "~/frontend/analytics/dashboard/panels/blocks";
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
			"Zero, confirmed",
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

	it("say 'Under review' when a record is above the plausibility ceiling", () => {
		const c = cell({ value: 539450606, valueState: "reported", recordsReported: 3, recordsTotal: 9, recordsFlagged: 2, recordsAboveCeiling: 1 });
		expect(flaggedText(ctx, c)).toBe("Under review: a figure above the plausible ceiling (1)");
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

	it("lists unbuilt panels in Features Coming Soon on Disaster impact too (Alex, 2026-10-19)", () => {
		const html = text(renderToString(<PanelGrid ctx={ctx} panels={panels} collapseGaps={collapsesGaps("disaster_impact")} />));
		expect(html).toContain("Features Coming Soon");
		expect(html).not.toContain('data-panel-state="gap"');
	});

	it("keeps a grey placeholder in its slot, and names the chart type in the strip", () => {
		const mixed = [
			{ id: "x-1", n: 1, title: "Ghosted", gap: { text: "Shows a trend.", ghost: "line" as const } },
			{ id: "x-2", n: 2, title: "Listed", gap: { text: "Shows places.", ghost: "map" as const } },
		].map((p, i) => (i === 1 ? { ...p, gap: { ...p.gap, ghost: undefined, chartType: "Map" } } : p));
		const html = text(renderToString(<PanelGrid ctx={ctx} panels={mixed} collapseGaps />));
		expect(html).toContain('data-panel-state="ghost"');
		expect(html).toMatch(/Listed<\/span><span[^>]*>Map<\/span>/);
	});

	it("folds gaps into one strip on the event dimensions, with code and count, never 0", () => {
		expect(collapsesGaps("hazardous_event")).toBe(true);
		expect(collapsesGaps("disaster_event")).toBe(true);
		expect(collapsesGaps("sectors")).toBe(true);
		const html = text(renderToString(<PanelGrid ctx={ctx} panels={panels} collapseGaps />));
		expect(html).toContain("Features Coming Soon");
		expect(html).toContain("Panel 4</span>");
		expect(html).toContain("No events recorded (G-01) · 42 draft records");
		// Panel 2's count is 0: it is left out, not shown as a figure.
		expect(html).toMatch(/Panel 2<\/span><span[^>]*>No events recorded \(G-01\)<\/span>/);
		expect(html).not.toContain('data-panel-state="gap"');
	});
});

describe("Disaster impact panels 1 to 4 on the example payload", () => {
	const panels = impactDashboardPanels(ctx, IMPACT_PANELS_FIXTURE, "EXAMPLE DATA");

	it("number panels 1 to 4 alone without the second payload", () => {
		const drawn = panels.filter((p) => !p.gap);
		expect(drawn.map((p) => p.n).sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
		expect(drawn.every((p) => p.render && p.exportData)).toBe(true);
	});

	it("headline tiles show state words and coverage, and refuse money", () => {
		const html = text(renderToString(<>{panels.find((p) => p.n === 1)!.render!()}</>));
		expect(html).toContain("615");
		expect(html).toContain("243 of 534 records report this");
		expect(html).toContain("2 flagged for review");
		expect(html).toContain("No data"); // missing
		expect(html).toContain("Zero, confirmed"); // injured
		expect(html).toContain("Not shown: monetary convention pending");
		expect(html.replace(/<[^>]+>/g, "")).toContain("Basis: PROVISIONAL");
	});

	it("waffle legend sums to the records in scope", () => {
		const html = text(renderToString(<>{panels.find((p) => p.n === 2)!.render!()}</>));
		expect(html.match(/<rect /g)!.length).toBeGreaterThanOrEqual(100);
		expect(html).toContain("Reported: <span");
		expect(html).toContain("Outlined: 2 reported records flagged for review");
	});

	it("timeline marks a year with no report as a gap, with its caveat", () => {
		const html = text(renderToString(<>{panels.find((p) => p.n === 3)!.render!()}</>));
		expect(html).toContain("2023: No data");
		expect(html).toContain("Highest year in scope");
		expect(html).toContain("More records in later years can reflect more reporting, not more impact.");
	});

	it("hazard ranking gives an unreported hazard its word and no stem", () => {
		const html = text(renderToString(<>{panels.find((p) => p.n === 4)!.render!()}</>));
		expect(html).toMatch(/Geological.*No data/s);
		expect(html.match(/<circle /g)!.length).toBe(2);
		expect(html).toContain('fill="#1f6fb2"'); // Meteorological and Hydrological identity colour
	});
});

describe("dashboard shell", () => {
	const renderShell = (
		dimension: "disaster_impact" | "hazardous_event",
		provisional = false,
		reviewHref?: string,
	) => {
		const Stub = createRoutesStub([
			{
				path: "/",
				Component: () => (
					<DashboardShell
						ctx={ctx}
						view={dimension}
						onViewChange={() => {}}
						reviewHref={reviewHref}
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

	it("has one h1, the scope line, four buttons in Alex's order and Print", () => {
		const html = renderShell("disaster_impact");
		expect(html.match(/<h1/g)!.length).toBe(1);
		// The scope line as chips (FE-Proposal-03), the country first and extra bold.
		expect(html).toMatch(/<li class="[^"]*font-extrabold[^"]*">Angola<\/li>/);
		expect(html).toContain(">2015 to 2024</li>");
		expect(html).toContain(">Basis: published</li>");
		// Each view button starts with its icon (FE-Proposal-03), then its label.
		const tabs = [...html.matchAll(/role="tab"[^>]*>.*?<\/span><\/span>([^<]+)</g)].map((m) => m[1]);
		expect(html.match(/role="tab"/g)).toHaveLength(4);
		for (const icon of ["multi-cluster-sector", "observation-tower", "alert", "affected-population"]) expect(html).toContain(`data-icon="${icon}"`);
		expect(tabs).toEqual(["Sectors", "Hazardous events", "Disaster events", "Disaster impact"]);
		expect(html).toMatch(/aria-selected="true"[^>]*role="tab"[^>]*>.*?<\/span><\/span>Disaster impact/);
		expect(html).toContain("Print or save as PDF");
	});

	it("links the reviewer queue only when the route allows it", () => {
		expect(renderShell("disaster_impact")).not.toContain("Review flagged records");
		const html = renderShell("disaster_impact", false, "/en/analytics/plausibility-review");
		expect(html).toMatch(/href="\/en\/analytics\/plausibility-review"[^>]*>Review flagged records/);
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

describe("page-level CSV", () => {
	it("takes every drawn panel in order, skips gap panels, and keeps value states", () => {
		const panels = impactDashboardPanels(ctx, IMPACT_PANELS_FIXTURE, "EXAMPLE DATA");
		const csv = dashboardPanelsCsv(panels, "EXAMPLE DATA · Angola", "EXAMPLE DATA", "provisional", new Date("2026-10-17T00:00:00Z"));
		const lines = csv.replace(/^\ufeff/, "").trim().split("\r\n");
		const titles = [...new Set(lines.slice(2).map((l) => l.split(",")[0]))];
		// Page order (Alex, 2026-10-18): the CSV follows the screen.
		expect(titles).toEqual(["Human effects at a glance", "Hazard ranking by disaster impact", "Human effects by year", "Coverage of the records"]);
		expect(csv).toContain("Human effects at a glance,Missing,,,not_reported,");
		expect(csv).toContain("Human effects by year,2023,,,not_reported,");
		expect(csv).toContain("PROVISIONAL: includes unpublished records; not for publication");
		expect(csv).not.toContain("Sendai Targets");
	});

	it("carries panels 5 to 16 when their payload is there, Sendai inputs without a code", () => {
		const all = impactDashboardPanels(ctx, IMPACT_PANELS_FIXTURE, "EXAMPLE DATA", { data: IMPACT_PANELS_5TO16_FIXTURE, country: "Angola" });
		const csv = dashboardPanelsCsv(all, "EXAMPLE DATA", "EXAMPLE DATA", "published", new Date("2026-10-17T00:00:00Z"));
		expect(csv).toContain("Sendai Targets A and B counts,A-2 Deaths,,615,reported,");
		expect(csv).toContain("Houses damaged (input to B-3; no indicator value)");
		expect(csv).not.toMatch(/,B-3 [A-Z]/);
		expect(csv).toContain('"People displaced, evacuated and relocated",Biological,Displaced,,not_reported,');
	});
});

describe("Disaster impact layout (Alex, 2026-10-18)", () => {
	const all = impactDashboardPanels(ctx, IMPACT_PANELS_FIXTURE, "EXAMPLE DATA", {
		data: IMPACT_PANELS_5TO16_FIXTURE,
		country: "Angola",
	});

	it("shows the panels in the agreed order (Alex, 2026-10-22: coverage and completeness last)", () => {
		// The fixture has no estimate payload, so row 2 right (Estimated sex and age split) is absent here.
		const shown = all.filter((p) => !p.more && p.id !== "impact-5");
		expect(shown.map((p) => p.title)).toEqual([
			"Human effects at a glance", "Ranked by divisions",
			"Hazard ranking by disaster impact", "Human effects by year",
			"Hazard by human effect", "Hazard by sector",
			"Houses destroyed and damaged", "People displaced, evacuated and relocated",
			"Disaster impact by sex and age disaggregation", "Hazard by month",
			"Coverage of the records", "Reporting completeness and precision",
		]);
	});

	it("puts the estimated split in row 2, right, when it has data", async () => {
		const { IMPACT_LAYOUT } = await import("~/frontend/analytics/dashboard/panels/impact/impactDashboardPanels");
		expect(IMPACT_LAYOUT.slice(0, 4)).toEqual(["impact-1", "impact-7", "impact-4", "impact-estimated"]);
		expect(IMPACT_LAYOUT.slice(-2)).toEqual(["impact-2", "impact-12"]);
	});

	it("puts the unlisted panels under Show more, in number order", () => {
		expect(all.filter((p) => p.more && !p.gap).map((p) => p.id)).toEqual(["impact-5", "impact-11", "impact-13", "impact-14", "impact-15"]);
	});

	it("draws the grid in that order, with only those eleven before Show more", () => {
		const html = renderToString(<PanelGrid ctx={ctx} panels={all.filter((p) => p.id !== "impact-5")} collapseGaps />);
		const ids = [...html.matchAll(/id="(impact-\d+)"/g)].map((m) => m[1]);
		expect(ids.slice(0, 4)).toEqual(["impact-1", "impact-7", "impact-4", "impact-3"]);
		expect(html).toContain("Show 4 more panels");
	});
});

describe("Disaster impact panels 5 to 16 on the example payload", () => {
	const all = impactDashboardPanels(ctx, IMPACT_PANELS_FIXTURE, "EXAMPLE DATA", {
		data: IMPACT_PANELS_5TO16_FIXTURE,
		country: "Angola",
	});
	const html = (n: number) => text(renderToString(<>{all.find((p) => p.n === n)!.render!()}</>));

	it("number 16 drawn panels with export data", () => {
		const drawn = all.filter((p) => !p.gap);
		expect(drawn.map((p) => p.n).sort((a, b) => a - b)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
		expect(drawn.every((p) => p.render && p.exportData)).toBe(true);
		// The rest are Features Coming Soon (reassessment 4.4): DI-18 to DI-27.
		expect(all.filter((p) => p.gap).map((p) => p.id).sort()).toEqual([...Array.from({ length: 10 }, (_, i) => `impact-${i + 18}`), "impact-hazard-month", "impact-aa"].sort());
	});

	it("5: names the country in the notice, keeps dwelling inputs code-free, lists refusals", () => {
		const h = html(5);
		expect(h).toContain("These figures are not the official Sendai Framework Monitor submission of Angola.");
		expect(h).toContain("Input to B-3");
		expect(h).not.toMatch(/<th[^>]*>B-3<\/th>/);
		expect(h).toContain("A-1 not computed: Needs a population denominator (TR-152)");
		expect(h).not.toContain("Scalable picture (SVG)"); // a table: CSV only
	});

	it("6: a table with no row total and a word for an unreported cell", () => {
		const h = html(6);
		expect(h).toContain("<table");
		expect(h).toContain("No data");
		expect(h).toContain("Zero, confirmed");
		expect(h).not.toMatch(/>Total</);
	});

	it("7: names the grouped rest and says rows do not add up", () => {
		const h = html(7);
		expect(h).toContain("3 other divisions");
		expect(h).toContain("7 records touch several divisions and count in each, so rows do not add up.");
	});

	it("9: three named bars per hazard, never a sum, with the overlap note", () => {
		const h = html(9);
		expect(h).toContain("Displaced includes people evacuated before the event.");
		expect(h).toContain("Displaced: No data");
		expect(h).not.toContain(String(34943 + 26117 + 8826));
	});

	it("12: flags shares under 25% and prints percentages", () => {
		const h = html(12);
		expect(h).toContain("2%");
		expect(h.match(/Under 25% of records report this/g)!.length).toBe(1);
	});

	it("13: a year by month grid that counts records without a month", () => {
		const h = html(13);
		expect(h).toContain("101 records have no month and are left out.");
		expect(h).toContain('title="May 2021: No data"');
	});

	it("14: labels periods as annual averages with their years, and lists a one-sided division", () => {
		const h = html(14);
		expect(h).toContain("2005 to 2014 annual average (10 years)");
		expect(h).toContain("Analytical periods; not a Sendai performance measure.");
		expect(h).toMatch(/Not drawn, one period not reported:.*Cunene/s);
	});

	it("15: prints the GAR 2015 threshold and splits records in words", () => {
		const h = html(15);
		expect(h.replace(/<[^>]+>/g, "")).toContain("Threshold: 30 deaths or 600 houses destroyed per record (GAR 2015).");
		expect(h).toContain("Intensive (records at or above the threshold)");
	});

	it("16: counts records with no breakdown in words, not as a bar", () => {
		const h = html(16);
		expect(h).toContain("Not disaggregated: 231 of 243 records");
		expect(h).toContain("With disability");
	});
});

describe("table shading", () => {
	it("uses only light ramp steps, and none for a missing figure", () => {
		expect(SHADE_STEPS).toHaveLength(3);
		expect(shadeFor(null, 10)).toBeUndefined();
		expect(shadeFor(10, 10)).toBe(SHADE_STEPS[2]);
		expect(shadeFor(1, 10)).toBe(SHADE_STEPS[0]);
	});

	it.each(["neutral", "delta"])("keeps %s brand text at 4.5:1 on every step (WCAG 1.4.3)", async (brand) => {
		const { readFileSync } = await import("node:fs");
		const text = JSON.parse(readFileSync(`design-tokens/brand/${brand}.json`, "utf8")).brand.text.$value;
		const lum = (hex: string) => {
			const [r, g, b] = [1, 3, 5]
				.map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
				.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
			return 0.2126 * r + 0.7152 * g + 0.0722 * b;
		};
		for (const step of SHADE_STEPS) {
			const [hi, lo] = [lum(step), lum(text)].sort((a, b) => b - a);
			expect((hi + 0.05) / (lo + 0.05), step).toBeGreaterThanOrEqual(4.5);
		}
	});
});

describe("Sendai counts under a place filter (TR-060, FR-AN-009)", () => {
	it("drop every indicator code and say the figures are sub-national", () => {
		const sub = impactDashboardPanels(ctx, IMPACT_PANELS_FIXTURE, "EXAMPLE DATA", {
			data: IMPACT_PANELS_5TO16_FIXTURE,
			country: "Angola",
			subnational: true,
		});
		const p5 = sub.find((p) => p.n === 5)!;
		const html = text(renderToString(<>{p5.render!()}</>));
		expect(html).toContain("Sub-national figures. Not a Sendai indicator value (TR-060).");
		expect(html).not.toMatch(/\b[AB]-\d\b/);
		expect(p5.exportData!.rows.map((r) => r.label).join(" ")).not.toMatch(/\b[AB]-\d\b/);
	});
});

describe("DI-18 Reporting sources (Analytics fe24a633)", () => {
	it("draws sources as found, counts records without one, and leaves the coming-soon list", () => {
		const sources = {
			rows: [{ source: "INGC", records: 40 }, { source: "Red Cross", records: 12 }],
			rest: { sources: 5, records: 9 },
			recordsWithoutSource: 7,
			recordsInScope: 68,
			distinctSources: 7,
			meta: { method: "m", notApplied: [] },
		};
		const all = impactDashboardPanels(ctx, IMPACT_PANELS_FIXTURE, "EXAMPLE DATA", { data: IMPACT_PANELS_5TO16_FIXTURE, country: "Angola", sources });
		const p = all.find((x) => x.id === "impact-18")!;
		expect(p.gap).toBeUndefined();
		expect(p.more).toBe(true);
		expect(p.exportData!.rows.map((r) => r.label)).toEqual(["INGC", "Red Cross", "5 other sources"]);
		expect(p.exportData!.notes).toContain("7 of 68 records name no source.");
	});
});
