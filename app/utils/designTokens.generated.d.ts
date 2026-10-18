/**
 * Do not edit directly, this file was auto-generated.
 */

export interface StateTokens {
	fill: string;
	stroke: string;
	strokeWidth: number;
	dash: string;
	pattern: string;
}
export interface StrokeTokens {
	stroke: string;
	strokeWidth: number;
}
export declare const dataTokens: {
	state: Record<"zeroConfirmed" | "notReported" | "insufficientReporting" | "notApplicable" | "suppressed", StateTokens>;
	map: {
		noRecords: StrokeTokens & { fill: string };
		areaBoundary: StrokeTokens;
		selectedOutline: StrokeTokens;
		plausibilityMarker: StrokeTokens;
		notAppliedNote: { border: string; borderWidth: number; background: string };
		canvas: { background: string };
		countryOutline: StrokeTokens;
		areaLabel: { color: string; halo: string; size: number };
	};
	flag: { reviewChip: { background: string; text: string } };
	chart: { axis: string };
	notice: { provisional: { border: string; background: string } };
	icon: string;
	hazard: Record<"meteorologicalHydrological" | "geological" | "biological" | "environmental" | "chemical" | "technological" | "societal" | "extraterrestrial" | "unclassified", string>;
	ramp: Record<"people" | "housing" | "money" | "events", readonly string[]>;
};
