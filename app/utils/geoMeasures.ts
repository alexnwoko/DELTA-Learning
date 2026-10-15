// Measures the geoportal read model carries (build spec s4.1). Pure module:
// safe for server and client code.
//
// Disaster impact: records, human-effect totals from human_category_presence
// (never the disaggregation cube) and house counts from Housing damages.
// Event dimensions: events, counted once per event and area. Monetary
// measures are refused while the money conventions are open (PD-05).

import type { QueryDimension } from "~/utils/deltaQuery";

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

/**
 * Housing sector (seeded by migration 20250813075915, same id in every
 * instance). House counts are damages rows in this sector or below it.
 */
export const HOUSING_SECTOR_ID = "6ac0b833-6218-49d0-9882-827c1b748d7a";

/** Read-model method version, echoed in every response's meta. */
export const GEO_METHOD_VERSION = "geo.v1";
