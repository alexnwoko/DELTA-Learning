// Alex, 2026-10-18: year charts start at the first record; a year with no
// record is left vacant (no dotted outline); every chart takes its
// section's palette.
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { fromFirstMonth, fromFirstRecord, impact1to4FromFirstRecord } from "~/frontend/analytics/dashboard/firstRecord";
import { Sparkline } from "~/frontend/analytics/dashboard/panels/impact/HeadlineTiles";
import { YearColumns } from "~/frontend/analytics/dashboard/panels/impact/ImpactTimeline";
import { DASHBOARD_BAR, DASHBOARD_RAMP, SFM_BAR, SFM_RAMP } from "~/frontend/charts/sectionPalette";
import { IMPACT_PANELS_FIXTURE } from "~/utils/dashboard/impactPanels";
import type { PanelCell } from "~/utils/dashboard/impactPanels";

const cell = (value: number | null, state: PanelCell["valueState"], total: number): PanelCell =>
	({ value, valueState: state, recordsReported: state === "reported" ? total : 0, recordsZeroConfirmed: 0, recordsNotReported: 0, recordsTotal: total, recordsFlagged: 0 }) as PanelCell;
const years = [
	{ year: 2010, cell: cell(null, "not_reported", 0) },
	{ year: 2011, cell: cell(null, "not_reported", 0) },
	{ year: 2012, cell: cell(5, "reported", 2) },
	{ year: 2013, cell: cell(null, "not_reported", 0) },
	{ year: 2014, cell: cell(7, "reported", 3) },
];
const has = (p: { cell: PanelCell }) => p.cell.recordsTotal > 0;

describe("year charts start at the first record", () => {
	it("starts at the country's first record year when one is given", () => {
		expect(fromFirstRecord(years, 2011, has).map((y) => y.year)).toEqual([2011, 2012, 2013, 2014]);
	});

	it("under a place filter, starts at the first year with a record and keeps later gaps", () => {
		expect(fromFirstRecord(years, null, has).map((y) => y.year)).toEqual([2012, 2013, 2014]);
	});

	it("leaves a series with no record at all empty", () => {
		expect(fromFirstRecord(years.slice(0, 2), null, has)).toEqual([]);
	});

	it("trims the timeline and its by-hazard series to one start, and drops earlier annotations", () => {
		const d = impact1to4FromFirstRecord(IMPACT_PANELS_FIXTURE, 2023);
		expect(d.timeline.years.every((y) => y.year >= 2023)).toBe(true);
		expect(d.timeline.annotations.every((a) => a.year >= 2023)).toBe(true);
		expect(d.timeline.byHazard.every((h) => h.years.every((y) => y.year >= 2023))).toBe(true);
	});
});

describe("month grids start at the first month with data (Alex, 2026-10-20)", () => {
	it("drops the empty months before it and keeps later gaps", () => {
		const cells = [
			{ year: 2020, month: 11, n: 0 }, { year: 2020, month: 12, n: 0 },
			{ year: 2021, month: 1, n: 0 }, { year: 2021, month: 2, n: 4 },
			{ year: 2021, month: 3, n: 0 }, { year: 2021, month: 4, n: 2 },
		];
		expect(fromFirstMonth(cells, (c) => c.n > 0).map((c) => `${c.year}-${c.month}`)).toEqual(["2021-2", "2021-3", "2021-4"]);
		expect(fromFirstMonth(cells.slice(0, 3), (c) => c.n > 0)).toEqual([]);
	});
});

describe("a year with no record is vacant", () => {
	it("draws no dotted outline in the year columns or the sparkline", () => {
		const cols = renderToString(<YearColumns years={years} height={120} width={300} label="x" noDataText="No data" />);
		const spark = renderToString(<Sparkline points={years} />);
		for (const html of [cols, spark]) expect(html).not.toContain("stroke-dasharray");
		// The empty year keeps its hover text.
		expect(cols).toContain("2013: No data");
	});
});

describe("section palettes", () => {
	it("draws dashboard bars in the dashboard blue, and Sendai in its own ink", () => {
		const cols = renderToString(<YearColumns years={years} height={120} width={300} label="x" noDataText="No data" />);
		expect(cols).toContain(`fill="${DASHBOARD_BAR}"`);
		expect(DASHBOARD_RAMP).toEqual(["#f0f6ff", "#cfe3ff", "#9dc3ff", "#6a8bdc", "#2d3355"]);
		expect(SFM_RAMP).toEqual(["#f7fbff", "#d6eaf7", "#a8cfe3", "#76a6c1", "#2f4f5f"]);
		expect(SFM_BAR).toBe("#2f4f5f");
	});
});
