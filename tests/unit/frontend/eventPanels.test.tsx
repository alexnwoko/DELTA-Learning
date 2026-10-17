import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { dashboardPanelsCsv } from "~/frontend/analytics/dashboard/DashboardDownload";
import { PanelGrid } from "~/frontend/analytics/dashboard/PanelGrid";
import { continuousYears, eventContextNotes, eventDashboardPanels } from "~/frontend/analytics/dashboard/panels/events/eventPanels";
import { collapsesGaps } from "~/frontend/analytics/dashboard/types";
import type { ViewContext } from "~/frontend/context";
import type { PanelCell } from "~/utils/dashboard/impactPanels";
import type { EventPanels1to7 } from "~/utils/dashboard/eventPanels";
import { createMockTranslator } from "~/utils/translator";

const ctx = { t: createMockTranslator(), lang: "en", url: (p: string) => `/en/${p}` } as unknown as ViewContext;
const text = (html: string) => html.replace(/<!-- -->/g, "");
const cell = (value: number | null, valueState: PanelCell["valueState"], reported: number, total: number): PanelCell => ({
	value, valueState, recordsReported: valueState === "reported" ? reported : 0, recordsZeroConfirmed: valueState === "zero_confirmed" ? reported : 0,
	recordsNotReported: total - reported, recordsTotal: total, recordsFlagged: 0,
});
const meta = { method: "Counted per event", notApplied: [] };
// Shaped like the loader's answer (da02ce9a); figures invented for the test.
const D: EventPanels1to7 = {
	empty: null,
	headline: { events: 120, byRule: { glide: 20, serial: 90, entered: 10 }, eventsWithGlide: 22, recordsLinked: 300, recordsInScope: 1200, deaths: cell(410, "reported", 150, 300) },
	linkage: { linked: { glide: 80, serial: 200, entered: 20 }, notLinked: 900, recordsInScope: 1200 },
	largest: { measure: "deaths", rows: [
		{ eventId: "e1", name: "Floods 2021", glide: "FL-2021-000123-AGO", startDate: "2021-03-01", hazardLabel: "Flood", rule: "glide", records: 40, divisions: 5, cell: cell(98, "reported", 30, 40) },
		{ eventId: "e2", name: "Drought 2019", glide: null, startDate: null, hazardLabel: "Drought", rule: "serial", records: 12, divisions: 3, cell: cell(null, "not_reported", 0, 12) },
	] },
	byYear: { years: [{ year: 2019, events: 4, byRule: { glide: 1, serial: 3, entered: 0 } }, { year: 2021, events: 6, byRule: { glide: 2, serial: 4, entered: 0 } }], eventsWithoutYear: 3 },
	byHazard: { rows: [{ hipTypeId: "1042", label: "Meteorological and Hydrological", events: 80 }, { hipTypeId: "none", label: "Hazard not coded", events: 15 }] },
	recordsPerEvent: { bins: [{ label: "1", events: 70 }, { label: "2 to 5", events: 30 }, { label: "6 to 20", events: 15 }, { label: "21 to 100", events: 5 }, { label: "Over 100", events: 0 }], eventsWithoutRecords: 2, recordsNotGrouped: 900 },
	eventSize: { threshold: { deaths: 30, housesDestroyed: 600, source: "GAR 2015" }, intensive: 4, extensive: 90, zeroConfirmed: 6, notReported: 20, note: "The GAR threshold is defined on records; it is applied here to events." },
	meta: { headline: meta, linkage: meta, largest: meta, byYear: meta, byHazard: meta, recordsPerEvent: meta, eventSize: meta },
};
const panels = eventDashboardPanels(ctx, D, { source: "DELTA Angola", scope: "Angola", provisional: false });
const html = (n: number) => text(renderToString(<>{panels.find((p) => p.n === n)!.render!()}</>));

describe("Disaster events panels 1 to 7", () => {
	it("draw 1 to 7 and list 8 to 16 as being built", () => {
		expect(panels.filter((p) => p.render).map((p) => p.n)).toEqual([1, 2, 3, 4, 5, 6, 7]);
		expect(panels.filter((p) => p.gap).map((p) => p.n)).toEqual([8, 9, 10, 11, 12, 13, 14, 15, 16]);
	});

	it("print the grouping rule and the ungrouped share on every panel (RV-1)", () => {
		const [rule, ungrouped] = eventContextNotes(ctx.t, D);
		expect(rule).toBe("Grouping rule: GLIDE (20 events); Guarded country serial (90 events); Entered as an event (10 events).");
		expect(ungrouped).toBe("900 of 1200 records (75%) are not grouped into an event.");
		for (const p of panels.filter((x) => x.exportData)) expect(p.exportData!.notes, p.title).toContain(rule);
	});

	it("1: counts events, never as records, and keeps the deaths state", () => {
		const h = html(1);
		expect(h).toContain("120");
		expect(h).toContain("of 1,200 records in scope (25%)");
		expect(h).toContain("150 of 300 records report this");
	});

	it("2: leads with the ungrouped share; parts sum to the records in scope", () => {
		const h = html(2);
		expect(h).toContain("75% of records in scope are not grouped into an event.");
		expect(h.match(/<rect /g)!.length).toBeGreaterThanOrEqual(100);
	});

	it("3: a missing figure is a word with its coverage", () => {
		const h = html(3);
		expect(h).toContain("FL-2021-000123-AGO");
		expect(h).toMatch(/No data.*0 of 12 records report this/s);
	});

	it("4: a year with no event is a gap, and events without a year are counted", () => {
		const years = continuousYears(D.byYear.years);
		expect(years.map((y) => y.year)).toEqual([2019, 2020, 2021]);
		expect(years[1].cell.valueState).toBe("not_reported");
		expect(years[1].cell.value).toBeNull();
		expect(html(4)).toContain("2020: No events recorded");
		expect(panels[3].exportData!.notes).toContain("3 events have no start year and are left out.");
	});

	it("5: keeps 'Hazard not coded' as its own row", () => {
		expect(html(5)).toContain("Hazard not coded");
	});

	it("6: states ungrouped records apart from the events bars", () => {
		expect(html(6)).toContain("Not grouped: 900 records belong to no event.");
	});

	it("7: counts confirmed-zero and not-reported events in words with the GAR note", () => {
		const h = html(7);
		expect(h).toContain("Events whose records report neither: <span");
		expect(panels[6].exportData!.notes).toContain("The GAR threshold is defined on records; it is applied here to events.");
	});

	it("fold 8 to 16 into the strip on this view, and export only drawn panels", () => {
		expect(collapsesGaps("disaster_event")).toBe(true);
		const grid = text(renderToString(<PanelGrid ctx={ctx} panels={panels} collapseGaps />));
		expect(grid).toContain("Not yet available");
		expect(grid).toContain("Event register");
		const csv = dashboardPanelsCsv(panels, "Angola", "DELTA Angola", "published", new Date("2026-10-17T00:00:00Z"));
		expect(csv).toContain("Records grouped into events,Not grouped,,900,reported,records,");
		expect(csv).not.toContain("Event register");
	});
});
