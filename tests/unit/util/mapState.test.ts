import { describe, it, expect } from "vitest";
import {
	FAMILY_RAMPS,
	MIN_AREAS_FOR_CLASSES,
	BAR_MAX_LENGTH_PX,
	BAR_MIN_LENGTH_PX,
	BUBBLE_MAX_RADIUS_PX,
	BUBBLE_MIN_RADIUS_PX,
	SYMBOL_BASE_FILL,
	barLengthPx,
	bubbleRadiusPx,
	defaultSymbolFor,
	type MapCell,
	type MapScopeQuery,
	OFF_RAMP_STATES,
	STATE_ENCODING,
	SINGLE_TONE_CLASS,
	notAppliedStrips,
	q2Grade,
	quantileBreaks,
	resolveLayeredMapState,
	resolveMapState,
	scopeLabel,
} from "~/utils/mapState";

// Map-state resolver (E2 section 7, C11, C23, C30): one state per area, the
// legend, the not-applied strips and the scope label.

const signedIn: MapScopeQuery = {
	tenant: "Angola",
	fromDate: "2015-01-01",
	toDate: "2020-12-31",
	hazard: "Flood",
	audience: "signed-in",
};

function reported(areaId: string, value: number, extra: Partial<MapCell> = {}) {
	return {
		areaId,
		value,
		valueState: "reported" as const,
		recordsReported: 1,
		recordsZeroConfirmed: 0,
		recordsTotal: 2,
		...extra,
	};
}

function cell(
	areaId: string,
	valueState: MapCell["valueState"],
	extra: Partial<MapCell> = {},
): MapCell {
	return {
		areaId,
		value: valueState === "zero_confirmed" ? 0 : null,
		valueState,
		recordsReported: 0,
		recordsZeroConfirmed: 0,
		recordsTotal: 4,
		...extra,
	};
}

function resolve(cells: MapCell[], scope: MapScopeQuery = signedIn) {
	return resolveMapState(cells, { family: "people", scope });
}

const byId = (r: ReturnType<typeof resolve>, id: string) =>
	r.areas.find((a) => a.areaId === id)!;

describe("every state", () => {
	const r = resolve([
		reported("r1", 10),
		reported("r2", 20),
		reported("r3", 30),
		reported("r4", 40),
		reported("r5", 50),
		cell("z", "zero_confirmed", { recordsZeroConfirmed: 2, recordsTotal: 4 }),
		cell("n", "not_reported"),
		cell("na", "not_applicable"),
		cell("s", "suppressed"),
		cell("i", "insufficient_reporting", { recordsZeroConfirmed: 1 }),
	]);

	it("shaded: a reported value gets a class and a ramp colour", () => {
		const a = byId(r, "r5");
		expect(a.state).toBe("shaded");
		expect(a.classIndex).toBe(4);
		expect(a.color).toBe(FAMILY_RAMPS.people[4]);
		expect(a.value).toBe(50);
	});

	it("zero_confirmed: meets the V-5 rule, off the ramp", () => {
		const a = byId(r, "z");
		expect(a.state).toBe("zero_confirmed");
		expect(a.classIndex).toBeNull();
		expect(a.color).toBeNull();
	});

	it("not_reported keeps a null value (TR-076)", () => {
		const a = byId(r, "n");
		expect(a.state).toBe("not_reported");
		expect(a.value).toBeNull();
	});

	it("not_applicable, suppressed and insufficient_reporting pass through", () => {
		expect(byId(r, "na").state).toBe("not_applicable");
		expect(byId(r, "s").state).toBe("suppressed");
		expect(byId(r, "i").state).toBe("insufficient_reporting");
		expect(byId(r, "i").reason).toBe("too_few_confirm_zero");
	});

	it("legend lists each off-ramp state present, in order", () => {
		expect(r.legend.states.map((s) => s.state)).toEqual(OFF_RAMP_STATES);
		expect(r.counts.shaded).toBe(5);
	});
});

describe("state guards", () => {
	it("reported with a null value is not_reported, never 0", () => {
		const a = resolve([{ ...reported("x", 0), value: null }]).areas[0];
		expect(a.state).toBe("not_reported");
		expect(a.reason).toBe("reported_without_value");
		expect(a.value).toBeNull();
	});

	it("a negative total is excluded", () => {
		const a = resolve([reported("x", -5)]).areas[0];
		expect(a.state).toBe("not_reported");
		expect(a.reason).toBe("negative_value");
	});

	it("zero_confirmed below 25% coverage becomes insufficient_reporting (C11)", () => {
		const a = resolve([
			cell("z", "zero_confirmed", { recordsZeroConfirmed: 1, recordsTotal: 9 }),
		]).areas[0];
		expect(a.state).toBe("insufficient_reporting");
		expect(a.reason).toBe("coverage_below_v5");
	});

	it("public views show a confirmed zero that meets coverage (TR-260)", () => {
		const a = resolve(
			[
				cell("z", "zero_confirmed", {
					recordsZeroConfirmed: 3,
					recordsTotal: 9,
				}),
			],
			{ ...signedIn, audience: "public" },
		).areas[0];
		expect(a.state).toBe("zero_confirmed");
		expect(a.reason).toBeNull();
	});
});

describe("edge cases", () => {
	it("all areas null: empty legend, no classes, all not_reported", () => {
		const r = resolve([cell("a", "not_reported"), cell("b", "not_reported")]);
		expect(r.legend.mode).toBe("empty");
		expect(r.legend.classes).toEqual([]);
		expect(r.legend.singleTone).toBeNull();
		expect(r.areas.every((a) => a.value === null)).toBe(true);
		expect(r.legend.states).toEqual([{ state: "not_reported", areas: 2 }]);
	});

	it("one area reported: single tone, and the legend says why", () => {
		const r = resolve([reported("a", 7), cell("b", "not_reported")]);
		expect(r.legend.mode).toBe("single_tone");
		expect(r.legend.singleTone).toEqual({
			color: FAMILY_RAMPS.people[SINGLE_TONE_CLASS],
			reason: "too_few_areas",
			areasShaded: 1,
			minimum: MIN_AREAS_FOR_CLASSES,
		});
		const a = byId(r, "a");
		expect(a.singleTone).toBe(true);
		expect(a.classIndex).toBeNull();
		expect(a.color).toBe(FAMILY_RAMPS.people[SINGLE_TONE_CLASS]);
	});

	it("enough areas but one distinct value: single tone", () => {
		const r = resolve(["a", "b", "c", "d", "e"].map((id) => reported(id, 3)));
		expect(r.legend.mode).toBe("single_tone");
		expect(r.legend.singleTone?.reason).toBe("one_distinct_value");
	});

	it("ties at class breaks merge; equal values share a class; no empty class", () => {
		const values = [1, 1, 1, 1, 1, 1, 2, 3, 3, 9];
		const r = resolve(values.map((v, i) => reported(`a${i}`, v)));
		expect(r.legend.mode).toBe("classes");
		const classes = r.legend.classes;
		expect(classes.every((c) => c.areas > 0)).toBe(true);
		expect(classes.reduce((n, c) => n + c.areas, 0)).toBe(values.length);
		const ones = r.areas.filter((a) => a.value === 1).map((a) => a.classIndex);
		expect(new Set(ones).size).toBe(1);
		// breaks strictly increase and stay below the maximum
		const breaks = quantileBreaks([...values].sort((a, b) => a - b));
		expect(breaks).toEqual([1, 3]);
		expect(classes.map((c) => [c.lower, c.upper])).toEqual([
			[1, 1],
			[2, 3],
			[9, 9],
		]);
		// the darkest class keeps the darkest ramp step
		expect(classes[classes.length - 1].color).toBe(FAMILY_RAMPS.people[4]);
	});

	it("five distinct values: five classes of one area each", () => {
		const r = resolve([5, 4, 3, 2, 1].map((v) => reported(`v${v}`, v)));
		expect(r.legend.classes.map((c) => c.areas)).toEqual([1, 1, 1, 1, 1]);
		expect(byId(r, "v1").classIndex).toBe(0);
		expect(byId(r, "v5").classIndex).toBe(4);
	});

	it("insufficient_reporting next to zero_confirmed stay distinct", () => {
		const r = resolve([
			cell("zero", "zero_confirmed", {
				recordsZeroConfirmed: 3,
				recordsTotal: 9,
			}),
			cell("few", "zero_confirmed", {
				recordsZeroConfirmed: 1,
				recordsTotal: 9,
			}),
		]);
		expect(byId(r, "zero").state).toBe("zero_confirmed");
		expect(byId(r, "few").state).toBe("insufficient_reporting");
		// neither carries a class, and the encodings differ by more than lightness
		const z = STATE_ENCODING.zero_confirmed;
		const i = STATE_ENCODING.insufficient_reporting;
		expect(z.pattern !== i.pattern || z.dashArray !== i.dashArray).toBe(true);
		// PD-04:619: the legend names the state, the tooltip gives the reason
		expect(i.label).toBe("Insufficient reporting");
		expect(byId(r, "few").tooltip.stateDetail).toBe(
			"Too few records confirm zero",
		);
		expect(byId(r, "zero").tooltip.stateDetail).toBeNull();
		// a confirmed zero never carries a quality marker for coverage
		expect(byId(r, "zero").quality.plausibility).toBeNull();
	});

	it("a flagged area carries the plausibility marker and a Q2 letter (C30)", () => {
		const r = resolve([
			reported("ago", 4887, {
				recordsReported: 37,
				recordsTotal: 40,
				recordsFlagged: 1,
				flaggedContribution: 1000,
			}),
			reported("clean", 10),
		]);
		const a = byId(r, "ago");
		expect(a.state).toBe("shaded");
		expect(a.value).toBe(4887);
		expect(a.quality.plausibility).toEqual({ flaggedRecords: 1, q2: "C" });
		expect(a.tooltip.flaggedRecords).toBe(1);
		expect(byId(r, "clean").quality.plausibility).toBeNull();
		expect(r.legend.flaggedAreas).toBe(1);
	});

	it("a flagged area without a known contribution keeps the caveat, ungraded", () => {
		const a = resolve([reported("x", 50, { recordsFlagged: 2 })]).areas[0];
		expect(a.quality.plausibility).toEqual({ flaggedRecords: 2, q2: null });
	});
});

describe("state encodings", () => {
	it("no two off-ramp states differ by lightness alone", () => {
		const states = Object.entries(STATE_ENCODING);
		for (let i = 0; i < states.length; i++) {
			for (let j = i + 1; j < states.length; j++) {
				const a = states[i][1];
				const b = states[j][1];
				const differ =
					a.pattern !== b.pattern ||
					a.dashArray !== b.dashArray ||
					a.strokeWidth !== b.strokeWidth;
				expect(differ, `${states[i][0]} vs ${states[j][0]}`).toBe(true);
			}
		}
	});

	it("keeps the MapChart encoding for zero and no data", () => {
		expect(STATE_ENCODING.zero_confirmed.fill).toBe("#ffffff");
		expect(STATE_ENCODING.zero_confirmed.dashArray).toBe("4 3");
		expect(STATE_ENCODING.not_reported.fill).toBe("#c9ced6");
	});

	it("each family has a five-step ramp", () => {
		for (const ramp of Object.values(FAMILY_RAMPS)) {
			expect(ramp).toHaveLength(5);
		}
	});
});

describe("tooltip parts", () => {
	it("reported by n of N counts values and confirmed zeros", () => {
		const a = resolve([
			reported("x", 12, {
				recordsReported: 3,
				recordsZeroConfirmed: 1,
				recordsTotal: 10,
				sharedRecords: 2,
				geoPrecision: "GEO-L1 (ceiling L1, 47 units)",
				gradeDistribution: { A: 0, C: 3, B: 1 },
			}),
		]).areas[0];
		expect(a.tooltip.reportedBy).toEqual({ n: 4, of: 10 });
		expect(a.tooltip.zeroConfirmedBy).toEqual({ n: 1, of: 10 });
		expect(a.tooltip.sharedRecords).toBe(2);
		expect(a.tooltip.precision).toBe("GEO-L1 (ceiling L1, 47 units)");
		expect(a.tooltip.gradeDistribution).toEqual([
			{ grade: "B", records: 1 },
			{ grade: "C", records: 3 },
		]);
	});
});

describe("scope label and not-applied strips", () => {
	it("builds the label from the query and the approval basis (C23)", () => {
		const s = scopeLabel(signedIn);
		expect(s.approvalBasis).toEqual(["published"]);
		expect(s.provisional).toBe(false);
		expect(s.text).toBe(
			"Angola · 2015-01-01 to 2020-12-31 · Hazard: Flood · Basis: published",
		);
	});

	it("marks the label provisional when the envelope says so", () => {
		const s = scopeLabel({
			tenant: null,
			audience: "public",
			provisional: true,
		});
		expect(s.provisional).toBe(true);
		expect(s.text).toBe(
			"all dates · Hazard: all hazards · Basis: published · Provisional",
		);
		const r = resolveMapState([reported("x", 1)], {
			family: "money",
			scope: { tenant: null, audience: "public", provisional: true },
		});
		expect(r.areas[0].quality.provisional).toBe(true);
		expect(r.legend.provisional).toBe(true);
	});

	it("names each filter not applied once, from meta and from the query", () => {
		const strips = notAppliedStrips({
			notApplied: [{ filter: "hazard", reason: "modelled events" }, "hazard"],
			activeFilters: ["hazard", "period", "division"],
			appliedFilters: ["period"],
		});
		expect(strips).toEqual([
			{
				filter: "hazard",
				reason: "modelled events",
				text: "Filter not applied: hazard (modelled events)",
			},
			{
				filter: "division",
				reason: null,
				text: "Filter not applied: division",
			},
		]);
	});
});

describe("q2Grade (proposed thresholds)", () => {
	it("follows the grading standard integer tests", () => {
		expect(q2Grade(0, 100)).toBe("A");
		expect(q2Grade(4, 100)).toBe("B");
		expect(q2Grade(1000, 4887)).toBe("C");
		expect(q2Grade(6320731, 6850128)).toBe("D");
		expect(q2Grade(5, null)).toBeNull();
		expect(q2Grade(undefined, 100)).toBeNull();
	});
});

describe("bubble mode (RV-5 as amended, preview option A)", () => {
	const bubbles = (cells: MapCell[]) =>
		resolveMapState(cells, {
			family: "people",
			scope: signedIn,
			symbol: "bubble",
		});

	it("defaults counts to bubbles and densities to a choropleth", () => {
		expect(defaultSymbolFor("count")).toBe("bubble");
		expect(defaultSymbolFor("density")).toBe("choropleth");
		expect(defaultSymbolFor("rate")).toBe("choropleth");
	});

	it("keeps the choropleth when no symbol is given", () => {
		const r = resolve([reported("a", 1), reported("b", 2)]);
		expect(r.legend.symbol).toBe("choropleth");
		expect(r.legend.symbols).toBeNull();
		expect(r.areas.every((a) => a.symbol === null)).toBe(true);
	});

	it("sizes bubbles by area against the largest value and rings them with coverage", () => {
		const r = bubbles([
			reported("a", 100),
			reported("b", 25),
			reported("c", 30),
		]);
		expect(r.legend.mode).toBe("bubbles");
		expect(byId(r, "a").symbol).toEqual({
			kind: "bubble",
			areaRatio: 1,
			outlier: false,
			ring: { n: 1, of: 2 },
		});
		const b = byId(r, "b").symbol;
		expect(b?.kind === "bubble" && b.areaRatio).toBe(0.25);
		expect(byId(r, "a").color).toBe(SYMBOL_BASE_FILL);
		expect(byId(r, "a").classIndex).toBeNull();
		expect(r.legend.symbols?.scaleMax).toBe(100);
		expect(r.legend.symbols?.color).toBe(FAMILY_RAMPS.people.at(-1));
		expect(r.legend.symbols?.references[0]).toEqual({ value: 100, ratio: 1 });
	});

	it("draws an outlier at the cap and names it in the legend", () => {
		const r = bubbles([
			reported("big", 1000, { recordsFlagged: 1 }),
			reported("b", 100),
			reported("c", 50),
		]);
		expect(r.legend.symbols?.scaleMax).toBe(100);
		const big = byId(r, "big").symbol;
		expect(big?.kind === "bubble" && [big.areaRatio, big.outlier]).toEqual([
			1,
			true,
		]);
		expect(r.legend.symbols?.outliers).toEqual([
			{ areaId: "big", value: 1000, flagged: true },
		]);
		expect(r.legend.symbols?.maxFlagged).toBe(true);
	});

	it("draws no bubble for off-ramp states, which keep their own encoding", () => {
		const r = bubbles([
			reported("a", 10),
			cell("z", "zero_confirmed", { recordsZeroConfirmed: 2 }),
			cell("n", "not_reported"),
		]);
		expect(byId(r, "z").symbol).toBeNull();
		expect(byId(r, "z").color).toBeNull();
		expect(byId(r, "n").symbol).toBeNull();
	});
});

describe("bars mode (RV-5 as amended, preview option B)", () => {
	const parts = (destroyed: number | null, damaged: number | null) => [
		{
			key: "destroyed",
			label: "Houses destroyed",
			value: destroyed,
			valueState:
				destroyed === null ? ("not_reported" as const) : ("reported" as const),
		},
		{
			key: "damaged",
			label: "Houses damaged",
			value: damaged,
			valueState:
				damaged === null ? ("not_reported" as const) : ("reported" as const),
		},
	];

	it("scales every part to the largest reported part and leaves a missing part empty", () => {
		const r = resolveMapState(
			[
				reported("a", 300, { parts: parts(100, 200) }),
				reported("b", 50, { parts: parts(50, null) }),
				cell("n", "not_reported", { parts: parts(null, null) }),
			],
			{ family: "people", scope: signedIn, symbol: "bars" },
		);
		expect(r.legend.mode).toBe("bars");
		expect(r.legend.symbols?.scaleMax).toBe(200);
		expect(r.legend.symbols?.parts.map((p) => p.key)).toEqual([
			"destroyed",
			"damaged",
		]);
		const b = byId(r, "b").symbol;
		expect(b?.kind === "bars" && b.bars.map((x) => x.ratio)).toEqual([
			0.25,
			null,
		]);
		expect(byId(r, "n").symbol).toBeNull();
	});
});

describe("symbol sizes", () => {
	it("gives bubbles a true-area radius with a floor", () => {
		expect(bubbleRadiusPx(1)).toBe(BUBBLE_MAX_RADIUS_PX);
		expect(bubbleRadiusPx(0.25)).toBe(BUBBLE_MAX_RADIUS_PX / 2);
		expect(bubbleRadiusPx(0.00001)).toBe(BUBBLE_MIN_RADIUS_PX);
		expect(bubbleRadiusPx(4)).toBe(BUBBLE_MAX_RADIUS_PX);
	});

	it("gives bars a linear length with a floor", () => {
		expect(barLengthPx(1)).toBe(BAR_MAX_LENGTH_PX);
		expect(barLengthPx(0.5)).toBe(BAR_MAX_LENGTH_PX / 2);
		expect(barLengthPx(0.00001)).toBe(BAR_MIN_LENGTH_PX);
	});
});

describe("underlay under symbols (option D)", () => {
	const five = [
		reported("a", 100, { recordsReported: 4, recordsTotal: 4 }),
		reported("b", 50, { recordsReported: 1, recordsTotal: 4 }),
		reported("c", 40, { recordsReported: 2, recordsTotal: 4 }),
		reported("d", 30, { recordsReported: 3, recordsTotal: 4 }),
		reported("e", 20, { recordsReported: 2, recordsTotal: 8 }),
		cell("n", "not_reported"),
	];
	const km2 = new Map([
		["a", 1000],
		["b", 100],
		["c", 400],
		["d", 300],
		["e", 2000],
	]);

	it("shades by density per 1,000 km² under the bubbles and keeps the bubble sizes", () => {
		const r = resolveMapState(five, {
			family: "housing",
			scope: signedIn,
			symbol: "bubble",
			underlay: { kind: "density", family: "people", areaKm2: km2 },
		});
		expect(r.legend.underlayRefused).toBeNull();
		expect(byId(r, "b").underlay?.value).toBe(500);
		expect(byId(r, "a").underlay?.value).toBe(100);
		const bClass = r.legend.underlay?.classes.find(
			(c) => c.index === byId(r, "b").underlay!.classIndex,
		);
		expect(byId(r, "b").color).toBe(bClass?.color);
		expect(FAMILY_RAMPS.people).toContain(byId(r, "b").color);
		const a = byId(r, "a").symbol;
		expect(a?.kind === "bubble" && a.areaRatio).toBe(1);
		expect(byId(r, "n").underlay).toBeNull();
		expect(byId(r, "n").color).toBeNull();
		expect(r.legend.underlay?.unit).toBe("per 1,000 km² of land area");
	});

	it("shades by coverage, and leaves an area without a land area unshaded and counted", () => {
		const r = resolveMapState(five, {
			family: "housing",
			scope: signedIn,
			symbol: "bubble",
			underlay: { kind: "coverage", family: "people" },
		});
		expect(byId(r, "a").underlay?.value).toBe(100);
		expect(byId(r, "e").underlay?.value).toBe(25);
		const partial = resolveMapState(five, {
			family: "housing",
			scope: signedIn,
			symbol: "bubble",
			underlay: {
				kind: "density",
				family: "people",
				areaKm2: new Map([["a", 1000]]),
			},
		});
		expect(byId(partial, "b").underlay).toBeNull();
		expect(partial.legend.underlay?.areasWithout).toBe(4);
	});

	it("refuses an underlay in the same colour family, outside symbol mode, or with no areas", () => {
		const same = resolveMapState(five, {
			family: "people",
			scope: signedIn,
			symbol: "bubble",
			underlay: { kind: "coverage", family: "people" },
		});
		expect(same.legend.underlayRefused).toBe("same_family_as_symbols");
		expect(same.areas.every((a) => a.underlay === null)).toBe(true);
		const choro = resolveMapState(five, {
			family: "housing",
			scope: signedIn,
			underlay: { kind: "coverage", family: "people" },
		});
		expect(choro.legend.underlayRefused).toBe("not_symbol_mode");
		const noArea = resolveMapState(five, {
			family: "housing",
			scope: signedIn,
			symbol: "bars",
			underlay: { kind: "density", family: "people" },
		});
		expect(noArea.legend.underlayRefused).toBe("no_area_data");
	});
});

describe("rounded bars over a choropleth (Alex's choice, 2026-10-17)", () => {
	const deaths = [
		reported("a", 120),
		reported("b", 40),
		reported("c", 10),
		reported("d", 70),
		reported("e", 5),
		cell("n", "not_reported"),
	];
	const houses = (destroyed: number | null, damaged: number | null) => [
		{
			key: "destroyed",
			label: "Dwellings destroyed",
			value: destroyed,
			valueState:
				destroyed === null ? ("not_reported" as const) : ("reported" as const),
		},
		{
			key: "damaged",
			label: "Dwellings damaged",
			value: damaged,
			valueState:
				damaged === null ? ("not_reported" as const) : ("reported" as const),
		},
	];
	const run = () =>
		resolveLayeredMapState(
			deaths,
			[
				{ areaId: "a", parts: houses(300, 900) },
				{ areaId: "b", parts: houses(null, 200) },
				{ areaId: "c", parts: houses(null, null) },
				{ areaId: "n", parts: houses(50, null) },
			],
			{ family: "people", scope: signedIn, barsFamily: "housing" },
		);

	it("shades by the number of deaths in classes and stands house bars on top", () => {
		const r = run();
		expect(r.legend.mode).toBe("classes");
		expect(byId(r, "a").classIndex).not.toBeNull();
		expect(FAMILY_RAMPS.people).toContain(byId(r, "a").color);
		const a = byId(r, "a").symbol;
		expect(a?.kind === "bars" && a.bars.map((b) => b.ratio)).toEqual([
			300 / 900,
			1,
		]);
		expect(r.legend.symbols?.kind).toBe("bars");
		expect(r.legend.symbols?.color).toBe(FAMILY_RAMPS.housing.at(-1));
		expect(r.legend.symbols?.scaleMax).toBe(900);
	});

	it("keeps each layer's own states: no deaths reported still draws reported houses", () => {
		const r = run();
		expect(byId(r, "n").state).toBe("not_reported");
		const n = byId(r, "n").symbol;
		expect(n?.kind === "bars" && n.bars.map((b) => b.ratio)).toEqual([
			50 / 900,
			null,
		]);
		const b = byId(r, "b").symbol;
		expect(b?.kind === "bars" && b.bars[0].ratio).toBeNull();
		expect(byId(r, "c").symbol).toBeNull();
		expect(byId(r, "d").symbol).toBeNull();
	});

	it("refuses bars and shading in the same colour family", () => {
		expect(() =>
			resolveLayeredMapState(deaths, [], {
				family: "people",
				scope: signedIn,
				barsFamily: "people",
			}),
		).toThrow();
	});
});
