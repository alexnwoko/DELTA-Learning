// Payload type for "Human toll ratios by hazard" (evidence-pattern review
// U-02 and U-06, 2026-10-19): per specific HIPs hazard, the median number of
// people injured per death and of people displaced per dwelling destroyed,
// over the disaster records that report both figures. Medians, not sums of
// ratios, so one extreme record cannot carry a hazard; a ratio with too few
// records is suppressed, never shown as 0.

import type { PanelMeta } from "~/utils/dashboard/impactPanels";

export interface ImpactRatio {
	/** Median ratio; null when suppressed. */
	median: number | null;
	/** Records reporting both figures (and not under review). */
	records: number;
	suppressed: boolean;
}

export interface ImpactRatios {
	minRecords: number;
	rows: {
		key: string;
		label: string;
		injuredPerDeath: ImpactRatio;
		displacedPerDwellingDestroyed: ImpactRatio;
	}[];
	meta: PanelMeta;
}
