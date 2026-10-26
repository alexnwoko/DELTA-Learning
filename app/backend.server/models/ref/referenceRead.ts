import { sql } from "drizzle-orm";
import { dr } from "~/db.server";
import {
	REF_GRADES,
	type RefGrade,
	type RefKeyScheme,
	type RefMethod,
	type RefRedistributionRule,
	type RefSourceRedistributionRule,
	type RefSourceStatus,
	type RefValueState,
} from "~/backend.server/models/ref/referenceValueRules";

// BM-6 (FR-BAS-120, FR-BAS-180, FR-BAS-700; PD-05 reference endpoints;
// SEC-19; decision D-BM-08): the read model behind
// GET /:lang/api/reference/*. Every value travels with its value state,
// grade, method, vintage, period, source, release and licence. Licence
// rules are applied here, in the query, so no route can forget them, and
// what is withheld is counted and named rather than dropped silently.

/** Who is asking: a signed-in user on screen, or a machine with an API key. */
export type RefAudience = "signed_in" | "api_key";

// Analysis-only values never leave the server (PD-06). An API response is a
// copy the client can re-publish, so display-only and signed-in-only values
// stay on screens for signed-in users (D-BM-08).
const PERMITTED: Record<RefAudience, readonly RefRedistributionRule[]> = {
	signed_in: [
		"display_and_redistribute",
		"redistribute_share_alike",
		"display_only",
		"signed_in_only",
	],
	api_key: ["display_and_redistribute", "redistribute_share_alike"],
};

export function permittedRules(
	audience: RefAudience,
): readonly RefRedistributionRule[] {
	return PERMITTED[audience];
}

export interface ValuesQuery {
	indicator: string;
	divisionKey: string | null;
	/** Only the schemes a tenant value can be addressed by today. */
	keyScheme: Extract<RefKeyScheme, "iso3" | "national_id"> | null;
	from: string | null;
	to: string | null;
	/** Lowest grade accepted: REF-B returns REF-A and REF-B. */
	minGrade: RefGrade | null;
	/** By default only releases that no newer release replaces (FR-BAS-700). */
	includeDeprecated: boolean;
}

const INDICATOR_CODE = /^[A-Z][A-Z0-9_]{2,40}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isIsoDate(s: string): boolean {
	if (!ISO_DATE.test(s)) return false;
	const d = new Date(`${s}T00:00:00Z`);
	return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function parseValuesQuery(
	params: URLSearchParams,
): { ok: true; query: ValuesQuery } | { ok: false; error: string } {
	const get = (k: string) => {
		const v = params.get(k)?.trim();
		return v ? v : null;
	};
	const indicator = get("indicator");
	if (!indicator) return { ok: false, error: "indicator: required" };
	if (!INDICATOR_CODE.test(indicator)) {
		return { ok: false, error: "indicator: not an indicator code" };
	}
	for (const k of ["from", "to"]) {
		const v = get(k);
		if (v && !isIsoDate(v)) {
			return { ok: false, error: `${k}: must be a date (YYYY-MM-DD)` };
		}
	}
	const minGrade = get("minGrade");
	if (minGrade && !(REF_GRADES as readonly string[]).includes(minGrade)) {
		return {
			ok: false,
			error: `minGrade: must be one of ${REF_GRADES.join(", ")}`,
		};
	}
	const divisionKey = get("divisionKey");
	const keyScheme = get("keyScheme");
	if (
		(divisionKey && keyScheme !== "iso3" && keyScheme !== "national_id") ||
		(keyScheme && !divisionKey)
	) {
		return {
			ok: false,
			error: divisionKey
				? "keyScheme: required with divisionKey (iso3 or national_id)"
				: "divisionKey: required with keyScheme",
		};
	}
	return {
		ok: true,
		query: {
			indicator,
			divisionKey,
			keyScheme: keyScheme as ValuesQuery["keyScheme"],
			from: get("from"),
			to: get("to"),
			minGrade: minGrade as RefGrade | null,
			includeDeprecated: get("includeDeprecated") === "true",
		},
	};
}

export interface ReferenceValueOut {
	indicator: string;
	unit: string;
	divisionId: string | null;
	keyScheme: RefKeyScheme;
	boundaryVintage: string;
	periodStart: string;
	periodEnd: string;
	/** null unless the state is reported or zero_confirmed. */
	value: number | null;
	valueState: RefValueState;
	lowerBound: number | null;
	upperBound: number | null;
	intervalType: string | null;
	method: RefMethod;
	grade: RefGrade;
	qualityFlags: string[];
	isMonetary: boolean;
	currency: string | null;
	priceBasis: string | null;
	redistributionRule: RefRedistributionRule;
	source: {
		name: string;
		provider: string | null;
		licence: string;
		attributionText: string | null;
		sourceStatus: RefSourceStatus;
		rdlsId: string | null;
	};
	release: {
		version: string;
		releaseDate: string | null;
		deprecatedBy: string | null;
	};
}

export interface Withheld {
	count: number;
	/** The rules that kept values out of this response, sorted. */
	rules: string[];
	code: "REDISTRIBUTION_NOT_PERMITTED";
}

function num(v: unknown): number | null {
	if (v === null || v === undefined) return null;
	const n = Number(v);
	return Number.isFinite(n) ? n : null;
}

/** Values of one indicator for one tenant, filtered by the caller's licence. */
export async function listReferenceValues(
	countryAccountsId: string,
	q: ValuesQuery,
	audience: RefAudience,
): Promise<{ values: ReferenceValueOut[]; withheld: Withheld }> {
	const permitted = permittedRules(audience);
	// Grades are ordered A (best) to D; minGrade keeps that grade and better.
	const grades = q.minGrade
		? REF_GRADES.slice(0, REF_GRADES.indexOf(q.minGrade) + 1)
		: REF_GRADES;
	const division =
		q.keyScheme === "iso3"
			? sql`AND v.division_id IS NULL AND v.key_scheme = 'iso3'
				AND upper(${q.divisionKey}) = (
					SELECT upper(c.iso3) FROM country_accounts ca
					JOIN countries c ON c.id = ca.country_id
					WHERE ca.id = ${countryAccountsId})`
			: q.keyScheme === "national_id"
				? sql`AND d.national_id = ${q.divisionKey}`
				: sql``;
	const res = await dr.execute(sql`
		SELECT
			v.indicator_code AS "indicator",
			i.unit AS "unit",
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
			v.quality_flags AS "qualityFlags",
			v.is_monetary AS "isMonetary",
			v.currency AS "currency",
			v.price_basis AS "priceBasis",
			-- The source rule governs; a value's own rule counts only under a
			-- per_resource source (SEC-19 rule 6). An unresolved one stays
			-- per_resource, which no caller is permitted, so it is withheld.
			CASE WHEN s.redistribution_rule = 'per_resource'
				THEN COALESCE(v.redistribution_rule, 'per_resource')
				ELSE s.redistribution_rule
			END AS "rule",
			s.name AS "sourceName",
			s.provider AS "provider",
			s.licence AS "licence",
			s.attribution_text AS "attributionText",
			v.source_status AS "sourceStatus",
			s.rdls_id AS "rdlsId",
			r.version AS "version",
			to_char(r.release_date, 'YYYY-MM-DD') AS "releaseDate",
			r.deprecated_by AS "deprecatedBy"
		FROM ref.value v
		JOIN ref.indicator i ON i.code = v.indicator_code
		JOIN ref.release r ON r.id = v.release_id
		JOIN ref.source s ON s.id = r.source_id
		LEFT JOIN division d ON d.id = v.division_id
			AND d.country_accounts_id = v.country_accounts_id
		WHERE v.country_accounts_id = ${countryAccountsId}
			AND s.redistribution_rule <> 'excluded'
			AND v.indicator_code = ${q.indicator}
			AND v.grade IN (${sql.join(
				grades.map((g) => sql`${g}`),
				sql`, `,
			)})
			${q.includeDeprecated ? sql`` : sql`AND r.deprecated_by IS NULL`}
			${q.from ? sql`AND v.period_end >= ${q.from}::date` : sql``}
			${q.to ? sql`AND v.period_start <= ${q.to}::date` : sql``}
			${division}
		ORDER BY v.period_start, v.division_id NULLS FIRST, r.version
	`);
	const rows = res.rows as Record<string, unknown>[];
	const values: ReferenceValueOut[] = [];
	const withheldRules = new Set<string>();
	let withheldCount = 0;
	for (const r of rows) {
		const rule = r.rule as RefRedistributionRule;
		if (!permitted.includes(rule)) {
			withheldCount += 1;
			withheldRules.add(rule);
			continue;
		}
		values.push({
			indicator: r.indicator as string,
			unit: r.unit as string,
			divisionId: (r.divisionId as string | null) ?? null,
			keyScheme: r.keyScheme as RefKeyScheme,
			boundaryVintage: r.boundaryVintage as string,
			periodStart: r.periodStart as string,
			periodEnd: r.periodEnd as string,
			value: num(r.value),
			valueState: r.valueState as RefValueState,
			lowerBound: num(r.lowerBound),
			upperBound: num(r.upperBound),
			intervalType: (r.intervalType as string | null) ?? null,
			method: r.method as RefMethod,
			grade: r.grade as RefGrade,
			qualityFlags: (r.qualityFlags as string[] | null) ?? [],
			isMonetary: r.isMonetary === true,
			currency: (r.currency as string | null) ?? null,
			priceBasis: (r.priceBasis as string | null) ?? null,
			redistributionRule: rule,
			source: {
				name: r.sourceName as string,
				provider: (r.provider as string | null) ?? null,
				licence: r.licence as string,
				attributionText: (r.attributionText as string | null) ?? null,
				sourceStatus: r.sourceStatus as RefSourceStatus,
				rdlsId: (r.rdlsId as string | null) ?? null,
			},
			release: {
				version: r.version as string,
				releaseDate: (r.releaseDate as string | null) ?? null,
				deprecatedBy: (r.deprecatedBy as string | null) ?? null,
			},
		});
	}
	return {
		values,
		withheld: {
			count: withheldCount,
			rules: [...withheldRules].sort(),
			code: "REDISTRIBUTION_NOT_PERMITTED",
		},
	};
}

export interface ReferenceSourceOut {
	name: string;
	provider: string | null;
	documentationUrl: string | null;
	licence: string;
	redistributionRule: RefSourceRedistributionRule;
	attributionText: string | null;
	sourceStatus: RefSourceStatus;
	rdlsId: string | null;
}

/** Registered sources; an excluded source is never displayed (SEC-19 rule 7). */
export async function listReferenceSources(): Promise<ReferenceSourceOut[]> {
	const res = await dr.execute(sql`
		SELECT name, provider, documentation_url AS "documentationUrl", licence,
			redistribution_rule AS "redistributionRule",
			attribution_text AS "attributionText", source_status AS "sourceStatus",
			rdls_id AS "rdlsId"
		FROM ref.source
		WHERE redistribution_rule <> 'excluded'
		ORDER BY name
	`);
	return res.rows as unknown as ReferenceSourceOut[];
}

export interface ReferenceIndicatorOut {
	code: string;
	name: string | null;
	family: string;
	quantityType: string;
	unit: string;
}

export async function listReferenceIndicators(): Promise<
	ReferenceIndicatorOut[]
> {
	const res = await dr.execute(sql`
		SELECT code, name, family, quantity_type AS "quantityType", unit
		FROM ref.indicator ORDER BY family, code
	`);
	return res.rows as unknown as ReferenceIndicatorOut[];
}
