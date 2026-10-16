// Measures the geoportal read model carries (build spec s4.1). Pure module:
// safe for server and client code.
//
// Disaster impact: records, human-effect totals from human_category_presence
// (never the disaggregation cube) and house counts from Housing damages.
// Event dimensions: events, counted once per event and area. Monetary
// measures are refused while the money conventions are open (PD-05).

import type { QueryDimension } from "~/utils/deltaQuery";
import type { MeasureFamily } from "~/utils/mapState";

export const GEO_HUMAN_MEASURES = [
	"deaths",
	"injured",
	"missing",
	"affected_direct",
	"affected_indirect",
	"displaced",
] as const;

export type GeoHumanMeasure = (typeof GEO_HUMAN_MEASURES)[number];

export const GEO_HOUSE_MEASURES = [
	"houses_destroyed",
	"houses_damaged",
] as const;

export type GeoHouseMeasure = (typeof GEO_HOUSE_MEASURES)[number];

/** Measures of the disaster impact dimension (one atom per record). */
export const GEO_RECORD_MEASURES = [
	"records",
	...GEO_HUMAN_MEASURES,
	...GEO_HOUSE_MEASURES,
] as const;

/** Measures of the two event dimensions (one atom per event). */
export const GEO_EVENT_MEASURES = ["events"] as const;

export const GEO_MEASURES = [
	...GEO_RECORD_MEASURES,
	...GEO_EVENT_MEASURES,
] as const;

export type GeoMeasure = (typeof GEO_MEASURES)[number];

/** The measures a dimension serves, in display order. */
export function geoMeasuresFor(
	dimension: QueryDimension,
): readonly GeoMeasure[] {
	return dimension === "disaster_impact"
		? GEO_RECORD_MEASURES
		: GEO_EVENT_MEASURES;
}

export function isGeoMeasure(
	value: string,
	dimension: QueryDimension = "disaster_impact",
): value is GeoMeasure {
	return (geoMeasuresFor(dimension) as readonly string[]).includes(value);
}

/** A translatable label: a locale key and its English text. */
export interface GeoLabel {
	code: string;
	msg: string;
}

/** User-facing names of the three dimensions (Alex ruling 2026-10-16). */
export const GEO_DIMENSION_LABELS: Record<QueryDimension, GeoLabel> = {
	hazardous_event: {
		code: "geoportal.dim.hazardous_event",
		msg: "Hazardous events",
	},
	disaster_event: {
		code: "geoportal.dim.disaster_event",
		msg: "Disaster events",
	},
	disaster_impact: {
		code: "geoportal.dim.disaster_impact",
		msg: "Disaster impact",
	},
};

export interface GeoMeasureInfo {
	label: GeoLabel;
	/** Unit shown with every value, plural form. */
	unit: GeoLabel;
	/** Ramp family (V-2: one ramp per family). */
	family: MeasureFamily;
}

const PEOPLE: GeoLabel = { code: "geoportal.unit.people", msg: "people" };

/**
 * One table for labels, units and ramp families, read by the page, the
 * legend, the table and the dossier, so no screen keeps its own copy. The
 * count measure says "disaster impacts", never "records" (ruling
 * 2026-10-16); the measure id stays `records` (D8 option a).
 */
export const GEO_MEASURE_INFO: Record<GeoMeasure, GeoMeasureInfo> = {
	records: {
		label: {
			code: "geoportal.measure.records",
			msg: "Disaster impacts (count)",
		},
		unit: { code: "geoportal.unit.disaster_impacts", msg: "disaster impacts" },
		family: "events",
	},
	deaths: {
		label: { code: "geoportal.measure.deaths", msg: "Deaths" },
		unit: PEOPLE,
		family: "people",
	},
	injured: {
		label: { code: "geoportal.measure.injured", msg: "Injured" },
		unit: PEOPLE,
		family: "people",
	},
	missing: {
		label: { code: "geoportal.measure.missing", msg: "Missing" },
		unit: PEOPLE,
		family: "people",
	},
	affected_direct: {
		label: {
			code: "geoportal.measure.affected_direct",
			msg: "Directly affected",
		},
		unit: PEOPLE,
		family: "people",
	},
	affected_indirect: {
		label: {
			code: "geoportal.measure.affected_indirect",
			msg: "Indirectly affected",
		},
		unit: PEOPLE,
		family: "people",
	},
	displaced: {
		label: { code: "geoportal.measure.displaced", msg: "Displaced" },
		unit: PEOPLE,
		family: "people",
	},
	houses_destroyed: {
		label: {
			code: "geoportal.measure.houses_destroyed",
			msg: "Houses destroyed",
		},
		unit: { code: "geoportal.unit.houses", msg: "houses" },
		family: "housing",
	},
	houses_damaged: {
		label: { code: "geoportal.measure.houses_damaged", msg: "Houses damaged" },
		unit: { code: "geoportal.unit.houses", msg: "houses" },
		family: "housing",
	},
	events: {
		label: { code: "geoportal.measure.events", msg: "Events" },
		unit: { code: "geoportal.unit.events", msg: "events" },
		family: "events",
	},
};

/** Info for a measure id; unknown ids fall back to a plain label. */
export function geoMeasureInfo(measure: string): GeoMeasureInfo {
	return (
		(GEO_MEASURE_INFO as Record<string, GeoMeasureInfo>)[measure] ?? {
			label: { code: `geoportal.measure.${measure}`, msg: measure },
			unit: { code: "geoportal.unit.none", msg: "" },
			family: "people",
		}
	);
}

/**
 * Housing sector (seeded by migration 20250813075915, same id in every
 * instance). House counts are damages rows in this sector or below it.
 */
export const HOUSING_SECTOR_ID = "6ac0b833-6218-49d0-9882-827c1b748d7a";

/** Read-model method version, echoed in every response's meta. */
export const GEO_METHOD_VERSION = "geo.v1";
