// Estimated sex and age split (Alex, 2026-10-19; Analytics 40a0d72b):
// estimates are hatched, tagged and footnoted, and never enter the page
// CSV of reported data.
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { dashboardPanelsCsv } from "~/frontend/analytics/dashboard/DashboardDownload";
import { estimatedSplitCsv, estimatedSplitPanel, pickModel, pyramidShares, PYRAMID_AXIS_MAX } from "~/frontend/analytics/dashboard/panels/impact/EstimatedSplit";
import type { ViewContext } from "~/frontend/context";
import type { EstimatedDisaggregation } from "~/utils/dashboard/estimatedDisaggregation";
import { createMockTranslator } from "~/utils/translator";

const ctx = { t: createMockTranslator(), lang: "en", url: (p: string) => `/en/${p}` } as unknown as ViewContext;
const e = (value: number | null) => ({ value, state: value === null ? ("suppressed" as const) : ("estimated" as const) });
const D: EstimatedDisaggregation = {
	measure: "affected_direct",
	refused: null,
	baseTotal: 10000,
	recordsUsed: 40,
	bands: [
		{ band: "0-14", female: e(2200), male: e(2300) },
		{ band: "15-64", female: e(2600), male: e(2500) },
		{ band: "65+", female: e(220), male: e(180) },
	],
	groups: [
		{ group: "0-4", female: e(800), male: e(820) },
		{ group: "80+", female: e(null), male: e(40) },
	],
	// Four named models (Alex, 2026-10-22; Analytics edaa715b), DELTA first.
	byModel: [
		{
			id: "delta",
			name: "DELTA disaggregation",
			source: "Alex Nwoko, DELTA product ruling, 2026-10-22",
			bands: [
				{ key: "0-4", label: "Young children (0-4)", split: false, female: e(800), male: e(820) },
				{ key: "5-17", label: "Children (5-17)", split: true, female: e(1400), male: e(1480) },
				{ key: "18-64", label: "Adults (18-64)", split: true, female: e(2600), male: e(2500) },
				{ key: "65+", label: "Older persons (65+)", split: false, female: e(null), male: e(180) },
			],
		},
		{
			id: "un",
			name: "UN disaggregation",
			source: "UN five-year age groups, UN DESA World Population Prospects 2024",
			bands: [
				{ key: "0-4", label: "0-4", split: false, female: e(800), male: e(820) },
				{ key: "80+", label: "80+", split: false, female: e(null), male: e(40) },
			],
		},
	],
	defaultModel: "delta",
	female: e(5020),
	male: e(4980),
	excluded: { biological: 1, underReview: 2, noYear: 3, before1950: 0, noReference: 0 },
	reference: { source: "UN DESA WPP", release: "2024", licence: "CC BY 3.0 IGO" },
	footnote: "Estimated from the national population structure, not reported by any record.",
	notForTargeting: true,
	meta: { method: "m", notApplied: [] },
};

describe("estimated sex and age split", () => {
	const panel = estimatedSplitPanel(ctx, D);
	const html = renderToString(<>{panel.render!()}</>).replace(/<!-- -->/g, "");

	it("hatches every estimated bar and tags the panel Estimated", () => {
		expect(html).toContain('fill="url(#est-hatch)"');
		expect(html).toMatch(/uppercase[^>]*>Estimated<\/span>/);
	});

	it("opens on the DELTA model, names it, and offers the four models (Alex, 2026-10-22)", () => {
		expect(pickModel(D, null)?.id).toBe("delta");
		expect(pickModel(D, "un")?.id).toBe("un");
		expect(html).toContain('aria-label="Estimated sex and age split, DELTA disaggregation"');
		expect(html).toContain("DELTA disaggregation: Alex Nwoko, DELTA product ruling, 2026-10-22.");
		expect(html).toContain('aria-label="UN disaggregation"');
		// The DELTA button is the selected one (a radio in a single-choice group).
		const delta = html.match(/<button[^>]*aria-label="DELTA disaggregation"[^>]*>/)?.[0] ?? "";
		expect(delta).toMatch(/aria-(checked|pressed)="true"|data-selected="true"/);
	});

	it("draws each band as a share of the model's total on the model's fixed axis", () => {
		const shares = pyramidShares(pickModel(D, "delta")!);
		const total = 800 + 820 + 1400 + 1480 + 2600 + 2500 + 180;
		expect(shares[0].female).toBeCloseTo((800 / total) * 100, 5);
		expect(shares[3].female).toBeNull();
		expect(PYRAMID_AXIS_MAX.delta).toBe(40);
		expect(PYRAMID_AXIS_MAX.un).toBe(10);
		expect(html).toContain(">40%</text>");
		// UN groups on 10%: 0-4 female is 800 of 1,660, past the edge, so capped and marked.
		expect(pyramidShares(pickModel(D, "un")!)[0].female).toBeCloseTo((800 / 1660) * 100, 5);
	});

	it("marks a band that takes a share of a five-year group, with the note", () => {
		expect(html).toContain(">5-17*</text>");
		expect(html).toContain("Children (5-17)*");
		expect(html).toContain("* Includes an even share of ages 15-19 (the source gives five-year groups).");
	});

	it("leaves a suppressed band without a bar", () => {
		expect(html.match(/fill="url\(#est-hatch\)"/g)).toHaveLength(7);
	});

	it("carries the footnote, the not-for-targeting line and what was left out, in small print", () => {
		expect(html).toContain(D.footnote);
		expect(html).toContain("Not a basis for targeting.");
		expect(html).toContain("Left out: 6 records");
		expect(html).toContain("font-size:7.5pt");
	});

	it("gives the page CSV nothing, so estimates never mix with reported data", () => {
		expect(panel.exportData).toBeUndefined();
		const csv = dashboardPanelsCsv([panel], "scope", "DELTA", "published", new Date("2026-10-20T00:00:00Z"));
		expect(csv).not.toContain("800");
	});

	it("downloads its own CSV with an estimated state on each row and the footnote", () => {
		const csv = estimatedSplitCsv(D, "Estimated sex and age split");
		expect(csv).toContain("Estimated sex and age split,0-4,female,800,estimated");
		expect(csv).toContain("Estimated sex and age split,80+,female,,suppressed");
		expect(csv).toContain(D.footnote);
	});

	it("says why a measure is refused, with no figures", () => {
		const refused = { ...D, refused: { measure: "deaths", reason: "deaths are not split by a population structure" } };
		const h = renderToString(<>{estimatedSplitPanel(ctx, refused).render!()}</>).replace(/<!-- -->/g, "");
		expect(h).toContain("No estimate for deaths: deaths are not split by a population structure");
		expect(h).not.toContain("est-hatch\"");
	});
});

describe("a bar past its model's axis", () => {
	it("is clamped at the edge and shows its value there", () => {
		// UN groups on a 10% axis: 0-4 female is 48.2% of 1,660.
		const un = { ...D, defaultModel: "un" as const };
		const h = renderToString(<>{estimatedSplitPanel(ctx, un).render!()}</>).replace(/<!-- -->/g, "");
		expect(h).toContain("◂ 48.2%");
		expect(h).toContain("49.4% ▸");
	});
});
