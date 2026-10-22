// Named sex and age disaggregation models (Alex, 2026-10-22). Each model is a
// set of age bands and sex categories that a view can be shown in; the
// estimate is computed for every model from the same UN DESA WPP 2024
// five-year groups. Documented in DELTA_Disaggregation_Models.md
// (60_Analytics_and_Economics).
//
// - DELTA disaggregation: Alex's model and the default view.
// - SFM disaggregation: the Sendai Framework Monitor standard (SADDD guidance,
//   UNDRR, 2021), which is also how DELTA records age (0-14, 15-64, 65+).
// - UN disaggregation: the UN five-year age groups, as WPP publishes them.
// - Life-stage disaggregation: the Analytics proposal of 2026-10-22.
//
// Where a band edge falls inside a five-year group (18 inside 15-19), the
// group is split evenly across its five single years (approved by Alex,
// 2026-10-22) and the band is marked split. Pure module: no database access.

export const DISAGGREGATION_MODEL_IDS = [
	"delta",
	"sfm",
	"un",
	"life_stage",
] as const;
export type DisaggregationModelId = (typeof DISAGGREGATION_MODEL_IDS)[number];

/** Default model for every sex and age view. */
export const DEFAULT_DISAGGREGATION_MODEL: DisaggregationModelId = "delta";

export interface AgeBand {
	key: string;
	label: string;
	/** First year of age in the band. */
	from: number;
	/** Last year of age in the band, inclusive; null for an open top band. */
	to: number | null;
}

export interface DisaggregationModel {
	id: DisaggregationModelId;
	name: string;
	/** Where the bands come from. */
	source: string;
	sex: readonly ("female" | "male")[];
	ageBands: readonly AgeBand[];
}

const fiveYearGroups = (): AgeBand[] => [
	...Array.from({ length: 20 }, (_, i) => ({
		key: `${i * 5}-${i * 5 + 4}`,
		label: `${i * 5}-${i * 5 + 4}`,
		from: i * 5,
		to: i * 5 + 4,
	})),
	{ key: "100+", label: "100+", from: 100, to: null },
];

export const DISAGGREGATION_MODELS: readonly DisaggregationModel[] = [
	{
		id: "delta",
		name: "DELTA disaggregation",
		source: "Alex Nwoko, DELTA product ruling, 2026-10-22",
		sex: ["female", "male"],
		ageBands: [
			{ key: "0-4", label: "Young children (0-4)", from: 0, to: 4 },
			{ key: "5-17", label: "Children (5-17)", from: 5, to: 17 },
			{ key: "18-64", label: "Adults (18-64)", from: 18, to: 64 },
			{ key: "65+", label: "Older persons (65+)", from: 65, to: null },
		],
	},
	{
		id: "sfm",
		name: "SFM disaggregation",
		source:
			"Sendai Framework Monitor, Sex, Age and Disability Disaggregated Data (SADDD) guidance, UNDRR, 2021",
		sex: ["female", "male"],
		ageBands: [
			{ key: "0-14", label: "Children (0-14)", from: 0, to: 14 },
			{ key: "15-64", label: "Adults (15-64)", from: 15, to: 64 },
			{ key: "65+", label: "Seniors (65+)", from: 65, to: null },
		],
	},
	{
		id: "un",
		name: "UN disaggregation",
		source: "UN five-year age groups, UN DESA World Population Prospects 2024",
		sex: ["female", "male"],
		ageBands: fiveYearGroups(),
	},
	{
		id: "life_stage",
		name: "Life-stage disaggregation",
		source: "DELTA Analytics proposal, 2026-10-22",
		sex: ["female", "male"],
		ageBands: [
			{ key: "0-4", label: "Young children (0-4)", from: 0, to: 4 },
			{ key: "5-14", label: "Children (5-14)", from: 5, to: 14 },
			{ key: "15-24", label: "Youth (15-24)", from: 15, to: 24 },
			{ key: "25-64", label: "Adults (25-64)", from: 25, to: 64 },
			{ key: "65-79", label: "Older persons (65-79)", from: 65, to: 79 },
			{ key: "80+", label: "Older persons (80+)", from: 80, to: null },
		],
	},
];

export function disaggregationModel(
	id: DisaggregationModelId,
): DisaggregationModel {
	return DISAGGREGATION_MODELS.find((m) => m.id === id)!;
}

/** Width of the open top group (100+) used for the even split; never split in practice. */
const OPEN_GROUP_YEARS = 5;

/**
 * A band's value from five-year group values (keyed by the group's first
 * year; 100 for 100+). A group the band only partly covers contributes the
 * covered share of its five years, and the band is marked split.
 */
export function bandFromFiveYearGroups(
	groups: ReadonlyMap<number, number>,
	band: AgeBand,
): { value: number; split: boolean } {
	let value = 0;
	let split = false;
	const top = band.to ?? Infinity;
	for (const [lo, v] of groups) {
		const hi = lo >= 100 ? lo + OPEN_GROUP_YEARS - 1 : lo + 4;
		const width = hi - lo + 1;
		const overlap =
			lo >= 100 && top === Infinity
				? width
				: Math.max(0, Math.min(hi, top) - Math.max(lo, band.from) + 1);
		if (overlap <= 0) continue;
		if (overlap < width) split = true;
		value += (v * overlap) / width;
	}
	return { value, split };
}
