// D1 Analysis dashboard, Disaster impact panels 1 to 4: the loader behind
// the payload types in ~/utils/dashboard/impactPanels. It reads one
// delta.query/1 object and returns every figure as a cell with its value
// state and record counts (TR-076).

import { cachedDashboard } from "~/backend.server/models/analytics/dashboard/dashboardCache.server";
import { sql } from "drizzle-orm";
import { dr } from "~/db.server";
import {
	getAffectedPeopleByHazardFilters,
	getHumanEffectsGrouped,
	type GroupedHumanEffects,
	type HazardFilters,
} from "~/backend.server/models/analytics/hazard-analysis";
import type { ApprovalAudience } from "~/utils/approvalBasis";
import type { DeltaQuery } from "~/utils/deltaQuery";
import { scopeLabel } from "~/utils/mapState";
import { measureValue, type MeasureValue } from "~/utils/valueState";
import {
	IMPACT_HEADLINE_MEASURES,
	type ImpactHeadlineMeasure,
	type ImpactPanels1to4,
	type PanelCell,
} from "~/utils/dashboard/impactPanels";

/** Years shown in each headline sparkline. */
export const SPARKLINE_YEARS = 10;

/** A year or group with no record in scope: not reported, never 0. */
export const EMPTY_CELL: PanelCell = measureValue({
	sum: null,
	reported: 0,
	zeroConfirmed: 0,
	total: 0,
});

export interface ImpactPanelsContext {
	countryAccountsId: string;
	audience: ApprovalAudience;
	tenantName: string | null;
	/** True when the audience includes the reviewer provisional basis. */
	provisional: boolean;
}

/** The record filters a delta.query/1 object maps to, and what it cannot apply. */
export function impactFiltersFromQuery(
	query: DeltaQuery,
	ctx: ImpactPanelsContext,
): { filters: HazardFilters; notApplied: string[] } {
	const notApplied: string[] = [];
	if (query.where.region) notApplied.push("region");
	if (query.where.sectors?.length) notApplied.push("sector");
	if (query.where.disasterEventId) notApplied.push("disasterEvent");
	if (query.where.hazardousEventId) notApplied.push("hazardousEvent");
	// Effect chips select which effects a view draws; no loader filters
	// records by them, so they are named, never silently ignored (TR-175).
	if (query.where.humanEffects?.length) notApplied.push("humanEffects");
	return {
		filters: {
			countryAccountsId: ctx.countryAccountsId,
			audience: ctx.audience,
			hazardTypeId: query.where.hazard?.typeId ?? null,
			hazardClusterId: query.where.hazard?.clusterId ?? null,
			specificHazardId: query.where.hazard?.hazardId ?? null,
			geographicLevelId: query.where.geo?.divisionId ?? null,
			fromDate: query.where.time?.from ?? null,
			toDate: query.where.time?.to ?? null,
		},
		notApplied,
	};
}

export function chosenMeasure(query: DeltaQuery): ImpactHeadlineMeasure {
	return (IMPACT_HEADLINE_MEASURES as readonly string[]).includes(
		query.measure ?? "",
	)
		? (query.measure as ImpactHeadlineMeasure)
		: "deaths";
}

/** Value used to rank cells: reported values first, then everything else. */
export function rankValue(c: MeasureValue): number {
	return c.value === null ? Number.NEGATIVE_INFINITY : c.value;
}

export async function hipTypeLabels(): Promise<Map<string, string>> {
	const res = await dr.execute(
		sql`SELECT id::text AS id, name_en FROM hip_class`,
	);
	return new Map(
		(res.rows as { id: string; name_en: string }[]).map((r) => [
			r.id,
			r.name_en,
		]),
	);
}

function yearSeries(
	rows: GroupedHumanEffects[],
	measure: ImpactHeadlineMeasure,
	years: number[],
): { year: number; cell: PanelCell }[] {
	const byYear = new Map(
		rows.filter((r) => r.year !== null).map((r) => [r.year as number, r]),
	);
	return years.map((year) => ({
		year,
		cell: byYear.get(year)?.measures[measure] ?? EMPTY_CELL,
	}));
}

function yearRange(rows: GroupedHumanEffects[]): number[] {
	const years = rows.map((r) => r.year).filter((y): y is number => y !== null);
	if (!years.length) return [];
	const from = Math.min(...years);
	const to = Math.max(...years);
	return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

async function computeGetImpactPanels1to4(
	query: DeltaQuery,
	ctx: ImpactPanelsContext,
): Promise<ImpactPanels1to4> {
	const { filters, notApplied } = impactFiltersFromQuery(query, ctx);
	const measure = chosenMeasure(query);

	const [headline, byYear, byType, byTypeYear, labels] = await Promise.all([
		getAffectedPeopleByHazardFilters(filters),
		getHumanEffectsGrouped(filters, "year"),
		getHumanEffectsGrouped(filters, "hipType"),
		getHumanEffectsGrouped(filters, "hipTypeYear"),
		hipTypeLabels(),
	]);

	const allYears = yearRange(byYear);
	const sparkYears = allYears.slice(-SPARKLINE_YEARS);

	const tiles = IMPACT_HEADLINE_MEASURES.map((m) => ({
		measure: m,
		cell: headline.measures[m],
		sparkline: yearSeries(byYear, m, sparkYears),
	}));

	const headCell = headline.measures[measure];
	const coverage = {
		measure,
		recordsReported: headCell.recordsReported,
		recordsZeroConfirmed: headCell.recordsZeroConfirmed,
		recordsNotReported: headCell.recordsNotReported,
		recordsFlagged: headCell.recordsFlagged,
		recordsTotal: headCell.recordsTotal,
	};

	const years = yearSeries(byYear, measure, allYears);
	const ranks = ["Highest year in scope", "Second highest", "Third highest"];
	const annotations = [...years]
		.filter((y) => y.cell.value !== null && y.cell.value > 0)
		.sort((a, b) => rankValue(b.cell) - rankValue(a.cell))
		.slice(0, 3)
		.map((y, i) => ({ year: y.year, label: ranks[i] }));

	const typeLabel = (id: string | null) =>
		id === null ? "No HIPs type" : (labels.get(id) ?? `HIPs type ${id}`);

	const typeIds = [...new Set(byTypeYear.map((r) => r.hipTypeId))];
	const byHazard = typeIds.map((id) => ({
		hipTypeId: id ?? "none",
		label: typeLabel(id),
		years: yearSeries(
			byTypeYear.filter((r) => r.hipTypeId === id),
			measure,
			allYears,
		),
	}));

	const hazardRanking = byType
		.map((r) => ({
			hipTypeId: r.hipTypeId ?? "none",
			label: typeLabel(r.hipTypeId),
			cell: r.measures[measure],
		}))
		.sort((a, b) => rankValue(b.cell) - rankValue(a.cell));

	const scope = scopeLabel({
		tenant: ctx.tenantName,
		fromDate: filters.fromDate,
		toDate: filters.toDate,
		hazard: filters.hazardTypeId ? typeLabel(filters.hazardTypeId) : null,
		audience: ctx.audience,
		provisional: ctx.provisional,
	});

	const coverageText = `Based on ${headCell.recordsReported + headCell.recordsZeroConfirmed} of ${headCell.recordsTotal} records`;
	return {
		query,
		scopeText: scope.text,
		provisional: scope.provisional,
		tiles,
		coverage,
		timeline: { measure, years, annotations, byHazard },
		hazardRanking,
		meta: {
			tiles: {
				method: "Sum over records in scope; a record counts once",
				coverage: coverageText,
				notApplied,
			},
			coverage: {
				method: "Records in scope by value state for the chosen measure",
				notApplied,
			},
			timeline: {
				method:
					"Sum per year of the record's start date; records without a start year are left out of the series",
				coverage: coverageText,
				notApplied,
			},
			hazardRanking: {
				method:
					"Sum per HIPs type; records without a HIPs type are listed as their own row",
				coverage: coverageText,
				notApplied,
			},
		},
	};
}

/** getImpactPanels1to4, reused for DASHBOARD_CACHE_TTL_MS per tenant, audience and query. */
export function getImpactPanels1to4(
	query: DeltaQuery,
	ctx: ImpactPanelsContext,
): Promise<ImpactPanels1to4> {
	return cachedDashboard("getImpactPanels1to4", [ctx, query], () =>
		computeGetImpactPanels1to4(query, ctx),
	);
}
