// E1 (Enrichment Data Integration, sections 4 and 8): the rules for one
// reference value, as in delta_reference_value.schema.json v0.2 (JSON Schema
// 2020-12; expert review amendments DRR-08, GEO-06, GEO-08, CLM-08). The
// loader validates every CSV row with these rules before it writes; the
// ref.value CHECK constraints enforce the row-level rules in the database.
// Pure module: no database access.
//
// Grade scale: REF-A official national statistic; REF-B international
// official estimate (UN WPP, WDI); REF-C modelled grid aggregated to official
// boundaries; REF-D modelled on a coarse grid or interpolated. A value whose
// boundary vintage is unknown is refused here, not graded.

export const REF_FAMILIES = [
	"population",
	"exposure",
	"vulnerability",
	"economic",
	"valuation_baseline",
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
	"weighted_mean_population",
	"weighted_mean_area",
	"areal_interpolation",
	"raked_to_official",
	"admin_join",
] as const;
export type RefMethod = (typeof REF_METHODS)[number];

/** Indices are never summed or interpolated: published or joined only. */
export const REF_INDEX_METHODS: readonly RefMethod[] = [
	"as_published",
	"admin_join",
];

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

export const REF_KEY_SCHEMES = [
	"national_id",
	"pcode",
	"iso3166_2",
	"iso3",
	"global",
] as const;
export type RefKeyScheme = (typeof REF_KEY_SCHEMES)[number];

export const REF_INTERVAL_TYPES = [
	"ci90",
	"ci95",
	"min_max",
	"model_range",
] as const;
export type RefIntervalType = (typeof REF_INTERVAL_TYPES)[number];

export const REF_PRICE_BASES = ["current", "constant"] as const;
export type RefPriceBasis = (typeof REF_PRICE_BASES)[number];

/** Boundary vintages that mean "unknown": refused, never graded. */
export const UNKNOWN_VINTAGES = ["unknown", "n/a", "na", "none", "?"];

/** One value row as the JSON schema defines it. */
export interface ReferenceValueInput {
	indicator_code: string;
	family: RefFamily;
	quantity_type: RefQuantityType;
	unit: string;
	division_key: string;
	key_scheme: RefKeyScheme;
	key_valid_from: string | null;
	key_valid_to: string | null;
	boundary_vintage: string;
	period_start: string;
	period_end: string;
	value: number | null;
	value_state: RefValueState;
	lower_bound: number | null;
	upper_bound: number | null;
	interval_type: RefIntervalType | null;
	currency: string | null;
	price_basis: RefPriceBasis | null;
	base_year: number | null;
	unit_mult: number | null;
	index_version: string | null;
	phase_category: string | null;
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
	"key_scheme",
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
const CURRENCY = /^[A-Z]{3}$/;
const MONEY_UNIT = /^[A-Z]{3}/;

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
 * delta_reference_value.schema.json v0.2, including the conditional rules:
 * null is not zero, zero_confirmed means 0, REF-A only for official national
 * statistics, modelled values only REF-C or REF-D, indices only as published
 * or joined, lower_bound <= value <= upper_bound, money values state currency
 * and price basis, climate drivers state the index version; and refuses an
 * unknown boundary vintage.
 */
export function validateReferenceValueCells(
	cells: Record<string, string | undefined>,
): ValidationResult {
	const errors: string[] = [];
	const text = (k: string) => (cells[k] ?? "").trim();
	const optText = (k: string) => (text(k) === "" ? null : text(k));

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
		["key_scheme", REF_KEY_SCHEMES],
		["value_state", REF_VALUE_STATES],
		["method", REF_METHODS],
		["grade", REF_GRADES],
		["redistribution_rule", REF_REDISTRIBUTION_RULES],
		["source_status", REF_SOURCE_STATUSES],
		["interval_type", REF_INTERVAL_TYPES],
		["price_basis", REF_PRICE_BASES],
	];
	for (const [k, list] of enumChecks) {
		const v = text(k);
		if (v && !list.includes(v)) {
			errors.push(`${k}: '${v}' is not one of ${list.join(", ")}`);
		}
	}

	const boundary_vintage = text("boundary_vintage");
	if (
		boundary_vintage &&
		UNKNOWN_VINTAGES.includes(boundary_vintage.toLowerCase())
	) {
		errors.push(
			"boundary_vintage: unknown vintage; the value is refused, not graded",
		);
	}

	for (const k of [
		"period_start",
		"period_end",
		"key_valid_from",
		"key_valid_to",
	]) {
		const v = text(k);
		if (v && !isIsoDate(v)) errors.push(`${k}: must be a date (YYYY-MM-DD)`);
	}
	const period_start = text("period_start");
	const period_end = text("period_end");
	if (
		isIsoDate(period_start) &&
		isIsoDate(period_end) &&
		period_end < period_start
	) {
		errors.push("period_end: must not be before period_start");
	}
	const key_valid_from = optText("key_valid_from");
	const key_valid_to = optText("key_valid_to");
	if (
		key_valid_from &&
		key_valid_to &&
		isIsoDate(key_valid_from) &&
		isIsoDate(key_valid_to) &&
		key_valid_to < key_valid_from
	) {
		errors.push("key_valid_to: must not be before key_valid_from");
	}

	const value = parseNumberCell(cells.value);
	const lower_bound = parseNumberCell(cells.lower_bound);
	const upper_bound = parseNumberCell(cells.upper_bound);
	const base_year = parseNumberCell(cells.base_year);
	const unit_mult = parseNumberCell(cells.unit_mult);
	if (value === undefined) errors.push("value: must be a number or empty");
	if (lower_bound === undefined)
		errors.push("lower_bound: must be a number or empty");
	if (upper_bound === undefined)
		errors.push("upper_bound: must be a number or empty");
	for (const [k, n] of [
		["base_year", base_year],
		["unit_mult", unit_mult],
	] as const) {
		if (n === undefined || (n !== null && !Number.isInteger(n))) {
			errors.push(`${k}: must be an integer or empty`);
		}
	}
	if (
		typeof lower_bound === "number" &&
		typeof upper_bound === "number" &&
		lower_bound > upper_bound
	) {
		errors.push("lower_bound: must not exceed upper_bound");
	}
	if (typeof value === "number") {
		if (typeof lower_bound === "number" && lower_bound > value) {
			errors.push("lower_bound: must not exceed value");
		}
		if (typeof upper_bound === "number" && value > upper_bound) {
			errors.push("upper_bound: must not be below value");
		}
	}

	const currency = optText("currency");
	if (currency && !CURRENCY.test(currency)) {
		errors.push("currency: must be an ISO 4217 code (three capitals)");
	}

	const family = text("family");
	const unit = text("unit");
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
	if (
		quantity_type === "index" &&
		oneOf(REF_METHODS, method) &&
		!REF_INDEX_METHODS.includes(method)
	) {
		errors.push(
			"method: indices are never summed or interpolated (as_published or admin_join only)",
		);
	}
	if (
		(family === "economic" || family === "valuation_baseline") &&
		MONEY_UNIT.test(unit)
	) {
		if (!currency) errors.push("currency: required for a money value");
		if (!optText("price_basis"))
			errors.push("price_basis: required for a money value");
	}
	if (family === "climate_driver" && !optText("index_version")) {
		errors.push("index_version: required for a climate driver value");
	}

	if (errors.length > 0) return { ok: false, errors };

	return {
		ok: true,
		row: {
			indicator_code,
			family: family as RefFamily,
			quantity_type: quantity_type as RefQuantityType,
			unit,
			division_key: text("division_key"),
			key_scheme: text("key_scheme") as RefKeyScheme,
			key_valid_from,
			key_valid_to,
			boundary_vintage,
			period_start,
			period_end,
			value: value as number | null,
			value_state: value_state as RefValueState,
			lower_bound: lower_bound as number | null,
			upper_bound: upper_bound as number | null,
			interval_type: optText("interval_type") as RefIntervalType | null,
			currency,
			price_basis: optText("price_basis") as RefPriceBasis | null,
			base_year: base_year as number | null,
			unit_mult: unit_mult as number | null,
			index_version: optText("index_version"),
			phase_category: optText("phase_category"),
			method: method as RefMethod,
			grade: grade as RefGrade,
			source: text("source"),
			release: text("release"),
			licence: text("licence"),
			redistribution_rule: text("redistribution_rule") as RefRedistributionRule,
			source_status: source_status as RefSourceStatus,
			rdls_id: optText("rdls_id"),
		},
	};
}
