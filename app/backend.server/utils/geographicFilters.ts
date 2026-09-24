import { SQL, sql, eq, and, or, exists, inArray } from "drizzle-orm";
import { dr } from "~/db.server";
import { divisionTable } from "~/drizzle/schema/divisionTable";
import { disasterRecordsDivisionTable } from "~/drizzle/schema/disasterRecordsDivisionTable";
import { disasterRecordsGeomTable } from "~/drizzle/schema/disasterRecordsGeomTable";
import createLogger from "~/utils/logger.server";

// Create logger for this geographic filtering module
const logger = createLogger("backend.server/utils/geographicFilters");

export interface GeographicFilter {
	id: string;
	names: Record<string, string>;
	geometry: any;
}

const divisionCache = new Map<string, GeographicFilter>();

export async function getDivisionInfo(
	geographicLevelId: string,
): Promise<GeographicFilter | null> {
	logger.info("Fetching division information", {
		geographicLevelId,
		cacheHit: divisionCache.has(geographicLevelId),
	});

	const cached = divisionCache.get(geographicLevelId);
	if (cached) {
		logger.debug("Division info retrieved from cache", {
			geographicLevelId,
			divisionId: cached.id,
		});
		return cached;
	}

	try {
		const division = await dr
			.select({
				id: divisionTable.id,
				name: divisionTable.name,
				geom: divisionTable.geom,
			})
			.from(divisionTable)
			.where(eq(divisionTable.id, geographicLevelId))
			.limit(1);

		if (!division || division.length === 0) {
			logger.warn("Division not found in database", {
				geographicLevelId,
				issue: "no matching division record",
			});
			return null;
		}

		const result: GeographicFilter = {
			id: division[0].id,
			names: division[0].name as Record<string, string>,
			geometry: division[0].geom,
		};

		divisionCache.set(geographicLevelId, result);

		logger.info("Division info successfully retrieved and cached", {
			geographicLevelId,
			divisionId: result.id,
			hasGeometry: !!result.geometry,
			availableNames: Object.keys(result.names),
			cacheSize: divisionCache.size,
		});

		return result;
	} catch (error) {
		logger.error("Error fetching division information", {
			geographicLevelId,
			error: error instanceof Error ? error.message : "Unknown error",
			stack: error instanceof Error ? error.stack : undefined,
		});
		return null;
	}
}

/**
 * Returns the division and all of its descendants. Descent stays within the
 * root division's tenant; when countryAccountsId is given, the root must
 * belong to that tenant or the result is empty.
 */
export async function getDescendantDivisionIds(
	divisionId: string,
	countryAccountsId?: string,
): Promise<string[]> {
	const tenantCheck = countryAccountsId
		? sql`AND country_accounts_id = ${countryAccountsId}`
		: sql``;
	const res = await dr.execute(sql`
		WITH RECURSIVE tree AS (
			SELECT id, country_accounts_id FROM ${divisionTable}
			WHERE id = ${divisionId} ${tenantCheck}
			UNION
			SELECT d.id, d.country_accounts_id FROM ${divisionTable} d
			JOIN tree t ON d.parent_id = t.id
				AND d.country_accounts_id IS NOT DISTINCT FROM t.country_accounts_id
		)
		SELECT id FROM tree
	`);
	return res.rows.map((r) => String(r.id));
}

/**
 * True when a disaster record falls within a division: it is linked to the
 * division or one of its descendants (disaster_records_division), or one of
 * its drawn geometries intersects the division (disaster_records_geom).
 */
export function recordInDivisionCondition(
	disasterRecordsTable: any,
	divisionId: string,
	descendantIds: string[],
): SQL {
	return or(
		exists(
			dr
				.select({ one: sql`1` })
				.from(disasterRecordsDivisionTable)
				.where(
					and(
						eq(
							disasterRecordsDivisionTable.disasterRecordId,
							disasterRecordsTable.id,
						),
						inArray(disasterRecordsDivisionTable.divisionId, descendantIds),
					),
				),
		),
		exists(
			dr
				.select({ one: sql`1` })
				.from(disasterRecordsGeomTable)
				.innerJoin(divisionTable, eq(divisionTable.id, divisionId))
				.where(
					and(
						eq(
							disasterRecordsGeomTable.disasterRecordId,
							disasterRecordsTable.id,
						),
						sql`ST_Intersects(${disasterRecordsGeomTable.geom}, ${divisionTable.geom})`,
					),
				),
		),
	)!;
}

/**
 * Restricts disaster records to a division. Fails closed: if the filter cannot
 * be built, no record matches, so national figures are never shown under a
 * division's name.
 */
export async function applyGeographicFilters(
	divisionInfo: GeographicFilter,
	disasterRecordsTable: any,
	baseConditions: SQL[],
	_rawSpatialData: any[] | null = null,
): Promise<SQL[]> {
	if (!divisionInfo?.id) {
		logger.warn("No valid division info provided for geographic filtering", {
			hasDivisionInfo: !!divisionInfo,
			divisionId: divisionInfo?.id,
		});
		return baseConditions;
	}

	const divisionId = divisionInfo.id;

	try {
		const descendantIds = await getDescendantDivisionIds(divisionId);
		if (descendantIds.length === 0) {
			baseConditions.push(sql`FALSE`);
			return baseConditions;
		}

		baseConditions.push(
			recordInDivisionCondition(
				disasterRecordsTable,
				divisionId,
				descendantIds,
			),
		);

		logger.info("Geographic filter applied", {
			divisionId,
			descendantDivisionsIncluded: descendantIds.length,
		});

		return baseConditions;
	} catch (error) {
		logger.error("Error applying geographic filters; failing closed", {
			divisionId,
			error: error instanceof Error ? error.message : "Unknown error",
			stack: error instanceof Error ? error.stack : undefined,
		});
		baseConditions.push(sql`FALSE`);
		return baseConditions;
	}
}
