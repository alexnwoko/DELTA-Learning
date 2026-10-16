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
	// A national or multi-year figure recorded against one sub-national unit
	// (Mozambique, 2026-10-16; Backend Migration rule c30-v1).
	"AGGREGATE_ON_SUBUNIT",
] as const;

export type PlausibilityMeasure =
	| "deaths"
	| "injured"
	| "missing"
	| "displaced"
	| "evacuated"
	| "relocated"
	| "affected_direct"
	| "affected_indirect"
	| "houses_destroyed"
	| "houses_damaged";

/**
 * DesInventar source field to the DELTA measures it feeds (DEC-008 and the
 * house fields). Evacuees and relocated people feed displaced and also
 * their own measures (TR-204 package measures), so a flag on evacuados
 * caveats both displaced and evacuated.
 */
export const PLAUSIBILITY_FIELD_MEASURES: Record<
	string,
	readonly PlausibilityMeasure[]
> = {
	muertos: ["deaths"],
	heridos: ["injured"],
	desaparece: ["missing"],
	damnificados: ["affected_direct"],
	afectados: ["affected_indirect"],
	evacuados: ["displaced", "evacuated"],
	reubicados: ["displaced", "relocated"],
	vivdest: ["houses_destroyed"],
	vivafec: ["houses_damaged"],
};

/** The measures a source field feeds; empty for fields that feed none. */
export function plausibilityMeasuresForField(
	field: string,
): readonly PlausibilityMeasure[] {
	return PLAUSIBILITY_FIELD_MEASURES[field] ?? [];
}

/** The source fields whose flags put a caveat on a measure. */
export function plausibilitySourceFields(
	measure: PlausibilityMeasure,
): string[] {
	return Object.entries(PLAUSIBILITY_FIELD_MEASURES)
		.filter(([, ms]) => ms.includes(measure))
		.map(([field]) => field);
}
