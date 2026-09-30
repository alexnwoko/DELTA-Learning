import { describe, it, expect } from "vitest";
import {
	FAMILY_RAMPS,
	MIN_AREAS_FOR_CLASSES,
	type MapCell,
	type MapScopeQuery,
	OFF_RAMP_STATES,
	STATE_ENCODING,
	SINGLE_TONE_CLASS,
	notAppliedStrips,
	q2Grade,
	quantileBreaks,
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

	it("public views withhold zero_confirmed until V-5 is final", () => {
		const a = resolve(
			[
				cell("z", "zero_confirmed", {
					recordsZeroConfirmed: 3,
					recordsTotal: 9,
				}),
			],
			{ ...signedIn, audience: "public" },
		).areas[0];
		expect(a.state).toBe("insufficient_reporting");
		expect(a.reason).toBe("zero_withheld_until_v5");
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
			"all dates · Hazard: all hazards · Basis: published · Provisional, not for citation",
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
