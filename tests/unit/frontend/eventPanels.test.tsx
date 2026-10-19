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
	it("draw 1 to 7; list the unbuilt features, with grey placeholders in their slots", () => {
		expect(panels.filter((p) => p.render).map((p) => p.n).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7]);
		// Reassessment 4.3: DE-8 to DE-26 are unbuilt; 12, 13 and 16 hold layout slots.
		const gaps = panels.filter((p) => p.gap);
		expect(gaps.map((p) => p.id).sort()).toEqual([...Array.from({ length: 19 }, (_, i) => `events-${i + 8}`), "events-aa"].sort());
		expect(gaps.filter((p) => p.gap!.ghost).map((p) => p.id).sort()).toEqual(["events-12", "events-13", "events-16"]);
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
		expect(panels.find((p) => p.n === 4)!.exportData!.notes).toContain("3 events have no start year and are left out.");
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
		expect(panels.find((p) => p.n === 7)!.exportData!.notes).toContain("The GAR threshold is defined on records; it is applied here to events.");
	});

	it("fold 8 to 16 into the strip on this view, and export only drawn panels", () => {
		expect(collapsesGaps("disaster_event")).toBe(true);
		const grid = text(renderToString(<PanelGrid ctx={ctx} panels={panels} collapseGaps />));
		expect(grid).toContain("Features Coming Soon");
		expect(grid).toContain("Disaster event register");
		const csv = dashboardPanelsCsv(panels, "Angola", "DELTA Angola", "published", new Date("2026-10-17T00:00:00Z"));
		expect(csv).toContain("Records grouped into disaster events,Not grouped,,900,reported,records,");
		expect(csv).not.toContain("Disaster event register");
	});
});

describe("Disaster events layout (FE-Proposal-02, Alex 2026-10-18)", () => {
	const map = {
		dimension: "disaster_event" as const,
		areas: [
			{ divisionId: "a", name: "Luanda", geojson: null, labelPoint: null, events: 4, fromRecords: 1 },
			{ divisionId: "b", name: "Cunene", geojson: null, labelPoint: null, events: 0, fromRecords: 0 },
			{ divisionId: "c", name: "Huila", geojson: null, labelPoint: null, events: 9, fromRecords: 0 },
		],
		unplacedEvents: 0,
		unplacedReasons: {},
		legend: { symbol: "Number of events" as const, note: "An event in several provinces counts in each, so provinces do not add up." as const },
		meta: { method: "Events per level-1 division", notApplied: [] },
	};
	const laid = eventDashboardPanels(ctx, D, { source: "DELTA Angola", scope: "Angola", provisional: false, map });

	it("opens with the headline and Ranked by divisions, then the agreed rows", () => {
		expect(laid.filter((p) => !p.more).map((p) => p.id)).toEqual([
			"events-1", "events-divisions", "events-5", "events-4", "events-3", "events-16",
			"events-7", "events-13", "events-2", "events-12",
		]);
		expect(laid.find((p) => p.id === "events-5")!.title).toBe("Hazard ranking by disaster events");
	});

	it("ranks divisions from the map's counts, leaving out divisions with none", () => {
		const rows = laid.find((p) => p.id === "events-divisions")!.exportData!.rows;
		expect(rows.map((r) => r.label)).toEqual(["Huila", "Luanda"]);
	});

	it("lists the official warning panel as waiting for warning data, never as a chart", () => {
		const w = laid.find((p) => p.id === "events-14")!;
		expect(w.gap!.ghost).toBeUndefined();
		expect(w.gap!.text).toContain("waits for warning data");
		expect(w.gap!.chartType).toBe("Bar chart");
	});
});

describe("Disaster events panels 11, 12, 13 and 16 (Analytics ee73e61f)", () => {
	const more = {
		register: {
			rows: [{ eventId: "e1", name: "Floods 2024", startDate: "2024-02-01", endDate: null, hazardLabel: "Hazard not coded", rule: "glide" as never, glide: "FL-2024-000001-AGO", nationalId: null, records: 12, divisions: 3 }],
			eventsInScope: 40,
		},
		completeness: { eventsInScope: 40, rows: [{ key: "glide" as const, label: "GLIDE number", events: 10 }, { key: "specific_hazard" as const, label: "Specific hazard", events: 0 }] },
		divisionsPerEvent: { bins: [{ label: "1", events: 20 }, { label: "2 to 4", events: 5 }], eventsWithoutDivision: 15 },
		bySector: { rows: [{ sectorId: "s1", label: "Housing", events: 7 }], eventsWithoutSector: 33 },
		exceedance: {
			measure: "deaths" as never,
			years: 20,
			points: [
				{ eventId: "e1", name: "Floods 2024", value: 120, rank: 1, perYear: 0.05, returnPeriodYears: 20 },
				{ eventId: "e2", name: "Drought 2019", value: 10, rank: 2, perYear: 0.1, returnPeriodYears: 10 },
			],
			eventsNotReported: 3,
			tooFewEvents: true,
		},
		season: { cells: [{ year: 2024, month: 2, events: 4 }], eventsWithoutMonth: 2 },
		meta: Object.fromEntries(["register", "completeness", "divisionsPerEvent", "bySector", "exceedance", "season"].map((k) => [k, { method: "m", notApplied: [] }])) as never,
	};
	const withMore = eventDashboardPanels(ctx, D, { source: "DELTA Angola", scope: "Angola", provisional: false, more });

	it("draws the four panels, so they leave Features Coming Soon and their grey slots", () => {
		for (const id of ["events-11", "events-12", "events-13", "events-16"]) {
			const p = withMore.find((x) => x.id === id)!;
			expect(p.gap).toBeUndefined();
			expect(p.render).toBeDefined();
		}
		expect(withMore.filter((p) => p.gap?.ghost)).toHaveLength(0);
	});

	it("shows completeness as n of the events in scope, 0 included", () => {
		const html = renderToString(<>{withMore.find((p) => p.id === "events-12")!.render!()}</>).replace(/<!-- -->/g, "");
		expect(html).toContain("10 of 40");
		expect(html).toContain("0 of 40");
	});

	it("draws exceedance only from ten events, and always says it is not a risk model", () => {
		const p = withMore.find((x) => x.id === "events-17")!;
		const html = renderToString(<>{p.render!()}</>).replace(/<!-- -->/g, "");
		expect(html).toContain("too few for a return period");
		expect(html).not.toContain("<circle");
		expect(p.exportData!.notes).toContain("Counts of recorded events only. Not a hazard or risk model.");
		const enough = eventDashboardPanels(ctx, D, { source: "DELTA Angola", scope: "Angola", provisional: false, more: { ...more, exceedance: { ...more.exceedance, tooFewEvents: false } } });
		expect(renderToString(<>{enough.find((x) => x.id === "events-17")!.render!()}</>).match(/<circle/g)).toHaveLength(2);
	});



	it("says how many events the register lists, and counts what panels 13 and 16 leave out", () => {
		expect(withMore.find((p) => p.id === "events-11")!.exportData!.notes).toContain("Newest 1 of 40 events in scope.");
		expect(withMore.find((p) => p.id === "events-13")!.exportData!.notes).toContain("15 events name no division and are left out.");
		expect(withMore.find((p) => p.id === "events-16")!.exportData!.notes).toContain("33 events have no linked record reporting sector damage.");
	});
});
