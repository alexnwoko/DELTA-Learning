// E1 (Enrichment Data Integration, sections 4 and 8): the rules for one
// reference value, as in delta_reference_value.schema.json (JSON Schema
// 2020-12). The loader validates every CSV row with these rules before it
// writes; the ref.value CHECK constraints enforce the same rules in the
// database. Pure module: no database access.

export const REF_FAMILIES = [
	"population",
	"exposure",
	"vulnerability",
	"climate_driver",
] as const;
export type RefFamily = (typeof REF_FAMILIES)[number];

export const REF_QUANTITY_TYPES = ["extensive", "intensive", "index"] as const;
export type RefQuantityType = (typeof REF_QUANTITY_TYPES)[number];

/** TR-076 states stored in ref.value (insufficient_reporting is derived only). */
export const REF_VALUE_STATES = [
	"reported",
	"zero_confirmed",
	"not_reported",
	"not_applicable",
	"suppressed",
] as const;
export type RefValueState = (typeof REF_VALUE_STATES)[number];

export const REF_METHODS = [
	"as_published",
	"zonal_sum",
	"weighted_mean",
	"admin_join",
] as const;
export type RefMethod = (typeof REF_METHODS)[number];

export const REF_GRADES = ["REF-A", "REF-B", "REF-C", "REF-D"] as const;
export type RefGrade = (typeof REF_GRADES)[number];

export const REF_REDISTRIBUTION_RULES = [
	"display_and_redistribute",
	"display_only",
	"signed_in_only",
	"analysis_only",
] as const;
export type RefRedistributionRule = (typeof REF_REDISTRIBUTION_RULES)[number];

/** In precedence order: official national first (R1, R2). */
export const REF_SOURCE_STATUSES = [
	"official_national",
	"international_official",
	"modelled",
] as const;
export type RefSourceStatus = (typeof REF_SOURCE_STATUSES)[number];

/** One value row as the JSON schema defines it. */
export interface ReferenceValueInput {
	indicator_code: string;
	family: RefFamily;
	quantity_type: RefQuantityType;
	unit: string;
	division_key: string;
	boundary_vintage: string;
	period_start: string;
	period_end: string;
	value: number | null;
	value_state: RefValueState;
	lower_bound: number | null;
	upper_bound: number | null;
	method: RefMethod;
	grade: RefGrade;
	source: string;
	release: string;
	licence: string;
	redistribution_rule: RefRedistributionRule;
	source_status: RefSourceStatus;
	rdls_id: string | null;
}

export const REQUIRED_FIELDS = [
	"indicator_code",
	"family",
	"quantity_type",
	"unit",
	"division_key",
	"boundary_vintage",
	"period_start",
	"period_end",
	"value",
	"value_state",
	"method",
	"grade",
	"source",
	"release",
	"licence",
	"redistribution_rule",
	"source_status",
] as const;

const INDICATOR_CODE = /^[A-Z][A-Z0-9_]{2,40}$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isIsoDate(s: string): boolean {
	const m = s.match(ISO_DATE);
	if (!m) return false;
	const d = new Date(`${s}T00:00:00Z`);
	return (
		!Number.isNaN(d.getTime()) &&
		d.getUTCFullYear() === Number(m[1]) &&
		d.getUTCMonth() + 1 === Number(m[2]) &&
		d.getUTCDate() === Number(m[3])
	);
}

function oneOf<T extends string>(list: readonly T[], v: unknown): v is T {
	return typeof v === "string" && (list as readonly string[]).includes(v);
}

/**
 * Parses a numeric cell. An empty cell is null (never 0, R7). Returns
 * undefined when the cell is not a finite number.
 */
export function parseNumberCell(
	raw: string | undefined,
): number | null | undefined {
	if (raw === undefined) return null;
	const t = raw.trim();
	if (t === "") return null;
	const n = Number(t);
	return Number.isFinite(n) ? n : undefined;
}

export type ValidationResult =
	| { ok: true; row: ReferenceValueInput }
	| { ok: false; errors: string[] };

/**
 * Validates one row given as text cells (a CSV row). Applies every rule of
 * delta_reference_value.schema.json, including the conditional rules:
 * null is not zero, zero_confirmed means 0, REF-A only for official national
 * statistics, modelled values only REF-C or REF-D, indices never summed.
 */
export function validateReferenceValueCells(
	cells: Record<string, string | undefined>,
): ValidationResult {
	const errors: string[] = [];
	const text = (k: string) => (cells[k] ?? "").trim();

	for (const f of REQUIRED_FIELDS) {
		// value may be empty: an empty value cell is null.
		if (f === "value") continue;
		if (text(f) === "") errors.push(`${f}: required`);
	}

	const indicator_code = text("indicator_code");
	if (indicator_code && !INDICATOR_CODE.test(indicator_code)) {
		errors.push(`indicator_code: must match ${INDICATOR_CODE.source}`);
	}

	const enumChecks: [string, readonly string[]][] = [
		["family", REF_FAMILIES],
		["quantity_type", REF_QUANTITY_TYPES],
		["value_state", REF_VALUE_STATES],
		["method", REF_METHODS],
		["grade", REF_GRADES],
		["redistribution_rule", REF_REDISTRIBUTION_RULES],
		["source_status", REF_SOURCE_STATUSES],
	];
	for (const [k, list] of enumChecks) {
		const v = text(k);
		if (v && !list.includes(v)) {
			errors.push(`${k}: '${v}' is not one of ${list.join(", ")}`);
		}
	}

	const period_start = text("period_start");
	const period_end = text("period_end");
	if (period_start && !isIsoDate(period_start)) {
		errors.push("period_start: must be a date (YYYY-MM-DD)");
	}
	if (period_end && !isIsoDate(period_end)) {
		errors.push("period_end: must be a date (YYYY-MM-DD)");
	}
	if (
		isIsoDate(period_start) &&
		isIsoDate(period_end) &&
		period_end < period_start
	) {
		errors.push("period_end: must not be before period_start");
	}

	const value = parseNumberCell(cells.value);
	const lower_bound = parseNumberCell(cells.lower_bound);
	const upper_bound = parseNumberCell(cells.upper_bound);
	if (value === undefined) errors.push("value: must be a number or empty");
	if (lower_bound === undefined)
		errors.push("lower_bound: must be a number or empty");
	if (upper_bound === undefined)
		errors.push("upper_bound: must be a number or empty");
	if (
		typeof lower_bound === "number" &&
		typeof upper_bound === "number" &&
		lower_bound > upper_bound
	) {
		errors.push("lower_bound: must not exceed upper_bound");
	}

	const value_state = text("value_state");
	const grade = text("grade");
	const source_status = text("source_status");
	const quantity_type = text("quantity_type");
	const method = text("method");

	if (value !== undefined && oneOf(REF_VALUE_STATES, value_state)) {
		const carriesValue =
			value_state === "reported" || value_state === "zero_confirmed";
		if (carriesValue && value === null) {
			errors.push(`value: required when value_state is ${value_state}`);
		}
		if (!carriesValue && value !== null) {
			errors.push(
				`value: must be empty when value_state is ${value_state} (null is not zero)`,
			);
		}
		if (value_state === "zero_confirmed" && value !== null && value !== 0) {
			errors.push("value: must be 0 when value_state is zero_confirmed");
		}
	}
	if (
		grade === "REF-A" &&
		source_status &&
		source_status !== "official_national"
	) {
		errors.push("grade: REF-A is reserved for official_national sources");
	}
	if (
		source_status === "modelled" &&
		oneOf(REF_GRADES, grade) &&
		grade !== "REF-C" &&
		grade !== "REF-D"
	) {
		errors.push("grade: modelled values take REF-C or REF-D only");
	}
	if (quantity_type === "index" && method === "zonal_sum") {
		errors.push("method: indices are never summed (zonal_sum not allowed)");
	}

	if (errors.length > 0) return { ok: false, errors };

	const rdls = text("rdls_id");
	return {
		ok: true,
		row: {
			indicator_code,
			family: text("family") as RefFamily,
			quantity_type: quantity_type as RefQuantityType,
			unit: text("unit"),
			division_key: text("division_key"),
			boundary_vintage: text("boundary_vintage"),
			period_start,
			period_end,
			value: value as number | null,
			value_state: value_state as RefValueState,
			lower_bound: lower_bound as number | null,
			upper_bound: upper_bound as number | null,
			method: method as RefMethod,
			grade: grade as RefGrade,
			source: text("source"),
			release: text("release"),
			licence: text("licence"),
			redistribution_rule: text("redistribution_rule") as RefRedistributionRule,
			source_status: source_status as RefSourceStatus,
			rdls_id: rdls === "" ? null : rdls,
		},
	};
}
