import { describe, it, expect } from "vitest";
import {
	DISAGGREGATION_MODELS,
	DEFAULT_DISAGGREGATION_MODEL,
	bandFromFiveYearGroups,
	disaggregationModel,
} from "~/utils/disaggregationModels";

describe("disaggregation models", () => {
	it("keeps four named models, DELTA first and the default", () => {
		expect(DISAGGREGATION_MODELS.map((m) => m.name)).toEqual([
			"DELTA disaggregation",
			"SFM disaggregation",
			"UN disaggregation",
			"Life-stage disaggregation",
		]);
		expect(DEFAULT_DISAGGREGATION_MODEL).toBe("delta");
	});

	it("covers every age once in every model: no gap, no overlap, open at the top", () => {
		for (const m of DISAGGREGATION_MODELS) {
			const b = m.ageBands;
			expect(b[0].from).toBe(0);
			for (let i = 1; i < b.length; i++)
				expect(b[i].from).toBe((b[i - 1].to as number) + 1);
			expect(b[b.length - 1].to).toBeNull();
		}
	});

	it("splits a five-year group evenly where a band edge falls inside it (18 in 15-19)", () => {
		const groups = new Map([
			[0, 50],
			[5, 50],
			[10, 50],
			[15, 100],
			[20, 70],
			[65, 30],
			[100, 1],
		]);
		const delta = disaggregationModel("delta").ageBands;
		const by = Object.fromEntries(
			delta.map((b) => [b.key, bandFromFiveYearGroups(groups, b)]),
		);
		expect(by["0-4"]).toEqual({ value: 50, split: false });
		expect(by["5-17"]).toEqual({ value: 160, split: true });
		expect(by["18-64"]).toEqual({ value: 110, split: true });
		expect(by["65+"]).toEqual({ value: 31, split: false });
		const total = [...groups.values()].reduce((a, v) => a + v, 0);
		expect(Object.values(by).reduce((a, x) => a + x.value, 0)).toBeCloseTo(
			total,
			9,
		);
	});

	it("never splits the SFM, UN or life-stage bands: they follow five-year edges", () => {
		const groups = new Map(
			Array.from({ length: 21 }, (_, i) => [i * 5, 1] as [number, number]),
		);
		for (const id of ["sfm", "un", "life_stage"] as const)
			for (const b of disaggregationModel(id).ageBands)
				expect(bandFromFiveYearGroups(groups, b).split).toBe(false);
	});
});
