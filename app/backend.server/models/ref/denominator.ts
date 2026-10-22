import { sql } from "drizzle-orm";
import { dr } from "~/db.server";
import {
	REF_GRADES,
	REF_SOURCE_STATUSES,
	type RefGrade,
	type RefKeyScheme,
	type RefMethod,
	type RefRedistributionRule,
	type RefSourceStatus,
	type RefValueState,
} from "~/backend.server/models/ref/referenceValueRules";

// E1 (Enrichment Data Integration, sections 4 and 7.2): the population
// denominator for one tenant, geography and event year.
//
// - R2: the official national series first, then international official
//   estimates (UN WPP, WDI), then modelled values, each labelled.
// - R3: the reference year is the event start year; the value's period must
//   cover a date in that year.
// - R7: null is not zero. A missing denominator is refused with a reason
//   code; this module never returns 0 for a missing value.
// - R9: when the caller states the boundary vintage of its records, a value
//   on another vintage is refused, not crosswalked.

export const POPULATION_INDICATOR = "POP_TOTAL";

export type DenominatorRefusalCode =
	| "POPULATION_MISSING_FOR_YEAR"
	| "BOUNDARY_VINTAGE_MISMATCH";

/** Everything a derived figure must carry about its reference value (R6). */
export interface ReferenceProvenance {
	valueId: string;
	indicatorCode: string;
	countryAccountsId: string;
	/** null for the national value. */
	divisionId: string | null;
	keyScheme: RefKeyScheme;
	boundaryVintage: string;
	periodStart: string;
	periodEnd: string;
	value: number;
	valueState: RefValueState;
	lowerBound: number | null;
	upperBound: number | null;
	intervalType: string | null;
	method: RefMethod;
	grade: RefGrade;
	sourceStatus: RefSourceStatus;
	source: {
		id: string;
		name: string;
		provider: string | null;
		licence: string;
		redistributionRule: RefRedistributionRule;
		attributionText: string | null;
		rdlsId: string | null;
	};
	release: {
		id: string;
		version: string;
		releaseDate: string | null;
		deprecatedBy: string | null;
	};
}

export interface DenominatorRefusal {
	code: DenominatorRefusalCode;
	reason: string;
	countryAccountsId: string;
	divisionId: string | null;
	year: number;
	boundaryVintage: string | null;
	/** For BOUNDARY_VINTAGE_MISMATCH: the vintages that do hold a value. */
	availableVintages?: string[];
}

export type DenominatorResult =
	| { ok: true; year: number; value: number; provenance: ReferenceProvenance }
	| { ok: false; refusal: DenominatorRefusal };

export interface PopulationDenominatorOptions {
	/** null for the national denominator. */
	divisionId: string | null;
	/** Event start year (R3). */
	year: number;
	/** Boundary vintage of the records the rate is computed for (R9). */
	boundaryVintage?: string | null;
}

/** One stored value with its source and release, as read from ref.*. */
export interface PopulationCandidate {
	valueId: string;
	indicatorCode: string;
	countryAccountsId: string;
	divisionId: string | null;
	keyScheme: RefKeyScheme;
	boundaryVintage: string;
	periodStart: string;
	periodEnd: string;
	value: number | null;
	valueState: RefValueState;
	lowerBound: number | null;
	upperBound: number | null;
	intervalType: string | null;
	method: RefMethod;
	grade: RefGrade;
	sourceStatus: RefSourceStatus;
	sourceId: string;
	sourceName: string;
	sourceProvider: string | null;
	licence: string;
	redistributionRule: RefRedistributionRule;
	attributionText: string | null;
	rdlsId: string | null;
	releaseId: string;
	releaseVersion: string;
	releaseDate: string | null;
	releaseDeprecatedBy: string | null;
	releaseCreatedAt: string;
}

function periodCoversYear(c: PopulationCandidate, year: number): boolean {
	return c.periodStart <= `${year}-12-31` && c.periodEnd >= `${year}-01-01`;
}

/** A stored value usable as a denominator: it exists (R7). */
function holdsValue(c: PopulationCandidate): boolean {
	return (
		(c.valueState === "reported" || c.valueState === "zero_confirmed") &&
		c.value !== null &&
		Number.isFinite(c.value)
	);
}

function rank<T extends string>(list: readonly T[], v: T): number {
	const i = list.indexOf(v);
	return i < 0 ? list.length : i;
}

/**
 * Precedence among usable values (R1, R2): source status (official national,
 * international official, modelled), then grade (REF-A first), then a value
 * raked to an official parent total (method raked_to_official, the expected
 * method for WorldPop where an official total exists) before other methods,
 * then a release not deprecated, then the latest release date, then the latest
 * loaded release, then the latest period start.
 */
export function comparePopulationCandidates(
	a: PopulationCandidate,
	b: PopulationCandidate,
): number {
	const byStatus =
		rank(REF_SOURCE_STATUSES, a.sourceStatus) -
		rank(REF_SOURCE_STATUSES, b.sourceStatus);
	if (byStatus !== 0) return byStatus;
	const byGrade = rank(REF_GRADES, a.grade) - rank(REF_GRADES, b.grade);
	if (byGrade !== 0) return byGrade;
	const aRaked = a.method === "raked_to_official" ? 0 : 1;
	const bRaked = b.method === "raked_to_official" ? 0 : 1;
	if (aRaked !== bRaked) return aRaked - bRaked;
	const aDep = a.releaseDeprecatedBy ? 1 : 0;
	const bDep = b.releaseDeprecatedBy ? 1 : 0;
	if (aDep !== bDep) return aDep - bDep;
	const aDate = a.releaseDate ?? "";
	const bDate = b.releaseDate ?? "";
	if (aDate !== bDate) return aDate < bDate ? 1 : -1;
	if (a.releaseCreatedAt !== b.releaseCreatedAt) {
		return a.releaseCreatedAt < b.releaseCreatedAt ? 1 : -1;
	}
	if (a.periodStart !== b.periodStart) {
		return a.periodStart < b.periodStart ? 1 : -1;
	}
	return 0;
}

function toProvenance(c: PopulationCandidate): ReferenceProvenance {
	return {
		valueId: c.valueId,
		indicatorCode: c.indicatorCode,
		countryAccountsId: c.countryAccountsId,
		divisionId: c.divisionId,
		keyScheme: c.keyScheme,
		boundaryVintage: c.boundaryVintage,
		periodStart: c.periodStart,
		periodEnd: c.periodEnd,
		value: c.value as number,
		valueState: c.valueState,
		lowerBound: c.lowerBound,
		upperBound: c.upperBound,
		intervalType: c.intervalType,
		method: c.method,
		grade: c.grade,
		sourceStatus: c.sourceStatus,
		source: {
			id: c.sourceId,
			name: c.sourceName,
			provider: c.sourceProvider,
			licence: c.licence,
			redistributionRule: c.redistributionRule,
			attributionText: c.attributionText,
			rdlsId: c.rdlsId,
		},
		release: {
			id: c.releaseId,
			version: c.releaseVersion,
			releaseDate: c.releaseDate,
			deprecatedBy: c.releaseDeprecatedBy,
		},
	};
}

/**
 * Chooses the denominator among stored candidates for one tenant and
 * geography. Pure, so the precedence and refusal rules are unit-tested
 * without a database.
 */
export function choosePopulationDenominator(
	candidates: PopulationCandidate[],
	countryAccountsId: string,
	opts: PopulationDenominatorOptions,
): DenominatorResult {
	const vintage = opts.boundaryVintage ?? null;
	const refuse = (
		code: DenominatorRefusalCode,
		reason: string,
		availableVintages?: string[],
	): DenominatorResult => ({
		ok: false,
		refusal: {
			code,
			reason,
			countryAccountsId,
			divisionId: opts.divisionId,
			year: opts.year,
			boundaryVintage: vintage,
			...(availableVintages ? { availableVintages } : {}),
		},
	});

	const usable = candidates.filter(
		(c) =>
			c.countryAccountsId === countryAccountsId &&
			c.divisionId === opts.divisionId &&
			periodCoversYear(c, opts.year) &&
			holdsValue(c),
	);
	if (usable.length === 0) {
		return refuse(
			"POPULATION_MISSING_FOR_YEAR",
			`No population value for ${opts.year} at this geography`,
		);
	}

	const onVintage =
		vintage === null
			? usable
			: usable.filter((c) => c.boundaryVintage === vintage);
	if (onVintage.length === 0) {
		const available = [...new Set(usable.map((c) => c.boundaryVintage))];
		available.sort();
		return refuse(
			"BOUNDARY_VINTAGE_MISMATCH",
			`Population for ${opts.year} exists only on boundary vintage(s) ${available.join(", ")}, not ${vintage}`,
			available,
		);
	}

	const best = [...onVintage].sort(comparePopulationCandidates)[0];
	return {
		ok: true,
		year: opts.year,
		value: best.value as number,
		provenance: toProvenance(best),
	};
}

function num(v: unknown): number | null {
	if (v === null || v === undefined) return null;
	const n = Number(v);
	return Number.isFinite(n) ? n : null;
}

/**
 * Reads the POP_TOTAL candidates for one tenant, geography and year from the
 * reference store. Dates are read as text so no time zone shifts them.
 */
export async function readPopulationCandidates(
	countryAccountsId: string,
	opts: PopulationDenominatorOptions,
): Promise<PopulationCandidate[]> {
	const yearStart = `${opts.year}-01-01`;
	const yearEnd = `${opts.year}-12-31`;
	const res = await dr.execute(sql`
		SELECT
			v.id AS "valueId",
			v.indicator_code AS "indicatorCode",
			v.country_accounts_id AS "countryAccountsId",
			v.division_id AS "divisionId",
			v.key_scheme AS "keyScheme",
			v.boundary_vintage AS "boundaryVintage",
			to_char(v.period_start, 'YYYY-MM-DD') AS "periodStart",
			to_char(v.period_end, 'YYYY-MM-DD') AS "periodEnd",
			v.value AS "value",
			v.value_state AS "valueState",
			v.lower_bound AS "lowerBound",
			v.upper_bound AS "upperBound",
			v.interval_type AS "intervalType",
			v.method AS "method",
			v.grade AS "grade",
			v.source_status AS "sourceStatus",
			s.id AS "sourceId",
			s.name AS "sourceName",
			s.provider AS "sourceProvider",
			s.licence AS "licence",
			s.redistribution_rule AS "redistributionRule",
			s.attribution_text AS "attributionText",
			s.rdls_id AS "rdlsId",
			r.id AS "releaseId",
			r.version AS "releaseVersion",
			to_char(r.release_date, 'YYYY-MM-DD') AS "releaseDate",
			r.deprecated_by AS "releaseDeprecatedBy",
			to_char(r.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') AS "releaseCreatedAt"
		FROM ref.value v
		JOIN ref.release r ON r.id = v.release_id
		JOIN ref.source s ON s.id = r.source_id
		WHERE v.country_accounts_id = ${countryAccountsId}
			AND v.indicator_code = ${POPULATION_INDICATOR}
			AND v.division_id IS NOT DISTINCT FROM ${opts.divisionId}::uuid
			AND v.period_start <= ${yearEnd}::date
			AND v.period_end >= ${yearStart}::date
	`);
	return (res.rows as Record<string, unknown>[]).map((r) => ({
		...(r as unknown as PopulationCandidate),
		value: num(r.value),
		lowerBound: num(r.lowerBound),
		upperBound: num(r.upperBound),
	}));
}

/**
 * The population denominator for one tenant, geography (null = national)
 * and event year, with full provenance, or a refusal with a reason code.
 * Never returns 0 for a missing value.
 */
export async function getPopulationDenominator(
	countryAccountsId: string,
	opts: PopulationDenominatorOptions,
): Promise<DenominatorResult> {
	if (!Number.isInteger(opts.year)) {
		throw new Error(`year must be an integer, got ${opts.year}`);
	}
	const candidates = await readPopulationCandidates(countryAccountsId, opts);
	return choosePopulationDenominator(candidates, countryAccountsId, opts);
}
