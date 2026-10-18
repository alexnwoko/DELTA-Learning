// Year charts start where the records start (Alex, 2026-10-18): at the
// country's first record year, or, under a place filter, at the first year
// with a record in that place. Applied once to each payload, so a chart and
// its CSV always agree. Years inside the period with no record stay in the
// series as gaps, drawn as empty space.
import type { EventPanels1to7 } from "~/utils/dashboard/eventPanels";
import type { HazardEventPanels1to7 } from "~/utils/dashboard/hazardEventPanels";
import type { ImpactPanels1to4, PanelCell } from "~/utils/dashboard/impactPanels";
import type { ImpactPanels5to16 } from "~/utils/dashboard/impactPanels5to16";
import type { SectorPanels1to7 } from "~/utils/dashboard/sectorPanels";
import type { SendaiSection } from "~/utils/dashboard/sendaiPanels";

/** A fixed first year (the country's), or null: start at the first year that has a record. */
export type FirstYear = number | null;

const hasRecords = (c: PanelCell | null | undefined) => (c?.recordsTotal ?? 0) > 0;

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

export function impact5to16FromFirstRecord(d: ImpactPanels5to16, first: FirstYear): ImpactPanels5to16 {
	return { ...d, season: { ...d.season, cells: fromFirstRecord(d.season.cells, first, byCell) } };
}

export function eventsFromFirstRecord(d: EventPanels1to7, first: FirstYear): EventPanels1to7 {
	return { ...d, byYear: { ...d.byYear, years: fromFirstRecord(d.byYear.years, first, (y) => y.events > 0) } };
}

export function hazardEventsFromFirstRecord(d: HazardEventPanels1to7, first: FirstYear): HazardEventPanels1to7 {
	return {
		...d,
		byYear: { ...d.byYear, years: fromFirstRecord(d.byYear.years, first, (y) => y.events > 0) },
		season: { ...d.season, cells: fromFirstRecord(d.season.cells, first, (c) => c.events > 0) },
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
