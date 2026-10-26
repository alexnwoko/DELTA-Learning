// Seasonality score and pre-season window for one hazard row (E-20 FR-AN-061,
// E-15 FR-AN-094; DELTA_Estimated_Disaggregation_and_Hazard_Seasonality.md
// section 5.5). Computed from the 12 monthly counts of occurrences with a
// usable month. The month bars are always shown; only the score is withheld
// when the counts cannot carry it, because a score from a few records or a
// single year reads noise as a season. Pure module: no database access.

export const SEASON_RULE = {
	/** Fewest occurrences with a usable month. */
	minUsable: 30,
	/** Fewest distinct start years among them. */
	minYears: 5,
	/** Smallest share of the hazard's occurrences that have a usable month. */
	minUsableShare: 0.5,
	/** Chi-square against an even spread, 11 degrees of freedom, p < 0.01. */
	chiCritical: 24.725,
	/** Chance-adjusted concentration below this is "weak" even when the test passes. */
	weakConcentration: 0.1,
	/**
	 * Expected normalised Gini of n occurrences spread at random over 12
	 * months is about GINI0_CONSTANT / sqrt(n) (fitted to the simulation in
	 * section 5.5: 0.43 at 20, 0.35 at 30, 0.19 at 100, 0.09 at 500).
	 */
	gini0Constant: 1.92,
	/** Months in the pre-season window. */
	windowMonths: 3,
} as const;

export type SeasonVerdict = "clear" | "weak" | "none" | "too_few";

export interface SeasonScore {
	verdict: SeasonVerdict;
	/** Why the score is withheld, when verdict is too_few. */
	withheld: "few_usable" | "few_years" | "few_dated" | null;
	usable: number;
	all: number;
	years: number;
	/** Months (1-12), fewest taken largest first that hold half the usable occurrences. */
	peakMonths: number[];
	/** Share held by the three largest months; a flat year gives 0.25. */
	topThreeShare: number | null;
	/** Chance-adjusted concentration: 0 no season, 1 one month; can be below 0. */
	concentration: number | null;
	chiSquare: number | null;
	/**
	 * Pre-season windows (clear verdict only): the three months before each
	 * peak season, along the calendar. Peak months one month apart form one
	 * season; a second season (two monsoons) gets its own window. Months
	 * before the usual impact season, not a forecast lead time.
	 */
	windows: { season: number[]; window: number[] }[];
	/** One-line reading for the panel. */
	line: string;
}

const MONTH_ABBR = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
];
export const monthName = (m: number) => MONTH_ABBR[m - 1];

/** Gini index over the months, divided by its maximum (11/12). */
export function normalisedGini(counts: readonly number[]): number {
	const n = counts.reduce((a, b) => a + b, 0);
	const k = counts.length;
	if (n === 0) return 0;
	let diff = 0;
	for (const a of counts) for (const b of counts) diff += Math.abs(a - b);
	const g = diff / (2 * k * n);
	return g / ((k - 1) / k);
}

export function expectedRandomGini(n: number): number {
	return n > 0 ? Math.min(1, SEASON_RULE.gini0Constant / Math.sqrt(n)) : 1;
}

export function chiSquareEven(counts: readonly number[]): number {
	const n = counts.reduce((a, b) => a + b, 0);
	const e = n / counts.length;
	return e > 0 ? counts.reduce((s, o) => s + (o - e) ** 2 / e, 0) : 0;
}

/** Peak months: the fewest months, largest first, holding at least half. */
export function peakMonths(counts: readonly number[]): number[] {
	const n = counts.reduce((a, b) => a + b, 0);
	if (n === 0) return [];
	const order = counts
		.map((c, i) => ({ c, m: i + 1 }))
		.sort((a, b) => b.c - a.c || a.m - b.m);
	const out: number[] = [];
	let held = 0;
	for (const { c, m } of order) {
		if (held * 2 >= n) break;
		out.push(m);
		held += c;
	}
	return out.sort((a, b) => a - b);
}

const wrap = (m: number) => ((((m - 1) % 12) + 12) % 12) + 1;

/** Peak months grouped into seasons: months at most two apart (one gap) join. */
export function peakSeasons(peaks: readonly number[]): number[][] {
	if (peaks.length === 0) return [];
	const set = new Set(peaks);
	const seasons: number[][] = [];
	const seen = new Set<number>();
	// A season starts at a peak month with no peak in the two months before it.
	const starts = peaks.filter(
		(m) => !set.has(wrap(m - 1)) && !set.has(wrap(m - 2)),
	);
	for (const s of starts.length ? starts : [Math.min(...peaks)]) {
		const season: number[] = [];
		let m = s;
		while (set.has(m) && !seen.has(m)) {
			season.push(m);
			seen.add(m);
			m = set.has(wrap(m + 1))
				? wrap(m + 1)
				: set.has(wrap(m + 2))
					? wrap(m + 2)
					: 0;
			if (m === 0) break;
		}
		if (season.length) seasons.push(season);
	}
	return seasons;
}

export function seasonScore(input: {
	counts: readonly number[];
	all: number;
	years: number;
}): SeasonScore {
	const { counts, all, years } = input;
	const usable = counts.reduce((a, b) => a + b, 0);
	const peaks = peakMonths(counts);
	const sorted = [...counts].sort((a, b) => b - a);
	const topThreeShare =
		usable > 0 ? (sorted[0] + sorted[1] + sorted[2]) / usable : null;
	const base = { usable, all, years, peakMonths: peaks, topThreeShare };
	const withheld: SeasonScore["withheld"] =
		usable < SEASON_RULE.minUsable
			? "few_usable"
			: years < SEASON_RULE.minYears
				? "few_years"
				: all > 0 && usable / all < SEASON_RULE.minUsableShare
					? "few_dated"
					: null;
	if (withheld)
		return {
			...base,
			verdict: "too_few",
			withheld,
			concentration: null,
			chiSquare: null,
			windows: [],
			line: "Too few dated records",
		};
	const g = normalisedGini(counts);
	const g0 = expectedRandomGini(usable);
	const concentration = g0 < 1 ? (g - g0) / (1 - g0) : 0;
	const chi = chiSquareEven(counts);
	const verdict: SeasonVerdict =
		chi <= SEASON_RULE.chiCritical
			? "none"
			: concentration < SEASON_RULE.weakConcentration
				? "weak"
				: "clear";
	const windows =
		verdict === "clear"
			? peakSeasons(peaks).map((season) => {
					const window: number[] = [];
					for (let i = SEASON_RULE.windowMonths; i >= 1; i--) {
						const m = wrap(season[0] - i);
						if (!peaks.includes(m)) window.push(m);
					}
					return { season, window };
				})
			: [];
	const half = `Half of the records fall in ${peaks.map(monthName).join(", ")}.`;
	const conc = `Concentration ${concentration.toFixed(2)}.`;
	const word =
		verdict === "clear"
			? "Clear season."
			: verdict === "weak"
				? "Weak season."
				: "No clear season.";
	return {
		...base,
		verdict,
		withheld: null,
		concentration: Math.round(concentration * 100) / 100,
		chiSquare: Math.round(chi * 10) / 10,
		windows,
		line: `${half} ${conc} ${word}`,
	};
}
