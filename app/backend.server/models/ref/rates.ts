import { sql } from "drizzle-orm";
import { dr } from "~/db.server";
import {
	approvalBasis,
	basisColumns,
	type ApprovalAudience,
} from "~/utils/approvalBasis";
import {
	measureValue,
	PROVISIONAL_ZERO_COVERAGE,
	type MeasureValue,
	type ValueState,
} from "~/utils/valueState";
import {
	getPopulationDenominator,
	type DenominatorRefusalCode,
	type DenominatorResult,
	type ReferenceProvenance,
} from "~/backend.server/models/ref/denominator";

// E1 (Enrichment Data Integration, section 7.2): rates per 100,000 people.
// A rate is a derived figure. It carries the numerator's value state and
// provenance and the denominator's source, release and reference year. If
// the denominator is missing, the rate is refused with a reason code and not
// computed (R7). Nothing here COALESCEs a missing value to 0.

export const PER_100K = 100_000;

export type RateRefusalCode =
	| DenominatorRefusalCode
	| "DENOMINATOR_ZERO"
	| "NUMERATOR_INVALID";

export interface RateNumerator {
	/** null unless the state is reported or zero_confirmed. */
	value: number | null;
	valueState: ValueState;
	/** Where the numerator comes from (basis, records, components). */
	provenance: Record<string, unknown>;
}

export interface RateRefusal {
	code: RateRefusalCode;
	reason: string;
	/** Present when the denominator lookup refused. */
	denominatorRefusal?: Extract<DenominatorResult, { ok: false }>["refusal"];
}

export type RateResult =
	| {
			ok: true;
			/** null unless the numerator is reported or zero_confirmed. */
			value: number | null;
			valueState: ValueState;
			method: string;
			per: typeof PER_100K;
			numerator: RateNumerator;
			denominator: {
				year: number;
				value: number;
				provenance: ReferenceProvenance;
			};
	  }
	| {
			ok: false;
			method: string;
			refusal: RateRefusal;
			numerator: RateNumerator;
	  };

/**
 * numerator / denominator x 100,000, with both provenances.
 *
 * - Denominator refused: the rate is refused with the same reason code.
 * - Denominator 0: refused (DENOMINATOR_ZERO); a rate on no people is
 *   undefined, not 0 or infinite.
 * - Numerator reported: the rate is computed and reported.
 * - Numerator zero_confirmed: the rate is 0, zero_confirmed.
 * - Any other numerator state (not_reported, insufficient_reporting, ...):
 *   the value is null and the state is the numerator's.
 */
export function ratePer100k(
	numerator: RateNumerator,
	denominator: DenominatorResult,
	method = "rate_per_100k",
): RateResult {
	if (!denominator.ok) {
		return {
			ok: false,
			method,
			numerator,
			refusal: {
				code: denominator.refusal.code,
				reason: denominator.refusal.reason,
				denominatorRefusal: denominator.refusal,
			},
		};
	}

	const carriesValue =
		numerator.valueState === "reported" ||
		numerator.valueState === "zero_confirmed";
	const numeratorValid = carriesValue
		? numerator.value !== null &&
			Number.isFinite(numerator.value) &&
			(numerator.valueState !== "zero_confirmed" || numerator.value === 0)
		: numerator.value === null;
	if (!numeratorValid) {
		return {
			ok: false,
			method,
			numerator,
			refusal: {
				code: "NUMERATOR_INVALID",
				reason: `Numerator value ${numerator.value} does not match its state ${numerator.valueState}`,
			},
		};
	}

	if (!(denominator.value > 0)) {
		return {
			ok: false,
			method,
			numerator,
			refusal: {
				code: "DENOMINATOR_ZERO",
				reason: `Population for ${denominator.year} is ${denominator.value}`,
			},
		};
	}

	const value = carriesValue
		? ((numerator.value as number) / denominator.value) * PER_100K
		: null;
	return {
		ok: true,
		value,
		valueState: numerator.valueState,
		method,
		per: PER_100K,
		numerator,
		denominator: {
			year: denominator.year,
			value: denominator.value,
			provenance: denominator.provenance,
		},
	};
}

/**
 * Sum of several measures into one numerator (A-1: deaths plus missing).
 * - any component reported: reported, the sum of the components that hold
 *   a value;
 * - every component zero_confirmed: zero_confirmed, 0;
 * - otherwise, insufficient_reporting if any component is, else
 *   not_reported, with a null value.
 * The component states travel in the provenance, so a partial sum is
 * visible to the reader.
 */
export function sumMeasures(parts: MeasureValue[]): {
	value: number | null;
	valueState: ValueState;
} {
	if (parts.some((p) => p.valueState === "reported")) {
		const value = parts.reduce(
			(acc, p) => (p.value === null ? acc : acc + p.value),
			0,
		);
		return { value, valueState: "reported" };
	}
	if (
		parts.length > 0 &&
		parts.every((p) => p.valueState === "zero_confirmed")
	) {
		return { value: 0, valueState: "zero_confirmed" };
	}
	if (parts.some((p) => p.valueState === "insufficient_reporting")) {
		return { value: null, valueState: "insufficient_reporting" };
	}
	return { value: null, valueState: "not_reported" };
}

const SENDAI_MEASURES = ["deaths", "missing", "affected_direct"] as const;
type SendaiMeasure = (typeof SENDAI_MEASURES)[number];

export const A1_METHOD = "a1_deaths_missing_per_100k";
/**
 * B-1 here is DELTA's directly affected people only. The full Sendai B-1 is
 * the composite B-2 + B-3 + B-4 + B-5 (injured or ill, damaged dwellings,
 * destroyed dwellings, livelihoods disrupted); that alignment belongs to the
 * SFM lane (launch item S1). No other component is added here.
 */
export const B1_METHOD = "b1_delta_affected_direct";

export interface SendaiNumerators {
	measures: Record<SendaiMeasure, MeasureValue>;
	/** Published records whose start date has no year; not in any year. */
	recordsUndated: number;
}

/**
 * National human-effects totals for one tenant and event start year (R3),
 * on the official approval basis (published, not retired). Totals come from
 * human_category_presence, one row per record, so the disaggregation cube
 * is never summed. A record counts as reported when its total is above 0;
 * as a confirmed zero when its total is 0 with a Yes flag, or an explicit No
 * with no value; otherwise as not reported (the same rule as the analytics
 * headline figures).
 *
 * Why not getAffectedPeopleByHazardFilters: its date filter keeps records
 * whose period overlaps the range and also keeps undated records, so a
 * multi-year or undated record would count in every year. R3 attributes a
 * record to its start year only.
 */
export async function sendaiNumeratorsForYear(
	countryAccountsId: string,
	year: number,
	audience: ApprovalAudience = "official",
): Promise<SendaiNumerators> {
	const measureCols = SENDAI_MEASURES.map((m) => {
		const flag = sql.raw(`hcp."${m}"`);
		const total = sql.raw(`hcp."${m}_total"`);
		return sql`
			SUM(${total}) FILTER (WHERE ${total} > 0) AS ${sql.raw(`"${m}_sum"`)},
			COUNT(*) FILTER (WHERE ${total} > 0) AS ${sql.raw(`"${m}_reported"`)},
			COUNT(*) FILTER (
				WHERE (${total} = 0 AND ${flag} IS TRUE)
					OR (${flag} IS FALSE AND COALESCE(${total}, 0) = 0)
			) AS ${sql.raw(`"${m}_zero"`)}`;
	});

	const res = await dr.execute(sql`
		WITH in_basis AS (
			SELECT dr."id",
				CASE WHEN dr."start_date" ~ '^[0-9]{4}(-[0-9]{2}(-[0-9]{2})?)?$'
					THEN left(dr."start_date", 4)::int
				END AS start_year
			FROM "disaster_records" dr
			WHERE dr."country_accounts_id" = ${countryAccountsId}
				AND ${approvalBasis(audience, basisColumns("dr"))}
		),
		in_year AS (
			SELECT "id" FROM in_basis WHERE start_year = ${year}
		)
		SELECT
			${sql.join(measureCols, sql`, `)},
			COUNT(*) AS records_total,
			(SELECT COUNT(*) FROM in_basis WHERE start_year IS NULL) AS records_undated
		FROM in_year fr
		LEFT JOIN "human_category_presence" hcp ON hcp."record_id" = fr."id"
	`);
	const row = (res.rows[0] ?? {}) as Record<string, unknown>;
	const measures = Object.fromEntries(
		SENDAI_MEASURES.map((m) => [
			m,
			measureValue(
				{
					sum: row[`${m}_sum`] as number | string | null,
					reported: row[`${m}_reported`] as number | string,
					zeroConfirmed: row[`${m}_zero`] as number | string,
					total: row.records_total as number | string,
				},
				PROVISIONAL_ZERO_COVERAGE,
			),
		]),
	) as Record<SendaiMeasure, MeasureValue>;
	return {
		measures,
		recordsUndated: Number(row.records_undated ?? 0),
	};
}

export interface SendaiRates {
	countryAccountsId: string;
	year: number;
	audience: ApprovalAudience;
	denominator: DenominatorResult;
	/** Deaths and missing per 100,000 (Sendai A-1). */
	a1: RateResult;
	/** DELTA directly affected per 100,000 (B-1 numerator, see B1_METHOD). */
	b1: RateResult;
	recordsUndated: number;
}

/**
 * National Sendai rates for one tenant and event start year, on the
 * official approval basis. A-1 = (deaths + missing) / population x 100,000.
 * B-1 = DELTA directly affected / population x 100,000.
 */
export async function sendaiRatesForYear(
	countryAccountsId: string,
	year: number,
): Promise<SendaiRates> {
	const audience: ApprovalAudience = "official";
	const [numerators, denominator] = await Promise.all([
		sendaiNumeratorsForYear(countryAccountsId, year, audience),
		getPopulationDenominator(countryAccountsId, { divisionId: null, year }),
	]);
	const { deaths, missing, affected_direct } = numerators.measures;
	const basis = {
		audience,
		countryAccountsId,
		eventStartYear: year,
		source: "human_category_presence",
	};

	const a1Sum = sumMeasures([deaths, missing]);
	const a1 = ratePer100k(
		{
			...a1Sum,
			provenance: { ...basis, components: { deaths, missing } },
		},
		denominator,
		A1_METHOD,
	);
	const b1 = ratePer100k(
		{
			value: affected_direct.value,
			valueState: affected_direct.valueState,
			provenance: { ...basis, components: { affected_direct } },
		},
		denominator,
		B1_METHOD,
	);

	return {
		countryAccountsId,
		year,
		audience,
		denominator,
		a1,
		b1,
		recordsUndated: numerators.recordsUndated,
	};
}
