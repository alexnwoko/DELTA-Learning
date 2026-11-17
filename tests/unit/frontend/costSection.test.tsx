// Disaster cost section (Alex, 2026-10-22; Analytics 4b91b9ad, 183fbf12):
// a headline, one currency toggle, a 2x2 grid, the disclaimer verbatim; the
// illustrative projection is never in the page CSV; empty states read as
// words, never zeros.
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { dashboardPanelsCsv } from "~/frontend/analytics/dashboard/DashboardDownload";
import { arrangeImpactPanels } from "~/frontend/analytics/dashboard/panels/impact/impactDashboardPanels";
import { costExport, costSectionPanel, formatMoney, rankedHazards } from "~/frontend/analytics/dashboard/panels/impact/CostSection";
import type { ViewContext } from "~/frontend/context";
import type { CostPanels } from "~/utils/dashboard/costPanels";
import { createMockTranslator } from "~/utils/translator";

const ctx = { t: createMockTranslator(), lang: "en", url: (p: string) => `/en/${p}` } as unknown as ViewContext;
const cell = (value: number | null) => ({ value, valueState: value === null ? ("not_reported" as const) : ("reported" as const), recordsReported: value === null ? 0 : 5, recordsZeroConfirmed: 0, recordsNotReported: 0, recordsTotal: 5, recordsFlagged: 0 });
const m = (local: number | null, usd: number | null) => ({ local, usd });
const hazard = (key: string, total: number | null, perPersonRecords: number, projection: number | null) => ({
	key,
	label: key,
	costedRecords: 12,
	notCostedRecords: 30,
	total: m(total, total === null ? null : total / 60),
	medianPerRecord: m(100, 2),
	medianPerPerson: { ...m(perPersonRecords >= 10 ? 50 : null, perPersonRecords >= 10 ? 1 : null), records: perPersonRecords },
	peopleNotCosted: 400,
	projectionNotCosted: projection === null ? null : m(projection, projection / 60),
});

const D: CostPanels = {
	currency: { code: "MZN", name: "Mozambican metical" },
	fxRate: { source: "World Bank", indicator: "PA.NUS.FCRF", label: "World Bank official exchange rate (annual average)", release: "2026-07-01" },
	disclaimer: "Source-reported values, taken to be in Mozambican metical (MZN) for every record. Not a Sendai C-1 value.",
	peopleMeasure: "affected_direct",
	total: { ...m(9_000_000, 150_000), records: 40 },
	coverage: {
		records: { total: 120, costed: 40, notCosted: 80 },
		events: { total: 50, costed: 20, notCosted: 30 },
		people: { costed: cell(20000), notCosted: cell(null) },
		costPerPerson: { ...m(450, 7), records: 30 },
	},
	excluded: { beforeCurrencyChange: 3, copiedFromUsd: 0, noRate: 2 },
	byHazard: [hazard("Flood", 6_000_000, 25, 777_777), hazard("Drought", null, 0, null), hazard("Cyclone", 3_000_000, 4, null)],
	byYear: [
		{ year: 2015, records: 10, costedRecords: 4, notCostedRecords: 6, total: m(1_000_000, 20_000) },
		{ year: 2016, records: 0, costedRecords: 0, notCostedRecords: 0, total: m(null, null) },
		{ year: 2017, records: 8, costedRecords: 8, notCostedRecords: 0, total: m(8_000_000, 130_000) },
	],
	recordsNoYear: 6,
	recordsBeforeFirstYear: 11,
	projectionNote: "Illustrative only. Not a loss estimate.",
	meta: { method: "Per disaster record, the source-reported value.", notApplied: [] },
};

const html = (d: CostPanels, provisional = false) => renderToString(<>{costSectionPanel(ctx, d, provisional).render!()}</>).replace(/<!-- -->/g, "");

describe("disaster cost section", () => {
	const out = html(D);

	it("opens with the headline and the currency toggle", () => {
		expect(out).toContain("Disaster cost");
		expect(out).toMatch(/Reported cost: MZN\s9,000,000 from 40 of 120 records/);
		expect(out).toContain("Mozambican metical (MZN)");
		expect(out).toContain("US dollars");
	});

	it("draws the four charts", () => {
		for (const q of ["How much is costed", "Which hazards cost most", "Cost per person affected, by hazard", "Cost over time"]) expect(out).toContain(q);
		expect(out).toContain("80 of 120 records (30 events) have no cost recorded.");
		expect(out).toContain("n = 12 costed records");
	});

	it("says too few records under the minimum, with no bar", () => {
		expect(out).toContain("too few records");
	});

	it("tags the projection as illustrative and keeps it out of the CSV", () => {
		expect(out).toContain("Illustrative, not a loss estimate");
		const csv = dashboardPanelsCsv([costSectionPanel(ctx, D, false)], "scope", "DELTA", "published", new Date("2026-10-22T00:00:00Z"));
		expect(csv).not.toContain("777");
		expect(costExport(D, "local").map((r) => r.value)).not.toContain(777_777);
	});

	it("leaves a year with no value as a gap, never 0", () => {
		const year2016 = costExport(D, "local").find((r) => r.label === "2016");
		expect(year2016?.value).toBeNull();
		expect(year2016?.valueState).toBe("not_reported");
	});

	it("carries the disclaimer verbatim, the left-out counts and the year footnote", () => {
		expect(out).toContain(D.disclaimer);
		expect(out).toContain("3 dated before the change of currency unit");
		expect(out).toContain("2 with no exchange rate for the year");
		expect(out).toContain("11 records before 2015 and 6 with no year carry no value on this chart.");
	});

	it("ranks hazards by total, hazards with no value last", () => {
		expect(rankedHazards(D, "local").map((h) => h.key)).toEqual(["Flood", "Cyclone", "Drought"]);
	});

	it("formats money in the chosen currency", () => {
		expect(formatMoney("en", 1500, "usd", "MZN")).toMatch(/USD\s1,500/);
		expect(formatMoney("en", 1500, "local", "XQQ")).toContain("1,500");
	});

	it("reads well when nothing is costed", () => {
		const none: CostPanels = { ...D, total: { ...m(null, null), records: 0 }, coverage: { ...D.coverage, records: { total: 120, costed: 0, notCosted: 120 } }, byHazard: [], byYear: [] };
		const empty = html(none);
		expect(empty).toContain("No record in scope carries a cost value yet.");
		expect(empty).toContain("120 records are in scope; none of them reports a value.");
		expect(empty).toContain("Only published records count here");
		expect(empty).not.toContain("Reported cost:");
		expect(html(none, true)).not.toContain("Only published records count here");
	});

	it("sits full width directly above coverage of the records", () => {
		const ids = arrangeImpactPanels([
			{ id: "impact-2", n: 2, title: "c" },
			{ id: "impact-cost", n: 31, title: "d", wide: true },
			{ id: "impact-hazard-month", n: 28, title: "h", wide: true },
		]).map((p) => p.id);
		expect(ids).toEqual(["impact-hazard-month", "impact-cost", "impact-2"]);
	});
});
