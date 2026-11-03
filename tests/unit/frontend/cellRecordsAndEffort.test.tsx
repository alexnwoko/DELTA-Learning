// The records behind a Hazard by month box (FR-AN-068) and the reporting
// effort panel (FR-AN-090): a missing value is a word, never 0.
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CellRecordsTable, parseCellRequest, recordValueText } from "~/frontend/analytics/dashboard/panels/CellRecordsList";
import { IMPACT_LAYOUT } from "~/frontend/analytics/dashboard/panels/impact/impactDashboardPanels";
import { reportingEffortPanel } from "~/frontend/analytics/dashboard/panels/impact/ReportingEffort";
import type { ViewContext } from "~/frontend/context";
import type { CellRecords } from "~/utils/dashboard/cellRecords";
import type { ReportingEffort } from "~/utils/dashboard/reportingEffort";
import { createMockTranslator } from "~/utils/translator";

const ctx = { t: createMockTranslator(), lang: "en", url: (p: string) => `/en${p}` } as unknown as ViewContext;
const text = (h: string) => h.replace(/<!-- -->/g, "");
const rec = (id: string, value: number | null, valueState: "reported" | "zero_confirmed" | "not_reported", over = {}) => ({ recordId: id, startDate: "2019-08-14", places: ["Aldera"], value, valueState, flags: [], underReview: false, source: "NDMO", ...over });
const D: CellRecords = {
	key: "h1", month: 8, measure: "deaths", total: 130,
	records: [rec("a", 186, "reported", { flags: ["AGGREGATE_ON_SUBUNIT"], underReview: true }), rec("b", 0, "zero_confirmed"), rec("c", null, "not_reported", { places: [], source: null, startDate: null })],
	meta: { method: "m", notApplied: ["sector"] },
};

describe("records behind a cell", () => {
	const html = text(renderToString(<CellRecordsTable ctx={ctx} d={D} title="Records behind this cell" valueLabel="Deaths" />));
	it("shows a number, a confirmed zero or a word, never 0 for a missing value", () => {
		expect(recordValueText(ctx, { value: 186, valueState: "reported" })).toBe("186");
		expect(recordValueText(ctx, { value: 0, valueState: "zero_confirmed" })).toBe("Zero, confirmed");
		expect(recordValueText(ctx, { value: null, valueState: "not_reported" })).toBe("No data");
		expect(recordValueText(ctx, { value: null, valueState: "reported" })).toBe("No data");
		expect(html).toContain(">No data<");
		expect(html).not.toContain(">0<");
	});
	it("says how many are listed of the total, marks flags and links each record", () => {
		expect(html).toContain("Showing 3 of 130 records, largest value first.");
		expect(html).toContain("Under review");
		expect(html).toContain("AGGREGATE_ON_SUBUNIT");
		expect(html).toContain('href="/en/disaster-record/a"');
		expect(html).toContain("Division not recorded");
		expect(html).toContain("No source recorded");
		expect(html).toContain("No date");
		expect(html).toContain("Not applied: sector");
	});
	it("refuses a cell it cannot read", () => {
		const p = (s: string) => parseCellRequest(new URLSearchParams(s));
		expect(p("cellKey=h1&cellMonth=8")).toEqual({ key: "h1", month: 8 });
		for (const bad of ["cellKey=h1", "cellMonth=8", "cellKey=h1&cellMonth=13", "cellKey=h1&cellMonth=0", "cellKey=h1&cellMonth=x", "cellKey=%20&cellMonth=8"]) expect(p(bad)).toBeNull();
	});
});

describe("reporting effort", () => {
	const E: ReportingEffort = {
		years: [{ year: 2019, records: 420, divisions: 12, sources: 8, recordsPerDivision: 35 }, { year: 2010, records: 30, divisions: 4, sources: 2, recordsPerDivision: null }],
		recordsNoYear: 12, minDivisions: 10, note: "More records can mean more reporting, not more disasters.", meta: { method: "Per start year", notApplied: [] },
	};
	const panel = reportingEffortPanel(ctx, E, { source: "DELTA", scope: "all", provisional: false });
	const html = text(renderToString(<>{panel.render!()}</>));
	it("shows records beside divisions and sources per year, with the note", () => {
		for (const c of ["Records", "Divisions reporting", "Sources", "Records per division", "More records can mean more reporting, not more disasters.", "12 records have no start year and are not listed."]) expect(html).toContain(c);
	});
	it("keeps years in the given order and withholds the ratio in words, never 0", () => {
		expect(html.indexOf(">2019<")).toBeLessThan(html.indexOf(">2010<"));
		expect(html).toContain("Insufficient reporting");
		const r = panel.exportData!.rows.find((x) => x.label === "2010" && x.series === "Records per division");
		expect(r?.value).toBeNull();
	});
	it("waits under Show more, so coverage and completeness stay last before Sendai", () => {
		expect(IMPACT_LAYOUT).not.toContain("impact-effort");
		expect(IMPACT_LAYOUT.slice(-2)).toEqual(["impact-2", "impact-12"]);
	});
});
