// Map-state resolver (E2 section 7; solution pack C11, C23, C30). Takes the
// choropleth envelope, one cell per area, and returns what each area shows,
// the legend, the not-applied strips and the scope label. The analytics maps
// (MapChart) and the geoportal (OpenLayers) both render from this result, so
// the two surfaces cannot disagree about an area. Rendering stays with each
// surface; STATE_ENCODING names the shared encoding.
//
// Pure module: no DOM and no database access, safe for server and client.
// It never turns a null value into 0 (TR-076).

import type { ValueState } from "~/utils/valueState";
import { PROVISIONAL_ZERO_COVERAGE } from "~/utils/valueState";
import {
	type ApprovalAudience,
	basisIncludesProvisional,
	basisStatuses,
} from "~/utils/approvalBasis";
import { dataTokens } from "~/utils/designTokens.generated";

// ---------------------------------------------------------------------------
// Thresholds. Each names its source; PROVISIONAL marks a value no ruling sets.

/** Five quantile classes (Analytics plan V-1; Geoportal Build Spec s6). */
export const MAP_CLASS_COUNT = 5;

/**
 * PROVISIONAL. E2 rule 5 says "when too few areas report, use a single
 * tone" and sets no number. The E3 prototype (s3.5) needs one value per
 * class; with V-1's five classes that is five areas.
 */
export const MIN_AREAS_FOR_CLASSES = MAP_CLASS_COUNT;

/**
 * PROVISIONAL. Ramp step used for the single tone. The E3 prototype uses its
 * fourth ramp step (`#3d7cb4`, s3.5); index 3 keeps that colour on the people
 * ramp.
 */
export const SINGLE_TONE_CLASS = 3;

/**
 * PROPOSED (grading standard Q2, SF-4, OP-25). With f the flagged
 * contribution and V the figure value: B if 20 x f < V, C if 4 x f < V,
 * otherwise D.
 */
export const Q2_B_FACTOR = 20;
export const Q2_C_FACTOR = 4;

// ---------------------------------------------------------------------------
// Families and ramps (V-2: one sequential ramp per measure family).

export const MEASURE_FAMILIES = [
	"people",
	"housing",
	"money",
	"events",
] as const;
export type MeasureFamily = (typeof MEASURE_FAMILIES)[number];

/**
 * Five-step ramps, light to dark. People follows the E3 prototype blues
 * (s3.4, darkest step dropped for five classes). Housing, money and the
 * PROVISIONAL events family (V-2 names people, housing and money only) use
 * ColorBrewer sequential ramps without their near-white step, so the lightest
 * class is never read as a confirmed zero. Colours are PROVISIONAL until
 * V-3 and V-4 (brand and dark mode) are settled. Values come from the data
 * token layer (TR-250, ADR-19): edit design-tokens/data/data.json, then run
 * yarn build:tokens.
 */
export const FAMILY_RAMPS: Record<MeasureFamily, readonly string[]> =
	dataTokens.ramp;

// ---------------------------------------------------------------------------
// States and their shared encoding.

export const MAP_AREA_STATES = [
	"shaded",
	"zero_confirmed",
	"insufficient_reporting",
	"not_reported",
	"not_applicable",
	"suppressed",
] as const;
export type MapAreaState = (typeof MAP_AREA_STATES)[number];

/** States drawn outside the ramp, in legend order. */
export const OFF_RAMP_STATES: readonly Exclude<MapAreaState, "shaded">[] = [
	"zero_confirmed",
	"insufficient_reporting",
	"not_reported",
	"not_applicable",
	"suppressed",
];

export type MapPattern = "none" | "hatch" | "dots" | "crosshatch";

export interface StateEncoding {
	fill: string;
	stroke: string;
	/** SVG stroke-dasharray, or null for a solid outline. */
	dashArray: string | null;
	strokeWidth: number;
	/** Pattern drawn over the fill, in `stroke` colour. */
	pattern: MapPattern;
	label: string;
	/** Why the state applies, for the tooltip; null when the label says it. */
	detail: string | null;
}

const MAP_PATTERNS: readonly MapPattern[] = [
	"none",
	"hatch",
	"dots",
	"crosshatch",
];

/** Drawing values for a state from the data token layer; labels stay here. */
function stateFromTokens(
	key: keyof typeof dataTokens.state,
	label: string,
	detail: string | null,
): StateEncoding {
	const t = dataTokens.state[key];
	if (!MAP_PATTERNS.includes(t.pattern as MapPattern)) {
		throw new Error(`Unknown map pattern in data tokens: ${key}.pattern`);
	}
	return {
		fill: t.fill,
		stroke: t.stroke,
		// The tokens write a solid outline as "none"; SVG takes null here.
		dashArray: t.dash === "none" ? null : t.dash,
		strokeWidth: t.strokeWidth,
		pattern: t.pattern as MapPattern,
		label,
		detail,
	};
}

/**
 * How each off-ramp state is drawn. No two states differ by lightness alone
 * (E2 rule 8; Geoportal Build Spec s6): each pair differs by outline dash,
 * pattern or hue. The first two keep the existing MapChart encoding. Colours,
 * widths, dashes and patterns come from the data token layer (TR-250).
 */
export const STATE_ENCODING: Record<
	Exclude<MapAreaState, "shaded">,
	StateEncoding
> = {
	zero_confirmed: stateFromTokens("zeroConfirmed", "Zero, confirmed", null),
	not_reported: stateFromTokens("notReported", "No data", null),
	// PD-04:619: an aggregate that rests on fewer distinct events, or less
	// reporting, than the set minimum. The legend names the state; the
	// tooltip gives the reason (W-03).
	insufficient_reporting: stateFromTokens(
		"insufficientReporting",
		"Insufficient reporting",
		"Rests on too little reporting",
	),
	not_applicable: stateFromTokens("notApplicable", "Not applicable", null),
	suppressed: stateFromTokens("suppressed", "Suppressed", null),
};

/** Outline for an area whose figure includes a flagged record (C30). */
export const PLAUSIBILITY_MARKER = {
	stroke: dataTokens.map.plausibilityMarker.stroke,
	strokeWidth: dataTokens.map.plausibilityMarker.strokeWidth,
	label: "Includes disaster impacts flagged for review",
} as const;

// ---------------------------------------------------------------------------
// Input.

export type AttGrade = "A" | "B" | "C" | "D";

/**
 * Letter of a figure quality component, such as the Q2 plausibility letter.
 * PROPOSED: the Q grade comes from the grading standard and is not in PD
 * v1.0, which grades attribution (ATT, PD-08:84), reference (REF,
 * PD-08:147) and method (TR-071) only. Kept apart from AttGrade so a
 * quality letter is never read as an attribution grade. Lane-internal: no
 * Q letter appears on a public or official view until Alex rules (W-04).
 */
export type QualityGrade = "A" | "B" | "C" | "D";

/** One area of the choropleth envelope. */
export interface MapCell {
	areaId: string;
	value: number | null;
	valueState: ValueState;
	recordsReported: number;
	recordsZeroConfirmed: number;
	/** All records in scope for the area, whatever their state. */
	recordsTotal: number;
	/** Records with a plausibility flag on this measure (C30). */
	recordsFlagged?: number;
	/** Summed contribution of flagged records (grading standard Q2 f). */
	flaggedContribution?: number | null;
	/** Records also counted in another area: area figures are not additive. */
	sharedRecords?: number;
	/** ATT grade distribution, records per grade. */
	gradeDistribution?: Partial<Record<AttGrade, number>> | null;
	/** GEO precision, for example "GEO-L1 (ceiling L1, 47 units)". */
	geoPrecision?: string | null;
	/**
	 * Bars mode: the parts of a breakdown, for example houses destroyed and
	 * damaged. Each keeps its own value state; parts are never added.
	 */
	parts?: MapCellPart[];
}

export interface MapCellPart {
	key: string;
	label: string;
	value: number | null;
	valueState: ValueState;
	recordsFlagged?: number;
}

/** The query behind the envelope (delta.query/1); never UI state (E2 rule 1). */
export interface MapScopeQuery {
	tenant: string | null;
	fromDate?: string | null;
	toDate?: string | null;
	/** Label of the most specific hazard filter applied, or null for all. */
	hazard?: string | null;
	audience: ApprovalAudience;
	/** meta.provisional from the envelope: a contributing record is provisional. */
	provisional?: boolean;
}

export interface NotAppliedInput {
	filter: string;
	reason?: string | null;
}

/**
 * How shaded areas are drawn (ruling RV-5, amended by Alex 2026-10-17):
 * counts as bubbles sized by area with a coverage ring (preview option A),
 * breakdowns as rounded bars (option B), densities and rates as a
 * choropleth. Spikes are removed. Bubbles over density shading (option D)
 * wait for a density measure (ST_Area per division).
 */
export type MapSymbol = "bubble" | "bars" | "choropleth";
export type MeasureKind = "count" | "density" | "rate";

/** Default symbol: bubbles for counts, a choropleth for densities and rates. */
export function defaultSymbolFor(kind: MeasureKind): MapSymbol {
	return kind === "count" ? "bubble" : "choropleth";
}

/** Radius of a bubble at the top of the scale. PROVISIONAL: no ruling sets it. */
export const BUBBLE_MAX_RADIUS_PX = 30;
/** Smallest drawn bubble for a reported value, so it never reads as "no data". PROVISIONAL. */
export const BUBBLE_MIN_RADIUS_PX = 3;
/**
 * When the largest value is more than this many times the next largest,
 * the scale is set by the next largest and the largest is drawn at the cap
 * with its value in the legend (map symbol research, section 5). PROVISIONAL.
 */
export const OUTLIER_FACTOR = 5;

/** Drawn radius: area proportional to value (true area), never below the floor. */
export function bubbleRadiusPx(
	areaRatio: number,
	maxRadius: number = BUBBLE_MAX_RADIUS_PX,
): number {
	return Math.max(
		Math.sqrt(Math.min(Math.max(areaRatio, 0), 1)) * maxRadius,
		BUBBLE_MIN_RADIUS_PX,
	);
}

/** Length of the longest rounded bar. PROVISIONAL. */
export const BAR_MAX_LENGTH_PX = 40;
/** Smallest drawn bar for a reported value above 0. PROVISIONAL. */
export const BAR_MIN_LENGTH_PX = 2;
/** Thickness of a rounded bar. PROVISIONAL. */
export const BAR_WIDTH_PX = 7;

/** Drawn bar length: linear (a bar encodes by length), never below the minimum. */
export function barLengthPx(
	ratio: number,
	maxLength: number = BAR_MAX_LENGTH_PX,
): number {
	return Math.max(Math.min(ratio, 1) * maxLength, BAR_MIN_LENGTH_PX);
}

/** Base fill of a reported area under a symbol: the canvas, so the symbol carries the value. */
export const SYMBOL_BASE_FILL = dataTokens.map.canvas.background;

export interface ResolveMapOptions {
	family: MeasureFamily;
	/**
	 * Five colours, light to dark, in place of the family ramp (a section
	 * palette). Used only when it holds exactly MAP_CLASS_COUNT hex colours;
	 * anything else falls back to the family ramp.
	 */
	ramp?: readonly string[];
	/** Default "choropleth"; callers pass defaultSymbolFor(kind) (RV-5 as amended). */
	symbol?: MapSymbol;
	scope: MapScopeQuery;
	/** meta.notApplied: filters the endpoint named as not applied. */
	notApplied?: readonly (string | NotAppliedInput)[];
	/** Filters active in the query, and those this measure applied. */
	activeFilters?: readonly string[];
	appliedFilters?: readonly string[];
	/**
	 * Bubble or bars mode: shade the areas under the symbols by a second
	 * quantity (option D, Alex 2026-10-17). The shading never shows the same
	 * count as the symbols.
	 */
	underlay?: MapUnderlayOption;
}

/**
 * What the shading under the symbols shows:
 * - density: the measure per 1,000 km² of land area (needs areaKm2);
 * - coverage: the share of records in scope that report the measure,
 *   a confirmed zero included (n of N), as a percentage.
 */
export type MapUnderlayKind = "density" | "coverage";

export interface MapUnderlayOption {
	kind: MapUnderlayKind;
	/** Ramp for the shading; must differ from the symbols' family. */
	family: MeasureFamily;
	/** Density only: land area in km² per area id (divisionAreasKm2). Absent ids get no shading. */
	areaKm2?: ReadonlyMap<string, number>;
}

/** Why an underlay was asked for and not drawn. */
export type UnderlayRefusal =
	| "not_symbol_mode"
	| "same_family_as_symbols"
	| "no_area_data";

// ---------------------------------------------------------------------------
// Output.

export type MapStateReason =
	/** reported with no usable value (grading standard OP-21 sum_missing). */
	| "reported_without_value"
	/** a negative total is excluded (grading standard OP-21). */
	| "negative_value"
	/** zero_confirmed that fails the V-5 coverage rule (C11). */
	| "coverage_below_v5"
	/** insufficient_reporting as supplied by the envelope. */
	| "too_few_confirm_zero";

export interface PlausibilityMarker {
	flaggedRecords: number;
	/** Q2 component letter; null when the flagged contribution is unknown. */
	q2: QualityGrade | null;
}

export interface MapQualityMarker {
	/** Set when the figure includes a flagged record (C30). */
	plausibility: PlausibilityMarker | null;
	/** The figure may include provisional records (C23). */
	provisional: boolean;
}

export interface MapTooltipParts {
	value: number | null;
	/** Why the area is in its off-ramp state; null when the label says it. */
	stateDetail: string | null;
	/** Records that reported the measure (a value or a confirmed zero) of all in scope. */
	reportedBy: { n: number; of: number };
	zeroConfirmedBy: { n: number; of: number };
	sharedRecords: number;
	flaggedRecords: number;
	precision: string | null;
	/** ATT grades with at least one record, A to D. */
	gradeDistribution: { grade: AttGrade; records: number }[] | null;
}

export interface MapArea {
	areaId: string;
	state: MapAreaState;
	/** The envelope value as given; never coerced. */
	value: number | null;
	/** Ramp class for a graded shaded area; null otherwise. */
	classIndex: number | null;
	/** True for a shaded area drawn in the single tone. */
	singleTone: boolean;
	/** Ramp colour for a shaded area; null for off-ramp states. */
	color: string | null;
	reason: MapStateReason | null;
	/**
	 * Bubble or bars mode: the symbol drawn on the area's anchor point. Null
	 * for every off-ramp state, so a missing figure never reads as a small
	 * symbol (TR-076).
	 */
	symbol: MapAreaSymbol | null;
	/** Underlay value under the symbol (density or coverage); null when not drawn. */
	underlay: { value: number; classIndex: number } | null;
	quality: MapQualityMarker;
	tooltip: MapTooltipParts;
}

export type MapAreaSymbol =
	| {
			kind: "bubble";
			/** value / scaleMax, capped at 1; an outlier is drawn at the cap. */
			areaRatio: number;
			outlier: boolean;
			/** Records reporting the measure (a confirmed zero included), n of N. */
			ring: { n: number; of: number };
	  }
	| {
			kind: "bars";
			bars: {
				key: string;
				label: string;
				valueState: ValueState;
				value: number | null;
				/** Share of the largest reported part in scope; null when not drawn. */
				ratio: number | null;
				flagged: boolean;
			}[];
	  };

export interface LegendClass {
	index: number;
	/** Smallest value in the class. */
	lower: number;
	/** Largest value in the class (inclusive upper bound). */
	upper: number;
	color: string;
	areas: number;
}

export type SingleToneReason = "too_few_areas" | "one_distinct_value";

export interface MapLegend {
	family: MeasureFamily;
	ramp: readonly string[];
	method: "quantile";
	/** classes: graded; single_tone: E2 rule 5; empty: no area shaded; bubbles and bars: RV-5 as amended. */
	mode: "classes" | "single_tone" | "empty" | "bubbles" | "bars";
	symbol: MapSymbol;
	/** Option D: the shading under the symbols and its classes. */
	underlay: MapLegendUnderlay | null;
	/** An underlay was asked for and not drawn, and why. */
	underlayRefused: UnderlayRefusal | null;
	/** Bubble or bars mode: colour, scale and reference sizes for the legend. */
	symbols: {
		kind: "bubble" | "bars";
		color: string;
		/** The value drawn at full size. */
		scaleMax: number;
		/** Bubbles: value and area ratio; bars: value and length ratio. */
		references: { value: number; ratio: number }[];
		/** Areas above the scale, drawn at the cap (bubbles only). */
		outliers: { areaId: string; value: number; flagged: boolean }[];
		/** The largest symbol includes figures flagged for review (C30). */
		maxFlagged: boolean;
		/** Bars: the parts, in drawing order. */
		parts: { key: string; label: string }[];
	} | null;
	/** Classes actually used after tied breaks are merged (E3 s7.2, M9). */
	classes: LegendClass[];
	singleTone: {
		color: string;
		reason: SingleToneReason;
		areasShaded: number;
		minimum: number;
	} | null;
	/** Off-ramp states present on the map, in legend order. */
	states: { state: Exclude<MapAreaState, "shaded">; areas: number }[];
	flaggedAreas: number;
	provisional: boolean;
}

export interface NotAppliedStrip {
	filter: string;
	reason: string | null;
	text: string;
}

export interface ScopeLabel {
	tenant: string | null;
	period: string;
	hazard: string;
	approvalBasis: readonly string[];
	provisional: boolean;
	text: string;
}

export interface MapLegendUnderlay {
	kind: MapUnderlayKind;
	family: MeasureFamily;
	/** "per 1,000 km² of land area" or "% of records reporting". */
	unit: string;
	/** Quantile classes, or one class in the single tone when too few areas. */
	classes: LegendClass[];
	/** Shaded areas with a symbol but no underlay value (no area recorded). */
	areasWithout: number;
}

export interface MapStateResult {
	areas: MapArea[];
	legend: MapLegend;
	notApplied: NotAppliedStrip[];
	scope: ScopeLabel;
	counts: Record<MapAreaState, number>;
}

// ---------------------------------------------------------------------------
// Resolver.

function count(n: number | null | undefined): number {
	return typeof n === "number" && Number.isFinite(n) && n > 0
		? Math.floor(n)
		: 0;
}

/** True when a zero_confirmed aggregate meets the V-5 rule (C11). */
function meetsZeroCoverage(cell: MapCell): boolean {
	const zc = count(cell.recordsZeroConfirmed);
	const total = Math.max(count(cell.recordsTotal), zc);
	const rule = PROVISIONAL_ZERO_COVERAGE;
	return zc >= rule.minRecords && zc > 0 && zc >= rule.minCoverage * total;
}

function baseState(cell: MapCell): {
	state: MapAreaState;
	reason: MapStateReason | null;
} {
	switch (cell.valueState) {
		case "reported": {
			const v = cell.value;
			if (v === null || typeof v !== "number" || !Number.isFinite(v)) {
				return { state: "not_reported", reason: "reported_without_value" };
			}
			if (v < 0) return { state: "not_reported", reason: "negative_value" };
			return { state: "shaded", reason: null };
		}
		case "zero_confirmed":
			if (!meetsZeroCoverage(cell)) {
				return { state: "insufficient_reporting", reason: "coverage_below_v5" };
			}
			return { state: "zero_confirmed", reason: null };
		case "insufficient_reporting":
			return {
				state: "insufficient_reporting",
				reason: "too_few_confirm_zero",
			};
		case "not_applicable":
			return { state: "not_applicable", reason: null };
		case "suppressed":
			return { state: "suppressed", reason: null };
		default:
			return { state: "not_reported", reason: null };
	}
}

/** Tooltip detail for an off-ramp state (PD-04:619 for insufficient_reporting). */
function stateDetail(
	state: MapAreaState,
	reason: MapStateReason | null,
): string | null {
	if (state === "shaded") return null;
	if (
		state === "insufficient_reporting" &&
		(reason === "coverage_below_v5" || reason === "too_few_confirm_zero")
	) {
		return "Too few records confirm zero";
	}
	return STATE_ENCODING[state].detail;
}

/** Q2 letter from the flagged contribution f and the figure value V. */
export function q2Grade(
	flaggedContribution: number | null | undefined,
	value: number | null,
): QualityGrade | null {
	if (value === null || !(value > 0)) return null;
	if (
		flaggedContribution === null ||
		flaggedContribution === undefined ||
		!Number.isFinite(flaggedContribution)
	)
		return null;
	const f = Math.max(0, flaggedContribution);
	if (f === 0) return "A";
	if (Q2_B_FACTOR * f < value) return "B";
	if (Q2_C_FACTOR * f < value) return "C";
	return "D";
}

/**
 * Upper bounds of the quantile classes over sorted values. The upper bound
 * of class i is the last value of the i-th fifth, so class sizes are as
 * equal as the data allow (E2 s4: equal class sizes). Tied bounds merge, and
 * a bound equal to the maximum is dropped, so no class is empty (E3 s7.2).
 */
export function quantileBreaks(
	sorted: readonly number[],
	classes: number = MAP_CLASS_COUNT,
): number[] {
	const n = sorted.length;
	if (n === 0) return [];
	const max = sorted[n - 1];
	const breaks: number[] = [];
	for (let i = 1; i < classes; i++) {
		const b = sorted[Math.min(n - 1, Math.ceil((n * i) / classes) - 1)];
		if (b >= max) break;
		if (breaks.length === 0 || b > breaks[breaks.length - 1]) breaks.push(b);
	}
	return breaks;
}

function classOf(v: number, breaks: readonly number[]): number {
	for (let i = 0; i < breaks.length; i++) {
		if (v <= breaks[i]) return i;
	}
	return breaks.length;
}

/**
 * Ramp step for a class, spreading fewer classes across the full ramp so the
 * darkest class always uses the darkest step.
 */
export function rampIndex(classIndex: number, classCount: number): number {
	const steps = MAP_CLASS_COUNT;
	if (classCount <= 1) return steps - 1;
	return Math.round((classIndex * (steps - 1)) / (classCount - 1));
}

function formatPeriod(from?: string | null, to?: string | null): string {
	if (from && to) return `${from} to ${to}`;
	if (from) return `from ${from}`;
	if (to) return `to ${to}`;
	return "all dates";
}

/** Scope label built from the query and the approval basis (E2 rule 1, C23). */
export function scopeLabel(scope: MapScopeQuery): ScopeLabel {
	const basis = basisStatuses(scope.audience);
	const provisional =
		basisIncludesProvisional(scope.audience) || scope.provisional === true;
	const period = formatPeriod(scope.fromDate, scope.toDate);
	const hazard = scope.hazard || "all hazards";
	const parts = [
		scope.tenant,
		period,
		`Hazard: ${hazard}`,
		`Basis: ${basis.join(", ")}`,
	].filter((p): p is string => !!p);
	if (provisional) parts.push("Provisional");
	return {
		tenant: scope.tenant,
		period,
		hazard,
		approvalBasis: basis,
		provisional,
		text: parts.join(" · "),
	};
}

/** Filters the measure could not apply, each named once (E2 rule 2). */
export function notAppliedStrips(
	options: Pick<
		ResolveMapOptions,
		"notApplied" | "activeFilters" | "appliedFilters"
	>,
): NotAppliedStrip[] {
	const seen = new Map<string, string | null>();
	for (const item of options.notApplied ?? []) {
		const filter = typeof item === "string" ? item : item.filter;
		const reason = typeof item === "string" ? null : (item.reason ?? null);
		if (filter && !seen.has(filter)) seen.set(filter, reason);
	}
	if (options.activeFilters && options.appliedFilters) {
		const applied = new Set(options.appliedFilters);
		for (const f of options.activeFilters) {
			if (!applied.has(f) && !seen.has(f)) seen.set(f, null);
		}
	}
	return Array.from(seen, ([filter, reason]) => ({
		filter,
		reason,
		text: reason
			? `Filter not applied: ${filter} (${reason})`
			: `Filter not applied: ${filter}`,
	}));
}

const ATT_GRADES: readonly AttGrade[] = ["A", "B", "C", "D"];

function gradeList(
	dist: MapCell["gradeDistribution"],
): MapTooltipParts["gradeDistribution"] {
	if (!dist) return null;
	const list = ATT_GRADES.map((grade) => ({
		grade,
		records: count(dist[grade]),
	})).filter((g) => g.records > 0);
	return list.length ? list : null;
}

/** Rounded legend references: the scale top, then about a half and a tenth. */
function referenceValues(scaleMax: number): number[] {
	if (!(scaleMax > 0)) return [];
	const round = (v: number) => {
		const mag = 10 ** Math.floor(Math.log10(v));
		return Math.max(Math.round(v / mag) * mag, 1);
	};
	return [...new Set([scaleMax, round(scaleMax / 2), round(scaleMax / 10)])]
		.filter((v) => v <= scaleMax)
		.sort((a, b) => b - a);
}

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** The ramp when it is MAP_CLASS_COUNT hex colours, else null. */
export function validRamp(
	ramp: readonly string[] | undefined,
): readonly string[] | null {
	return ramp &&
		ramp.length === MAP_CLASS_COUNT &&
		ramp.every((c) => HEX_COLOR.test(c))
		? ramp
		: null;
}

export function resolveMapState(
	cells: readonly MapCell[],
	options: ResolveMapOptions,
): MapStateResult {
	const scope = scopeLabel(options.scope);
	const ramp = validRamp(options.ramp) ?? FAMILY_RAMPS[options.family];
	const symbol: MapSymbol = options.symbol ?? "choropleth";

	const resolved = cells.map((cell) => ({
		cell,
		...baseState(cell),
	}));

	const shadedValues = resolved
		.filter((r) => r.state === "shaded")
		.map((r) => r.cell.value as number)
		.sort((a, b) => a - b);
	const distinct = new Set(shadedValues).size;

	let mode: MapLegend["mode"] = "classes";
	let singleToneReason: SingleToneReason | null = null;
	if (shadedValues.length === 0) {
		mode = "empty";
	} else if (symbol === "bubble") {
		mode = "bubbles";
	} else if (symbol === "bars") {
		mode = "bars";
	} else if (shadedValues.length < MIN_AREAS_FOR_CLASSES) {
		mode = "single_tone";
		singleToneReason = "too_few_areas";
	} else if (distinct === 1) {
		mode = "single_tone";
		singleToneReason = "one_distinct_value";
	}
	const breaks = mode === "classes" ? quantileBreaks(shadedValues) : [];
	const classCount = breaks.length + 1;
	const singleToneColor = ramp[SINGLE_TONE_CLASS];
	const maxValue = shadedValues.length
		? shadedValues[shadedValues.length - 1]
		: 0;
	const symbolColor = ramp[ramp.length - 1];

	// Bubbles: the outlier rule sets the scale (map symbol research, s5).
	const nextLargest =
		shadedValues.length > 1 ? shadedValues[shadedValues.length - 2] : 0;
	const bubbleScaleMax =
		nextLargest > 0 && maxValue > OUTLIER_FACTOR * nextLargest
			? nextLargest
			: maxValue;

	// Bars: the scale is the largest reported part across the shaded areas.
	const partOrder = new Map<string, string>();
	let barScaleMax = 0;
	if (mode === "bars") {
		for (const r of resolved) {
			if (r.state !== "shaded") continue;
			for (const p of r.cell.parts ?? []) {
				if (!partOrder.has(p.key)) partOrder.set(p.key, p.label);
				if (
					p.valueState === "reported" &&
					p.value !== null &&
					p.value > barScaleMax
				)
					barScaleMax = p.value;
			}
		}
	}

	const counts = Object.fromEntries(
		MAP_AREA_STATES.map((s) => [s, 0]),
	) as Record<MapAreaState, number>;

	// Option D: a second quantity shades the areas under the symbols.
	const underlayAsked = options.underlay ?? null;
	let underlayRefused: UnderlayRefusal | null = null;
	if (underlayAsked) {
		if (mode !== "bubbles" && mode !== "bars" && mode !== "empty")
			underlayRefused = "not_symbol_mode";
		else if (underlayAsked.family === options.family)
			underlayRefused = "same_family_as_symbols";
		else if (underlayAsked.kind === "density" && !underlayAsked.areaKm2?.size)
			underlayRefused = "no_area_data";
	}
	const underlayOn =
		underlayAsked !== null && underlayRefused === null && mode !== "empty";
	const underlayValueOf = (cell: MapCell): number | null => {
		if (!underlayAsked) return null;
		if (underlayAsked.kind === "density") {
			const km2 = underlayAsked.areaKm2?.get(cell.areaId);
			return km2 && km2 > 0 ? ((cell.value as number) / km2) * 1000 : null;
		}
		const n = count(cell.recordsReported) + count(cell.recordsZeroConfirmed);
		const of = Math.max(count(cell.recordsTotal), n);
		return of > 0 ? (n / of) * 100 : null;
	};
	const underlayValues = new Map<string, number>();
	if (underlayOn) {
		for (const r of resolved) {
			if (r.state !== "shaded") continue;
			const v = underlayValueOf(r.cell);
			if (v !== null) underlayValues.set(r.cell.areaId, v);
		}
	}
	const uSorted = [...underlayValues.values()].sort((a, b) => a - b);
	const uGraded =
		uSorted.length >= MIN_AREAS_FOR_CLASSES && new Set(uSorted).size > 1;
	const uBreaks = uGraded ? quantileBreaks(uSorted) : [];
	const uClassCount = uBreaks.length + 1;
	const uRamp = underlayAsked ? FAMILY_RAMPS[underlayAsked.family] : ramp;
	const uColor = (classIndex: number) =>
		uGraded
			? uRamp[rampIndex(classIndex, uClassCount)]
			: uRamp[SINGLE_TONE_CLASS];

	const areas: MapArea[] = resolved.map(({ cell, state, reason }) => {
		counts[state]++;
		let classIndex: number | null = null;
		let color: string | null = null;
		let symbolDrawn: MapArea["symbol"] = null;
		const reportedHere = count(cell.recordsReported);
		const zcHere = count(cell.recordsZeroConfirmed);
		if (state === "shaded") {
			if (mode === "bubbles") {
				color = SYMBOL_BASE_FILL;
				const v = cell.value as number;
				symbolDrawn = {
					kind: "bubble",
					areaRatio: bubbleScaleMax > 0 ? Math.min(v / bubbleScaleMax, 1) : 0,
					outlier: v > bubbleScaleMax,
					ring: {
						n: reportedHere + zcHere,
						of: Math.max(count(cell.recordsTotal), reportedHere + zcHere),
					},
				};
			} else if (mode === "bars") {
				color = SYMBOL_BASE_FILL;
				const parts = cell.parts ?? [];
				symbolDrawn = parts.length
					? {
							kind: "bars",
							bars: parts.map((p) => ({
								key: p.key,
								label: p.label,
								valueState: p.valueState,
								value: p.value,
								ratio:
									p.valueState === "reported" &&
									p.value !== null &&
									barScaleMax > 0
										? p.value / barScaleMax
										: null,
								flagged: count(p.recordsFlagged) > 0,
							})),
						}
					: null;
			} else if (mode === "classes") {
				classIndex = classOf(cell.value as number, breaks);
				color = ramp[rampIndex(classIndex, classCount)];
			} else {
				color = singleToneColor;
			}
		}
		const uv = underlayValues.get(cell.areaId);
		let underlayHere: MapArea["underlay"] = null;
		if (uv !== undefined) {
			const classIndex = uGraded ? classOf(uv, uBreaks) : SINGLE_TONE_CLASS;
			color = uColor(classIndex);
			underlayHere = { value: uv, classIndex };
		}
		const flagged = count(cell.recordsFlagged);
		const reported = count(cell.recordsReported);
		const zc = count(cell.recordsZeroConfirmed);
		const total = Math.max(count(cell.recordsTotal), reported + zc);
		return {
			areaId: cell.areaId,
			state,
			value: cell.value,
			classIndex,
			singleTone: state === "shaded" && mode === "single_tone",
			color,
			reason,
			symbol: symbolDrawn,
			underlay: underlayHere,
			quality: {
				plausibility:
					flagged > 0
						? {
								flaggedRecords: flagged,
								q2: q2Grade(cell.flaggedContribution, cell.value),
							}
						: null,
				provisional: scope.provisional,
			},
			tooltip: {
				value: cell.value,
				stateDetail: stateDetail(state, reason),
				reportedBy: { n: reported + zc, of: total },
				zeroConfirmedBy: { n: zc, of: total },
				sharedRecords: count(cell.sharedRecords),
				flaggedRecords: flagged,
				precision: cell.geoPrecision ?? null,
				gradeDistribution: gradeList(cell.gradeDistribution),
			},
		};
	});

	const classes: LegendClass[] = [];
	if (mode === "classes") {
		for (let i = 0; i < classCount; i++) {
			const inClass = shadedValues.filter((v) => classOf(v, breaks) === i);
			classes.push({
				index: i,
				lower: inClass[0],
				upper: inClass[inClass.length - 1],
				color: ramp[rampIndex(i, classCount)],
				areas: inClass.length,
			});
		}
	}

	return {
		areas,
		legend: {
			family: options.family,
			ramp,
			method: "quantile",
			mode,
			symbol,
			underlay: underlayOn
				? {
						kind: underlayAsked!.kind,
						family: underlayAsked!.family,
						unit:
							underlayAsked!.kind === "density"
								? "per 1,000 km² of land area"
								: "% of records reporting",
						classes: uGraded
							? Array.from({ length: uClassCount }, (_, i) => {
									const inClass = uSorted.filter(
										(v) => classOf(v, uBreaks) === i,
									);
									return {
										index: i,
										lower: inClass[0],
										upper: inClass[inClass.length - 1],
										color: uColor(i),
										areas: inClass.length,
									};
								}).filter((c) => c.areas > 0)
							: uSorted.length
								? [
										{
											index: SINGLE_TONE_CLASS,
											lower: uSorted[0],
											upper: uSorted[uSorted.length - 1],
											color: uColor(SINGLE_TONE_CLASS),
											areas: uSorted.length,
										},
									]
								: [],
						areasWithout: resolved.filter(
							(r) => r.state === "shaded" && !underlayValues.has(r.cell.areaId),
						).length,
					}
				: null,
			underlayRefused,
			symbols:
				mode === "bubbles"
					? {
							kind: "bubble",
							color: symbolColor,
							scaleMax: bubbleScaleMax,
							references: referenceValues(bubbleScaleMax).map((value) => ({
								value,
								ratio: value / bubbleScaleMax,
							})),
							outliers: areas
								.filter((a) => a.symbol?.kind === "bubble" && a.symbol.outlier)
								.map((a) => ({
									areaId: a.areaId,
									value: a.value as number,
									flagged: a.quality.plausibility !== null,
								})),
							maxFlagged: areas.some(
								(a) => a.value === maxValue && a.quality.plausibility !== null,
							),
							parts: [],
						}
					: mode === "bars"
						? {
								kind: "bars",
								color: symbolColor,
								scaleMax: barScaleMax,
								references:
									barScaleMax > 0
										? referenceValues(barScaleMax).map((value) => ({
												value,
												ratio: value / barScaleMax,
											}))
										: [],
								outliers: [],
								maxFlagged: areas.some(
									(a) =>
										a.symbol?.kind === "bars" &&
										a.symbol.bars.some((b) => b.ratio === 1 && b.flagged),
								),
								parts: [...partOrder].map(([key, label]) => ({ key, label })),
							}
						: null,
			classes,
			singleTone:
				mode === "single_tone" && singleToneReason
					? {
							color: singleToneColor,
							reason: singleToneReason,
							areasShaded: shadedValues.length,
							minimum: MIN_AREAS_FOR_CLASSES,
						}
					: null,
			states: OFF_RAMP_STATES.filter((s) => counts[s] > 0).map((s) => ({
				state: s,
				areas: counts[s],
			})),
			flaggedAreas: areas.filter((a) => a.quality.plausibility).length,
			provisional: scope.provisional,
		},
		notApplied: notAppliedStrips(options),
		scope,
		counts,
	};
}

/** One area's parts for the bars layer of a layered map. */
export interface BarsLayerInput {
	areaId: string;
	parts: MapCellPart[];
}

/**
 * Rounded bars over a choropleth (options B and D, Alex 2026-10-17). The
 * areas are shaded by one measure with the full choropleth rules, for
 * example the number of deaths (Sendai A-2); rounded bars of another
 * measure stand on top, for example dwellings damaged and destroyed (inputs
 * to B-3 and B-4). The two layers use different colour families, keep their
 * own value states and are never added. An area draws bars when at least
 * one part is reported, whatever the shading shows.
 */
export function resolveLayeredMapState(
	shadeCells: readonly MapCell[],
	bars: readonly BarsLayerInput[],
	options: Omit<ResolveMapOptions, "symbol" | "underlay"> & {
		barsFamily: MeasureFamily;
	},
): MapStateResult {
	const { barsFamily, ...shadeOptions } = options;
	if (barsFamily === shadeOptions.family) {
		throw new Error(
			"resolveLayeredMapState: the bars and the shading need different colour families",
		);
	}
	const shade = resolveMapState(shadeCells, {
		...shadeOptions,
		symbol: "choropleth",
	});
	// A bar cell carries no value of its own: its state says whether any
	// part is reported, and its value is the largest part, used only to
	// decide that state. Parts are never added.
	const barCells: MapCell[] = bars.map((b) => {
		const reportedParts = b.parts.filter(
			(p) => p.valueState === "reported" && p.value !== null && p.value > 0,
		);
		const anyZero = b.parts.some((p) => p.valueState === "zero_confirmed");
		const valueState: ValueState = reportedParts.length
			? "reported"
			: anyZero
				? "zero_confirmed"
				: "not_reported";
		return {
			areaId: b.areaId,
			value: reportedParts.length
				? Math.max(...reportedParts.map((p) => p.value as number))
				: valueState === "zero_confirmed"
					? 0
					: null,
			valueState,
			recordsReported: reportedParts.length ? 1 : 0,
			recordsZeroConfirmed: !reportedParts.length && anyZero ? 1 : 0,
			recordsTotal: 1,
			parts: b.parts,
		};
	});
	const barsResult = resolveMapState(barCells, {
		family: barsFamily,
		scope: shadeOptions.scope,
		symbol: "bars",
	});
	const barsById = new Map(barsResult.areas.map((a) => [a.areaId, a.symbol]));
	return {
		...shade,
		areas: shade.areas.map((a) => ({
			...a,
			symbol: barsById.get(a.areaId) ?? null,
		})),
		legend: { ...shade.legend, symbols: barsResult.legend.symbols },
	};
}
