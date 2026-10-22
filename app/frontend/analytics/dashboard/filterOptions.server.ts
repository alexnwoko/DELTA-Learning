// What the shared filter bar needs on the Analysis dashboard: the HIPs
// hazard tree (with record counts, for the hazard drop-downs and chips),
// the tenant's level-1 divisions and its regions (the "Area" control).
// Server only. Each part fails soft: a missing part hides its control
// rather than breaking the page.
import { sql } from "drizzle-orm";
import { dr } from "~/db.server";
import { cachedDashboard } from "~/backend.server/models/analytics/dashboard/dashboardCache.server";
import { getHazardTree } from "~/backend.server/models/geo/queries";
import { listRegions } from "~/backend.server/models/geo/regions";
import { flattenHazardTree, type HazardTree, type NestedHazardTree } from "~/frontend/geoportal/GeoFilterBar";
import type { PlaceOptions } from "~/frontend/geoportal/filterBarState";
import type { ApprovalAudience } from "~/utils/approvalBasis";
import type { DeltaQuery } from "~/utils/deltaQuery";

export interface DashboardFilterOptions {
	hazardTree: HazardTree | null;
	place: PlaceOptions;
	/** The From and To year selects: the tenant's record years, kept within 1900 to this year (FR-AN-003). */
	years: { min: number; max: number };
}

/** Levels 1 and 2, so the row can offer "Place, level 1" then "Level 2" under it. */
async function placeDivisions(countryAccountsId: string, lang: string): Promise<NonNullable<PlaceOptions["divisions"]>> {
	const { rows } = await dr.execute(sql`
		SELECT "id"::text AS id,
			COALESCE("name" ->> ${lang}, "name" ->> 'en', "national_id", "id"::text) AS name,
			"level"::int AS level,
			"parent_id"::text AS "parentId"
		FROM "division"
		WHERE "level" IN (1, 2) AND "country_accounts_id" = ${countryAccountsId}
		ORDER BY "level", 2`);
	return (rows as { id: string; name: string; level: number; parentId: string | null }[]).map((r) => ({
		id: r.id,
		name: r.name,
		level: Number(r.level),
		parentId: r.parentId,
	}));
}

const FIRST_YEAR = 1900;

/**
 * The tenant's first and last record years. Dates are ISO text (YYYY,
 * YYYY-MM or YYYY-MM-DD), so a text range and MIN/MAX give the bounds
 * without parsing every row (about 1 s on the largest tenant, against 9 s
 * when parsing). Cached per tenant with the dashboard loaders.
 */
function recordYears(countryAccountsId: string): Promise<{ min: number; max: number }> {
	const thisYear = new Date().getFullYear();
	return cachedDashboard("filterYears", [{ countryAccountsId }], async () => {
		const { rows } = await dr.execute(sql`
			SELECT left(MIN("start_date"), 4) AS min, left(MAX("start_date"), 4) AS max
			FROM "disaster_records"
			WHERE "country_accounts_id" = ${countryAccountsId}
				AND "start_date" >= ${String(FIRST_YEAR)} AND "start_date" < ${String(thisYear + 1)}`);
		const r = (rows as { min: string | null; max: string | null }[])[0];
		const min = Number(r?.min);
		const max = Number(r?.max);
		return {
			min: Number.isInteger(min) && min >= FIRST_YEAR ? min : FIRST_YEAR,
			max: Number.isInteger(max) && max <= thisYear ? max : thisYear,
		};
	});
}

export async function getDashboardFilterOptions(
	countryAccountsId: string,
	query: DeltaQuery,
	audience: ApprovalAudience,
	lang: string,
): Promise<DashboardFilterOptions> {
	const [tree, divisions, regions, years] = await Promise.all([
		// The tree counts records under each node; the bar disables empty ones.
		getHazardTree(countryAccountsId, { query, audience, notApplied: [] }, lang).catch(() => null),
		placeDivisions(countryAccountsId, lang).catch(() => []),
		listRegions(countryAccountsId, lang).catch(() => []),
		recordYears(countryAccountsId).catch(() => ({ min: FIRST_YEAR, max: new Date().getFullYear() })),
	]);
	return {
		// Geoportal's flattener: the nested G6 tree to the bar's three lists.
		hazardTree: flattenHazardTree(tree as NestedHazardTree | null),
		place: {
			divisions,
			regions: regions.map((r) => ({ regionId: r.regionId, name: r.name, kind: r.kind })),
		},
		years,
	};
}
