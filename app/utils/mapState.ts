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
 * V-5 is approved provisionally (pack decision 8): no public view shows an
 * aggregate zero_confirmed until V-5 is final. Set to true when it is.
 */
export const V5_FINAL = false;

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
 * V-3 and V-4 (brand and dark mode) are settled.
 */
export const FAMILY_RAMPS: Record<MeasureFamily, readonly string[]> = {
	people: ["#dbe7f3", "#a9c8e4", "#6fa4d0", "#3d7cb4", "#1d548f"],
	housing: ["#fdd0a2", "#fdae6b", "#fd8d3c", "#e6550d", "#a63603"],
	money: ["#c7e9c0", "#a1d99b", "#74c476", "#31a354", "#006d2c"],
	events: ["#dadaeb", "#bcbddc", "#9e9ac8", "#756bb1", "#54278f"],
};

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
}

/**
 * How each off-ramp state is drawn. No two states differ by lightness alone
 * (E2 rule 8; Geoportal Build Spec s6): each pair differs by outline dash,
 * pattern or hue. The first two keep the existing MapChart encoding.
 */
export const STATE_ENCODING: Record<
	Exclude<MapAreaState, "shaded">,
	StateEncoding
> = {
	zero_confirmed: {
		fill: "#ffffff",
		stroke: "#4b5563",
		dashArray: "4 3",
		strokeWidth: 1.2,
		pattern: "none",
		label: "Zero, confirmed",
	},
	not_reported: {
		fill: "#c9ced6",
		stroke: "#8a929c",
		dashArray: null,
		strokeWidth: 1,
		pattern: "none",
		label: "No data",
	},
	insufficient_reporting: {
		fill: "#ffffff",
		stroke: "#6b7280",
		dashArray: "1 3",
		strokeWidth: 1.2,
		pattern: "hatch",
		label: "Too few records confirm zero",
	},
	not_applicable: {
		fill: "#f3f4f6",
		stroke: "#6b7280",
		dashArray: "8 3 1 3",
		strokeWidth: 1,
		pattern: "dots",
		label: "Not applicable",
	},
	suppressed: {
		fill: "#e5e7eb",
		stroke: "#374151",
		dashArray: null,
		strokeWidth: 2,
		pattern: "crosshatch",
		label: "Withheld",
	},
};

/** Outline for an area whose figure includes a flagged record (C30). */
export const PLAUSIBILITY_MARKER = {
	stroke: "#b45309",
	strokeWidth: 2.5,
	label: "Includes records flagged for review",
} as const;

// ---------------------------------------------------------------------------
// Input.

export type AttGrade = "A" | "B" | "C" | "D";

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

export interface ResolveMapOptions {
	family: MeasureFamily;
	scope: MapScopeQuery;
	/** meta.notApplied: filters the endpoint named as not applied. */
	notApplied?: readonly (string | NotAppliedInput)[];
	/** Filters active in the query, and those this measure applied. */
	activeFilters?: readonly string[];
	appliedFilters?: readonly string[];
}

// ---------------------------------------------------------------------------
// Output.

export type MapStateReason =
	/** reported with no usable value (grading standard OP-21 sum_missing). */
	| "reported_without_value"
	/** a negative total is excluded (grading standard OP-21). */
	| "negative_value"
	/** zero_confirmed that fails the V-5 coverage rule (C11). */
	| "coverage_below_v5"
	/** zero_confirmed withheld from a public view until V-5 is final. */
	| "zero_withheld_until_v5"
	/** insufficient_reporting as supplied by the envelope. */
	| "too_few_confirm_zero";

export interface PlausibilityMarker {
	flaggedRecords: number;
	/** Q2 component letter; null when the flagged contribution is unknown. */
	q2: AttGrade | null;
}

export interface MapQualityMarker {
	/** Set when the figure includes a flagged record (C30). */
	plausibility: PlausibilityMarker | null;
	/** The figure may include provisional records (C23). */
	provisional: boolean;
}

export interface MapTooltipParts {
	value: number | null;
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
	quality: MapQualityMarker;
	tooltip: MapTooltipParts;
}

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
	/** classes: graded; single_tone: E2 rule 5; empty: no area shaded. */
	mode: "classes" | "single_tone" | "empty";
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

function baseState(
	cell: MapCell,
	audience: ApprovalAudience,
): { state: MapAreaState; reason: MapStateReason | null } {
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
			if (!V5_FINAL && audience === "public") {
				return {
					state: "insufficient_reporting",
					reason: "zero_withheld_until_v5",
				};
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

/** Q2 letter from the flagged contribution f and the figure value V. */
export function q2Grade(
	flaggedContribution: number | null | undefined,
	value: number | null,
): AttGrade | null {
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
	if (provisional) parts.push("Provisional, not for citation");
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

export function resolveMapState(
	cells: readonly MapCell[],
	options: ResolveMapOptions,
): MapStateResult {
	const scope = scopeLabel(options.scope);
	const ramp = FAMILY_RAMPS[options.family];

	const resolved = cells.map((cell) => ({
		cell,
		...baseState(cell, options.scope.audience),
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

	const counts = Object.fromEntries(
		MAP_AREA_STATES.map((s) => [s, 0]),
	) as Record<MapAreaState, number>;

	const areas: MapArea[] = resolved.map(({ cell, state, reason }) => {
		counts[state]++;
		let classIndex: number | null = null;
		let color: string | null = null;
		if (state === "shaded") {
			if (mode === "classes") {
				classIndex = classOf(cell.value as number, breaks);
				color = ramp[rampIndex(classIndex, classCount)];
			} else {
				color = singleToneColor;
			}
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
