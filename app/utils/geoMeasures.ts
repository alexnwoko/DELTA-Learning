// Measures the geoportal read model carries (build spec s4.1). Pure module:
// safe for server and client code.
//
// Human effects come from human_category_presence totals, never from the
// disaggregation cube. "records" counts disaster records. Monetary measures
// are not carried while pack decision 16 (D-17) keeps money out of totals.

export const GEO_HUMAN_MEASURES = [
	"deaths",
	"injured",
	"missing",
	"affected_direct",
	"affected_indirect",
	"displaced",
] as const;

export type GeoHumanMeasure = (typeof GEO_HUMAN_MEASURES)[number];

export const GEO_MEASURES = ["records", ...GEO_HUMAN_MEASURES] as const;

export type GeoMeasure = (typeof GEO_MEASURES)[number];

export const GEO_MONETARY_MEASURES = [
	"damages",
	"losses",
	"disruption",
	"total_damage_amount",
] as const;

export function isGeoMeasure(value: string): value is GeoMeasure {
	return (GEO_MEASURES as readonly string[]).includes(value);
}

export function isGeoMonetaryMeasure(value: string): boolean {
	return (GEO_MONETARY_MEASURES as readonly string[]).includes(value);
}

/** Read-model method version, echoed in every response's meta. */
export const GEO_METHOD_VERSION = "geo.v1";
