// Estimated sex and age split (Alex, 2026-10-19; Analytics 40a0d72b):
// estimates are hatched, tagged and footnoted, and never enter the page
// CSV of reported data.
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { dashboardPanelsCsv } from "~/frontend/analytics/dashboard/DashboardDownload";
import { estimatedSplitCsv, estimatedSplitPanel, pyramidShares, PYRAMID_AXIS_MAX } from "~/frontend/analytics/dashboard/panels/impact/EstimatedSplit";
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

	it("draws each bar as a share of the total on one fixed axis, so countries compare (Alex, 2026-10-22)", () => {
		const shares = pyramidShares(D);
		// 0-4: 800 + 820 of 1,660 estimated in the groups; 80+: male 40, female suppressed.
		expect(shares[0].female).toBeCloseTo((800 / 1660) * 100, 5);
		expect(shares[1].female).toBeNull();
		expect(PYRAMID_AXIS_MAX).toBe(10);
		expect(html).toContain(">10%</text>");
		expect(html).toMatch(/0-4, Female: 48.2% of the total ▸ \(Estimated\)/);
	});

	it("leaves a suppressed group without a bar", () => {
		expect(html.match(/fill="url\(#est-hatch\)"/g)).toHaveLength(3);
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
