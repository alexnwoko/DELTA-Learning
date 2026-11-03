import { describe, it, expect } from "vitest";
import {
	SEASON_RULE,
	expectedRandomGini,
	normalisedGini,
	peakMonths,
	peakSeasons,
	seasonScore,
	weeklyReportingDay,
} from "~/utils/dashboard/seasonality";

// Month counts Jan..Dec.
const angolaLike = [30, 8, 32, 35, 3, 1, 1, 2, 6, 14, 18, 21]; // peaks Jan, Mar, Apr
const flat = Array(12).fill(10);

describe("seasonality score", () => {
	it("finds the fewest months holding half, largest first", () => {
		expect(peakMonths(angolaLike)).toEqual([1, 3, 4]);
		expect(peakMonths([0, 0, 0, 0, 0, 0, 0, 100, 0, 0, 0, 0])).toEqual([8]);
	});

	it("normalises the Gini index: 0 for an even spread, 1 for one month", () => {
		expect(normalisedGini(flat)).toBeCloseTo(0, 9);
		expect(normalisedGini([12, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])).toBeCloseTo(
			1,
			9,
		);
	});

	it("matches the chance level by simulation (seeded), so noise is not read as a season", () => {
		let s = 42;
		const rand = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
		for (const n of [30, 100, 500]) {
			let total = 0;
			const draws = 3000;
			for (let d = 0; d < draws; d++) {
				const c = Array(12).fill(0);
				for (let i = 0; i < n; i++) c[Math.floor(rand() * 12)]++;
				total += normalisedGini(c);
			}
			expect(Math.abs(total / draws - expectedRandomGini(n))).toBeLessThan(
				0.03,
			);
		}
	});

	it("reads a clear season and shades the three months before it (Angola flooding pattern)", () => {
		const s = seasonScore({ counts: angolaLike, all: 200, years: 20 });
		expect(s.verdict).toBe("clear");
		expect(s.line).toMatch(
			/^Half of the records fall in Jan, Mar, Apr\. Concentration 0\.\d\d\. Clear season\.$/,
		);
		expect(s.windows).toEqual([{ season: [1, 3, 4], window: [10, 11, 12] }]);
	});

	it("gives a second window for a second season (two monsoons)", () => {
		expect(peakSeasons([5, 11, 12])).toEqual([[5], [11, 12]]);
		const counts = [5, 5, 5, 6, 50, 10, 8, 8, 8, 10, 45, 45];
		const s = seasonScore({ counts, all: 220, years: 40 });
		expect(s.verdict).toBe("clear");
		expect(s.windows).toEqual([
			{ season: [5], window: [2, 3, 4] },
			{ season: [11, 12], window: [8, 9, 10] },
		]);
	});

	it("says no clear season for an even spread", () => {
		const s = seasonScore({ counts: flat, all: 120, years: 10 });
		expect(s.verdict).toBe("none");
		expect(s.windows).toEqual([]);
	});

	it("calls a statistically present but practically flat pattern weak", () => {
		const counts = [
			3600, 3500, 3500, 3500, 3500, 3500, 3400, 3400, 3400, 3400, 3500, 3700,
		];
		expect(seasonScore({ counts, all: 41900, years: 30 }).verdict).toBe("weak");
	});

	it("withholds the score, never the bars, below each threshold", () => {
		expect(
			seasonScore({
				counts: [29, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
				all: 29,
				years: 9,
			}).withheld,
		).toBe("few_usable");
		expect(
			seasonScore({
				counts: angolaLike,
				all: 171,
				years: SEASON_RULE.minYears - 1,
			}).withheld,
		).toBe("few_years");
		const niger = seasonScore({ counts: angolaLike, all: 32776, years: 9 });
		expect(niger.withheld).toBe("few_dated");
		expect(niger.line).toBe("Too few dated records");
		expect(niger.peakMonths).toEqual([1, 3, 4]);
	});
});

describe("weekly reporting dates", () => {
	// 2024-01-07 is a Sunday; the next 6 days cover the other weekdays.
	const week = (ymd: string, n: number) => [ymd, n] as const;

	it("names the weekday when day dates heap on it", () => {
		const out = weeklyReportingDay([
			week("2024-01-07", 80),
			week("2024-01-08", 10),
			week("2024-01-09", 10),
		]);
		expect(out).toMatchObject({ weekday: "Sunday", share: 0.8, dated: 100 });
		expect(out?.line).toBe("Day dates here are weekly reporting dates");
	});

	it("stays silent for dates spread across the week, and for too few dates", () => {
		const even = [7, 8, 9, 10, 11, 12, 13].map((d) =>
			week(`2024-01-${String(d).padStart(2, "0")}`, 20),
		);
		expect(weeklyReportingDay(even)).toBeNull();
		expect(weeklyReportingDay([week("2024-01-07", 99)])).toBeNull();
	});

	it("does not test an impossible date", () => {
		expect(weeklyReportingDay([week("2023-02-30", 500)])).toBeNull();
	});
});
