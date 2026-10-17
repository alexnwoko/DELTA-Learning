// What the shared filter bar needs on the Analysis dashboard: the HIPs
// hazard tree (with record counts, for the hazard drop-downs and chips),
// the tenant's level-1 divisions and its regions (the "Area" control).
// Server only. Each part fails soft: a missing part hides its control
// rather than breaking the page.
import { sql } from "drizzle-orm";
import { dr } from "~/db.server";
import { getHazardTree } from "~/backend.server/models/geo/queries";
import { listRegions } from "~/backend.server/models/geo/regions";
import { flattenHazardTree, type HazardTree, type NestedHazardTree } from "~/frontend/geoportal/GeoFilterBar";
import type { PlaceOptions } from "~/frontend/geoportal/filterBarState";
import type { ApprovalAudience } from "~/utils/approvalBasis";
import type { DeltaQuery } from "~/utils/deltaQuery";

export interface DashboardFilterOptions {
	hazardTree: HazardTree | null;
	place: PlaceOptions;
}

async function levelOneDivisions(countryAccountsId: string, lang: string): Promise<NonNullable<PlaceOptions["divisions"]>> {
	const { rows } = await dr.execute(sql`
		SELECT "id"::text AS id,
			COALESCE("name" ->> ${lang}, "name" ->> 'en', "national_id", "id"::text) AS name
		FROM "division"
		WHERE "level" = 1 AND "country_accounts_id" = ${countryAccountsId}
		ORDER BY 2`);
	return (rows as { id: string; name: string }[]).map((r) => ({ id: r.id, name: r.name, level: 1, parentId: null }));
}

export async function getDashboardFilterOptions(
	countryAccountsId: string,
	query: DeltaQuery,
	audience: ApprovalAudience,
	lang: string,
): Promise<DashboardFilterOptions> {
	const [tree, divisions, regions] = await Promise.all([
		// The tree counts records under each node; the bar disables empty ones.
		getHazardTree(countryAccountsId, { query, audience, notApplied: [] }, lang).catch(() => null),
		levelOneDivisions(countryAccountsId, lang).catch(() => []),
		listRegions(countryAccountsId, lang).catch(() => []),
	]);
	return {
		// Geoportal's flattener: the nested G6 tree to the bar's three lists.
		hazardTree: flattenHazardTree(tree as NestedHazardTree | null),
		place: {
			divisions,
			regions: regions.map((r) => ({ regionId: r.regionId, name: r.name, kind: r.kind })),
		},
	};
}
