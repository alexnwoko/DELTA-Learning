// Plain wording for geo API refusals (review gap 6): what happened and what
// to do next, never a raw code. The server's English message stays the
// fallback for a code this table does not know yet.
import type { GeoT } from "~/frontend/geoportal/i18n";

export interface RefusalText {
	title: string;
	next: string;
}

export function refusalText(
	code: string,
	server: { message: string; resolution: string },
	t: GeoT,
): RefusalText {
	switch (code) {
		case "MONETARY_CONVENTIONS_PENDING":
			return {
				title: t({
					code: "geoportal.refusal.money.title",
					msg: "Losses in money cannot be mapped yet.",
				}),
				next: t({
					code: "geoportal.refusal.money.next",
					msg: "Choose a human-effects or house measure. Money values wait for the currency and inflation rules.",
				}),
			};
		case "MEASURE_NOT_AVAILABLE":
			return {
				title: t({
					code: "geoportal.refusal.measure.title",
					msg: "This measure is not available for this dimension.",
				}),
				next: t({
					code: "geoportal.refusal.measure.next",
					msg: "Choose another measure from the list.",
				}),
			};
		case "MULTI_SERIES_CHOROPLETH":
			return {
				title: t({
					code: "geoportal.refusal.multi.title",
					msg: "A map shows one measure at a time.",
				}),
				next: t({
					code: "geoportal.refusal.multi.next",
					msg: "Choose a single measure.",
				}),
			};
		case "ATT_D_EXCLUDED_FROM_OFFICIAL":
			return {
				title: t({
					code: "geoportal.refusal.attd.title",
					msg: "Figures with the weakest location evidence (grade D) are not used in official maps.",
				}),
				next: t({
					code: "geoportal.refusal.attd.next",
					msg: "Use grade C or better.",
				}),
			};
		case "PRECISION_BELOW_CEILING":
			return {
				title: t({
					code: "geoportal.refusal.precision.title",
					msg: "The data is not precise enough for this map level.",
				}),
				next: t({
					code: "geoportal.refusal.precision.next",
					msg: "Choose a higher admin level.",
				}),
			};
		case "CROSS_VERSION_AGGREGATION_REFUSED":
			return {
				title: t({
					code: "geoportal.refusal.vintage.title",
					msg: "These figures use different boundary versions and cannot be added up.",
				}),
				next: t({
					code: "geoportal.refusal.vintage.next",
					msg: "Narrow the period to one boundary version.",
				}),
			};
		case "GRAIN_CARDINALITY_EXCEEDED":
			return {
				title: t({
					code: "geoportal.refusal.size.title",
					msg: "This view has too many areas to draw.",
				}),
				next: t({
					code: "geoportal.refusal.size.next",
					msg: "Choose a higher admin level or a smaller area.",
				}),
			};
		case "INTENSIVE_QUANTITY_NOT_SUMMABLE":
			return {
				title: t({
					code: "geoportal.refusal.rate.title",
					msg: "Rates and averages cannot be added across areas.",
				}),
				next: t({
					code: "geoportal.refusal.rate.next",
					msg: "Choose a count measure.",
				}),
			};
		case "MALFORMED_REQUEST":
			return {
				title: t({
					code: "geoportal.refusal.malformed.title",
					msg: "The filters in the address are not valid.",
				}),
				next: server.message,
			};
		default:
			return { title: server.message, next: server.resolution };
	}
}
