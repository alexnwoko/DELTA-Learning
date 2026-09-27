// Plausibility flags (solution pack C30): the migration stores, per record,
// legacy_data.migration.plausibility_flags = [{ code, fields[], rule_version,
// note }], naming the DesInventar source fields a flag concerns. A flag puts a
// caveat only on the measures those fields feed (DEC-008 mapping). Values are
// never changed. Pure module: safe for server and client code.

export const PLAUSIBILITY_CODES = [
	"IMPLAUSIBLE_MAGNITUDE",
	"IDENTICAL_ACROSS_FIELDS",
	"HAZARD_EFFECT_MISMATCH",
	"SENTINEL_MAGNITUDE",
] as const;

export type PlausibilityMeasure =
	| "deaths"
	| "injured"
	| "missing"
	| "displaced"
	| "affected_direct"
	| "affected_indirect"
	| "houses_destroyed"
	| "houses_damaged";

/** DesInventar source field to DELTA measure (DEC-008 and the house fields). */
export const PLAUSIBILITY_FIELD_MEASURE: Record<string, PlausibilityMeasure> = {
	muertos: "deaths",
	heridos: "injured",
	desaparece: "missing",
	damnificados: "affected_direct",
	afectados: "affected_indirect",
	evacuados: "displaced",
	reubicados: "displaced",
	vivdest: "houses_destroyed",
	vivafec: "houses_damaged",
};

/** The source fields whose flags put a caveat on a measure. */
export function plausibilitySourceFields(
	measure: PlausibilityMeasure,
): string[] {
	return Object.entries(PLAUSIBILITY_FIELD_MEASURE)
		.filter(([, m]) => m === measure)
		.map(([field]) => field);
}
