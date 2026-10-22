// Time charts start where the data starts (Alex, 2026-10-18; made general
// 2026-10-20: "only start every chart from the month where the data
// starts"): at the first year, or for month grids the first month, holding a
// reported figure or a confirmed zero in the chart's own scope. Applied once
// to each payload, so a chart and its CSV agree. Later periods with no data
// stay as gaps, drawn as empty space, never 0.
import type { EventPanels1to7 } from "~/utils/dashboard/eventPanels";
import type { EventPanels8to16 } from "~/utils/dashboard/eventPanels8to16";
import type { HazardEventPanels1to7 } from "~/utils/dashboard/hazardEventPanels";
import type { ImpactPanels1to4, PanelCell } from "~/utils/dashboard/impactPanels";
import type { ImpactPanels5to16 } from "~/utils/dashboard/impactPanels5to16";
import type { SectorPanels1to7 } from "~/utils/dashboard/sectorPanels";
import type { SendaiSection } from "~/utils/dashboard/sendaiPanels";

/** A fixed first year (the country's), or null: start at the first year that has a record. */
export type FirstYear = number | null;

/** A period holds data: a reported figure or a confirmed zero. */
const hasRecords = (c: PanelCell | null | undefined) => c?.valueState === "reported" || c?.valueState === "zero_confirmed";

/** The year a series starts: the fixed year, else its first year with a record (null: none). */
export function startYear<T extends { year: number }>(points: T[], first: FirstYear, has: (p: T) => boolean): number | null {
	if (first !== null) return first;
	const hit = points.find(has);
	return hit ? hit.year : null;
}

/** Drops the years before the start; a series with no record at all is left empty. */
export function fromYear<T extends { year: number }>(points: T[], start: number | null): T[] {
	if (start === null) return [];
	return points.filter((p) => p.year >= start);
}

/** Year-month cells from the first month that holds data; later empty months stay as gaps. */
export function fromFirstMonth<T extends { year: number; month: number }>(cells: T[], has: (c: T) => boolean): T[] {
	const key = (c: T) => c.year * 12 + c.month;
	const hits = cells.filter(has).map(key);
	if (hits.length === 0) return [];
	const start = Math.min(...hits);
	return cells.filter((c) => key(c) >= start);
}

/** fromYear(startYear(...)) for one series. */
export function fromFirstRecord<T extends { year: number }>(points: T[], first: FirstYear, has: (p: T) => boolean): T[] {
	return fromYear(points, startYear(points, first, has));
}

const byCell = (p: { cell: PanelCell }) => hasRecords(p.cell);

export function impact1to4FromFirstRecord(d: ImpactPanels1to4, first: FirstYear): ImpactPanels1to4 {
	// The timeline and its "by hazard" series share one start, so they line up.
	const start = startYear(d.timeline.years, first, byCell);
	return {
		...d,
		tiles: d.tiles.map((t) => ({ ...t, sparkline: fromFirstRecord(t.sparkline, first, byCell) })),
		timeline: {
			...d.timeline,
			years: fromYear(d.timeline.years, start),
			annotations: start === null ? [] : d.timeline.annotations.filter((a) => a.year >= start),
			byHazard: d.timeline.byHazard.map((h) => ({ ...h, years: fromYear(h.years, start) })),
		},
	};
}

export function impact5to16FromFirstRecord(d: ImpactPanels5to16, _first: FirstYear): ImpactPanels5to16 {
	return { ...d, season: { ...d.season, cells: fromFirstMonth(d.season.cells, byCell) } };
}

export function eventsFromFirstRecord(d: EventPanels1to7, first: FirstYear): EventPanels1to7 {
	return { ...d, byYear: { ...d.byYear, years: fromFirstRecord(d.byYear.years, first, (y) => y.events > 0) } };
}

export function hazardEventsFromFirstRecord(d: HazardEventPanels1to7, first: FirstYear): HazardEventPanels1to7 {
	return {
		...d,
		byYear: { ...d.byYear, years: fromFirstRecord(d.byYear.years, first, (y) => y.events > 0) },
		season: { ...d.season, cells: fromFirstMonth(d.season.cells, (c) => c.events > 0) },
	};
}

export function sectorsFromFirstRecord(d: SectorPanels1to7, first: FirstYear): SectorPanels1to7 {
	// Every sector's line starts in the same year, the first with any sector record.
	const all = d.byYear.series.flatMap((s) => s.years);
	const start = first ?? (all.filter((y) => hasRecords(y.records)).map((y) => y.year).sort((a, b) => a - b)[0] ?? null);
	return {
		...d,
		byYear: { ...d.byYear, series: d.byYear.series.map((s) => ({ ...s, years: fromYear(s.years, start) })) },
	};
}

export function sendaiFromFirstRecord(d: SendaiSection, first: FirstYear): SendaiSection {
	const injuredStart = startYear(d.b1.injured, first, byCell);
	const directStart = startYear(d.b1.affectedDirect, first, byCell);
	// B1's two series share the axis: start at the earlier of the two.
	const b1Start = injuredStart === null ? directStart : directStart === null ? injuredStart : Math.min(injuredStart, directStart);
	return {
		...d,
		a1: { ...d.a1, years: fromFirstRecord(d.a1.years, first, (y) => hasRecords(y.deaths) || hasRecords(y.missing)) },
		b1: { injured: fromYear(d.b1.injured, b1Start), affectedDirect: fromYear(d.b1.affectedDirect, b1Start) },
		b2: { ...d.b2, rows: fromFirstRecord(d.b2.rows, first, (y) => hasRecords(y.destroyed) || hasRecords(y.damaged)) },
	};
}

export function events8to16FromFirstRecord(d: EventPanels8to16, _first: FirstYear): EventPanels8to16 {
	return { ...d, season: { ...d.season, cells: fromFirstMonth(d.season.cells, (c) => c.events > 0) } };
}
