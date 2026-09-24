import { eq, sql, SQL, and, inArray, exists, or, not } from "drizzle-orm";
import { dr } from "~/db.server";
import createLogger from "~/utils/logger.server";

// Initialize logger for this module
const logger = createLogger("backend.server/models/analytics/geographicImpact");
import { sectorDisasterRecordsRelationTable } from "~/drizzle/schema/sectorDisasterRecordsRelationTable";
import { sectorTable } from "~/drizzle/schema/sectorTable";
import { disasterRecordsTable } from "~/drizzle/schema/disasterRecordsTable";
import { lossesTable } from "~/drizzle/schema/lossesTable";
import { damagesTable } from "~/drizzle/schema/damagesTable";
import { disasterEventTable } from "~/drizzle/schema/disasterEventTable";
import { disasterRecordsDivisionTable } from "~/drizzle/schema/disasterRecordsDivisionTable";
import { disasterRecordsGeomTable } from "~/drizzle/schema/disasterRecordsGeomTable";
import {
	divisionTable,
	type SelectDivision,
} from "~/drizzle/schema/divisionTable";
import { createAssessmentMetadata } from "~/backend.server/utils/disasterCalculations";
import type { DisasterImpactMetadata } from "~/types/disasterCalculations";
import {
	parseFlexibleDate,
	createDateCondition,
	extractYearFromDate,
} from "~/backend.server/utils/dateFilters";

export interface GeographicImpactFilters {
	sectorId?: string;
	subSectorId?: string;
	hazardTypeId?: string;
	hazardClusterId?: string;
	specificHazardId?: string;
	fromDate?: string;
	toDate?: string;
	disasterEventId?: string;
	/**
	 * Assessment type following UNDRR Technical Guidance:
	 * - 'rapid': Quick assessment within first 2 weeks
	 * - 'detailed': Comprehensive assessment after 2+ weeks
	 */
	assessmentType?: "rapid" | "detailed";
	/**
	 * Confidence level based on World Bank DaLA methodology:
	 * - 'low': Limited data availability or rapid assessment
	 * - 'medium': Partial data with some field verification
	 * - 'high': Complete data with full field verification
	 */
	confidenceLevel?: "low" | "medium" | "high";
	geographicLevelId?: string;
}

/**
 * Interface for geographic impact query filters
 * Based on UNDRR's spatial data requirements
 */
interface GeographicFilters {
	/** Start date for impact period */
	startDate?: string | null;
	/** End date for impact period */
	endDate?: string | null;
	/** Specific hazard type filter */
	hazardType?: string | null;
	/** Hazard cluster for grouped analysis */
	hazardCluster?: string | null;
	/** Individual hazard identifier */
	specificHazard?: string | null;
	/** Administrative level for aggregation */
	geographicLevel?: number | null;
	/** Specific event identifier */
	disasterEvent?: string | null;
	/** Disaster event identifier */
	_disasterEventId?: string | null;
	/** Assessment type (rapid/detailed) */
	assessmentType?: "rapid" | "detailed";
	/** Data confidence level */
	confidenceLevel?: "low" | "medium" | "high";
	/** Sector ID for filtering */
	sectorId?: string;
}

interface CleanDivisionValues {
	totalDamage: number | null;
	totalLoss: number | null;
	metadata: DisasterImpactMetadata;
	dataAvailability: "available" | "no_data" | "zero";
}

interface GeographicImpactResult {
	success: boolean;
	divisions: SelectDivision[];
	values: { [key: string]: CleanDivisionValues };
	error?: string;
}

interface GeoJSONGeometry {
	type: string;
	coordinates: number[] | number[][] | number[][][] | number[][][][];
}

interface GeoJSONFeature {
	type: "Feature";
	geometry: GeoJSONGeometry;
	properties?: Record<string, any>;
}

interface GeoJSONFeatureCollection {
	type: "FeatureCollection";
	features: GeoJSONFeature[];
}

// Helper function to safely convert money values
function safeMoneyToNumber(value: string | number | null): number {
	try {
		if (value === null || value === undefined) {
			return 0;
		}

		// Handle string values (most common from SQL queries)
		if (typeof value === "string") {
			// Remove any currency symbols or commas
			const cleanValue = value.replace(/[$,]/g, "").trim();
			if (!cleanValue) {
				return 0;
			}

			const parsed = parseFloat(cleanValue);
			const result = isNaN(parsed) ? 0 : parsed;
			return result;
		}

		// Handle numeric values
		const result = typeof value === "number" ? value : 0;
		return result;
	} catch (error) {
		console.error("[MONEY_CONVERT] Error converting money value:", {
			error: error instanceof Error ? error.message : String(error),
			value: value?.toString(),
			stack: error instanceof Error ? error.stack : undefined,
		});
		logger.error("Error converting money value", {
			error: error instanceof Error ? error.message : String(error),
			value: value?.toString(),
		});
		return 0;
	}
}

// Gets all subsector IDs for a given sector and its subsectors following international standards.
// This implementation uses the proper hierarchical structure defined in the sector table
// rather than relying on ID patterns, making it suitable for all countries.
//
// @param sectorId - The ID of the sector to get subsectors for
// @returns Array of sector IDs including the input sector and all its subsectors
const getAllSubsectorIds = async (sectorId: string): Promise<string[]> => {
	try {
		// First get the level of the input sector
		const sectorInfo = await dr
			.select({
				id: sectorTable.id,
				level: sectorTable.level,
			})
			.from(sectorTable)
			.where(eq(sectorTable.id, sectorId));

		if (sectorInfo.length === 0) {
			return [];
		}

		const level = sectorInfo[0].level;

		// If it's already a level 4 sector (most detailed), just return itself
		if (level === 4) {
			return [sectorId];
		}

		// FOR PARENT SECTORS: Get all descendant subsectors recursively

		// Get all sectors to build the hierarchy
		const allSectors = await dr
			.select({
				id: sectorTable.id,
				parentId: sectorTable.parentId,
				level: sectorTable.level,
			})
			.from(sectorTable);

		// Build a map of parent -> children
		const childrenMap = new Map<string, string[]>();
		for (const sector of allSectors) {
			if (sector.parentId) {
				if (!childrenMap.has(sector.parentId)) {
					childrenMap.set(sector.parentId, []);
				}
				childrenMap.get(sector.parentId)!.push(sector.id);
			}
		}

		// Recursively get all descendants
		const getAllDescendants = (parentId: string): string[] => {
			const children = childrenMap.get(parentId) || [];
			let descendants = [...children];

			for (const child of children) {
				descendants.push(...getAllDescendants(child));
			}

			return descendants;
		};

		const descendants = getAllDescendants(sectorId);
		const allSectorIds = [sectorId, ...descendants]; // Include parent + all descendants

		return allSectorIds;
	} catch (error) {
		return [];
	}
};

/**
 * Validates if a value is a properly formatted GeoJSON object
 * Following OGC GeoJSON standard requirements
 */
function isValidGeoJSON(value: any): boolean {
	try {
		if (!value || typeof value !== "object") {
			return false;
		}

		// If it's already parsed JSON, check for required properties
		if (typeof value === "object") {
			// Check for required GeoJSON properties
			const isValid =
				(value.type === "Feature" && value.geometry) ||
				(value.type === "FeatureCollection" && Array.isArray(value.features)) ||
				[
					"Point",
					"LineString",
					"Polygon",
					"MultiPoint",
					"MultiLineString",
					"MultiPolygon",
					"GeometryCollection",
				].includes(value.type);

			return isValid;
		}
		return false;
	} catch (error) {
		logger.error("Error validating GeoJSON", {
			error: error instanceof Error ? error.message : String(error),
			value: value?.toString(),
		});
		return false;
	}
}

export async function getGeographicImpact(
	countryAccountsId: string,
	filters: GeographicImpactFilters,
): Promise<GeographicImpactResult> {
	try {
		// Get sector IDs based on selection
		let sectorIds: string[] = [];

		if (filters.subSectorId) {
			// If subsector is selected, only use that ID
			const parsedSubSectorId = filters.subSectorId;
			sectorIds = await getAllSubsectorIds(parsedSubSectorId);
		} else if (filters.sectorId) {
			// If only parent sector is selected, get all its subsectors
			sectorIds = await getAllSubsectorIds(filters.sectorId);
		} else {
		}

		if (filters.sectorId && sectorIds.length === 0) {
			return {
				success: false,
				divisions: [],
				values: {},
				error: "Invalid sector ID",
			};
		}

		// Create assessment metadata with all required fields
		const metadata = await createAssessmentMetadata(
			filters.assessmentType || "rapid",
			filters.confidenceLevel || "low",
		);

		// Get divisions with complete fields and apply geographic level filter
		const baseDivisionsQuery = dr
			.select({
				id: divisionTable.id,
				parentId: divisionTable.parentId,
				name: divisionTable.name,
				nationalId: divisionTable.nationalId,
				level: divisionTable.level,
				geojson: divisionTable.geojson,
				geom: divisionTable.geom,
				bbox: divisionTable.bbox,
				spatial_index: divisionTable.spatial_index,
				importId: divisionTable.importId,
				countryAccountsId: divisionTable.countryAccountsId,
			})
			.from(divisionTable)
			.where(
				and(
					eq(divisionTable.level, 1),
					eq(divisionTable.countryAccountsId, countryAccountsId),
					filters.geographicLevelId
						? eq(divisionTable.id, filters.geographicLevelId)
						: undefined,
				),
			);

		let divisions: SelectDivision[] = [];
		try {
			divisions = await baseDivisionsQuery;

			if (!divisions || divisions.length === 0) {
				return {
					success: false,
					divisions: [],
					values: {},
					error: "No divisions found for the given criteria",
				};
			}
		} catch (error) {
			console.error("[GEOGRAPHIC_IMPACT] Error fetching divisions:", {
				countryAccountsId,
				geographicLevelId: filters.geographicLevelId,
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
			});
			return {
				success: false,
				divisions: [],
				values: {},
				error: "Failed to fetch geographic divisions",
			};
		}

		// Create a map to store values for each division
		const values: { [key: string]: CleanDivisionValues } = {};

		await Promise.all(
			divisions.map(async (division, _index) => {
				try {
					const disasterRecords = await getDisasterRecordsForDivision(
						countryAccountsId,
						division.id,
						{
							startDate: filters.fromDate,
							endDate: filters.toDate,
							hazardType: filters.hazardTypeId,
							hazardCluster: filters.hazardClusterId,
							specificHazard: filters.specificHazardId,
							disasterEvent: filters.disasterEventId,
							assessmentType: filters.assessmentType,
							confidenceLevel: filters.confidenceLevel,
						},
						sectorIds,
					);

					if (!disasterRecords || disasterRecords.length === 0) {
						values[division.id.toString()] = {
							totalDamage: 0,
							totalLoss: 0,
							metadata,
							dataAvailability: "no_data",
						};
						return;
					}

					const [damageResult, lossResult] = await Promise.all([
						aggregateDamagesData(disasterRecords, sectorIds),
						aggregateLossesData(disasterRecords, sectorIds),
					]);

					const totalDamage = damageResult.total;
					const totalLoss = lossResult.total;

					const byYear: Map<number, number> = new Map(damageResult.byYear);
					for (const [year, value] of lossResult.byYear) {
						byYear.set(year, (byYear.get(year) || 0) + value);
					}

					values[division.id.toString()] = {
						totalDamage,
						totalLoss,
						metadata,
						dataAvailability:
							totalDamage > 0 || totalLoss > 0 ? "available" : "zero",
					};
				} catch (error) {
					console.error(
						`[DIVISION_PROCESS] Error processing division ${division.id}:`,
						{
							divisionId: division.id,
							error: error instanceof Error ? error.message : String(error),
							stack: error instanceof Error ? error.stack : undefined,
						},
					);
					values[division.id.toString()] = {
						totalDamage: 0,
						totalLoss: 0,
						metadata,
						dataAvailability: "no_data",
					};
				}
			}),
		);

		return {
			success: true,
			divisions,
			values,
		};
	} catch (error) {
		console.error(
			"[GEOGRAPHIC_IMPACT] Critical error in getGeographicImpact:",
			{
				countryAccountsId,
				filters,
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
			},
		);
		return {
			success: false,
			divisions: [],
			values: {},
			error: `Error processing geographic impact: ${
				error instanceof Error ? error.message : String(error)
			}`,
		};
	}
}

/**
 * Returns the division and all of its descendants, within one tenant.
 */
export async function getDescendantDivisionIds(
	divisionId: string,
	countryAccountsId: string,
): Promise<string[]> {
	const res = await dr.execute(sql`
		WITH RECURSIVE tree AS (
			SELECT id FROM ${divisionTable}
			WHERE id = ${divisionId}
				AND country_accounts_id = ${countryAccountsId}
			UNION
			SELECT d.id FROM ${divisionTable} d
			JOIN tree t ON d.parent_id = t.id
			WHERE d.country_accounts_id = ${countryAccountsId}
		)
		SELECT id FROM tree
	`);
	return res.rows.map((r) => String(r.id));
}

const UUID_REGEX =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Matches records to a disaster event, by id or by a text search across the
 * event's name and identifiers (any field may match).
 */
function disasterEventCondition(eventId: string): SQL {
	if (UUID_REGEX.test(eventId)) {
		return eq(disasterRecordsTable.disasterEventId, eventId);
	}
	const pattern = `%${eventId.toLowerCase()}%`;
	return exists(
		dr
			.select({ one: sql`1` })
			.from(disasterEventTable)
			.where(
				and(
					eq(disasterEventTable.id, disasterRecordsTable.disasterEventId),
					or(
						sql`LOWER(${disasterEventTable.nameNational}::text) LIKE ${pattern}`,
						sql`LOWER(${disasterEventTable.id}::text) LIKE ${pattern}`,
						sql`LOWER(${disasterEventTable.glide}) LIKE ${pattern}`,
						sql`LOWER(${disasterEventTable.nationalDisasterId}) LIKE ${pattern}`,
						sql`LOWER(${disasterEventTable.otherId1}) LIKE ${pattern}`,
					),
				),
			),
	);
}

/**
 * Record-level filters shared by every division query: tenant, published
 * status, HIPs classification, sector, date range and disaster event.
 *
 * The hazard classification is read from the record itself, as in
 * hazard-analysis.ts, so records without a linked disaster event still count.
 */
function buildRecordConditions(
	countryAccountsId: string,
	filters: GeographicFilters | undefined,
	sectorIds: string[],
): SQL[] {
	const conditions: SQL[] = [
		eq(disasterRecordsTable.countryAccountsId, countryAccountsId),
		sql`${disasterRecordsTable.approvalStatus} = 'published'`,
	];

	if (filters?.hazardType) {
		conditions.push(eq(disasterRecordsTable.hipTypeId, filters.hazardType));
	}
	if (filters?.hazardCluster) {
		conditions.push(
			eq(disasterRecordsTable.hipClusterId, filters.hazardCluster),
		);
	}
	if (filters?.specificHazard) {
		conditions.push(
			eq(disasterRecordsTable.hipHazardId, filters.specificHazard),
		);
	}

	if (sectorIds.length > 0) {
		conditions.push(
			exists(
				dr
					.select({ one: sql`1` })
					.from(sectorDisasterRecordsRelationTable)
					.where(
						and(
							eq(
								sectorDisasterRecordsRelationTable.disasterRecordId,
								disasterRecordsTable.id,
							),
							inArray(sectorDisasterRecordsRelationTable.sectorId, sectorIds),
						),
					),
			),
		);
	}

	if (filters?.startDate) {
		const from = parseFlexibleDate(filters.startDate);
		if (from) {
			conditions.push(
				createDateCondition(disasterRecordsTable.startDate, from, "gte"),
			);
		}
	}
	if (filters?.endDate) {
		const to = parseFlexibleDate(filters.endDate);
		if (to) {
			conditions.push(
				createDateCondition(disasterRecordsTable.endDate, to, "lte"),
			);
		}
	}

	if (filters?.disasterEvent) {
		conditions.push(disasterEventCondition(filters.disasterEvent));
	}

	return conditions;
}

/**
 * Finds the published records that fall within a division.
 *
 * A record falls within a division when it is linked to the division or one
 * of its descendants (disaster_records_division), or when one of its drawn
 * geometries intersects the division (disaster_records_geom).
 */
async function getDisasterRecordsForDivision(
	countryAccountsId: string,
	divisionId: string,
	filters?: GeographicFilters,
	sectorIds: string[] = [],
): Promise<string[]> {
	try {
		const descendantIds = await getDescendantDivisionIds(
			divisionId,
			countryAccountsId,
		);
		if (descendantIds.length === 0) {
			return [];
		}

		const linkedToDivision = exists(
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
		);

		const geometryInDivision = exists(
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
		);

		const rows = await dr
			.selectDistinct({ id: disasterRecordsTable.id })
			.from(disasterRecordsTable)
			.where(
				and(
					...buildRecordConditions(countryAccountsId, filters, sectorIds),
					or(linkedToDivision, geometryInDivision),
				),
			);

		return rows.map((r) => r.id);
	} catch (error) {
		console.error(
			"[DISASTER_RECORDS] Critical error getting disaster records:",
			{
				divisionId,
				countryAccountsId,
				error: error instanceof Error ? error.message : String(error),
				stack: error instanceof Error ? error.stack : undefined,
			},
		);
		return [];
	}
}

export async function fetchGeographicImpactData(
	countryAccountsId: string,
	divisionId: string,
	filters?: GeographicFilters,
): Promise<{
	totalDamage: number;
	totalLoss: number;
	byYear: Map<number, number>;
	metadata?: DisasterImpactMetadata;
}> {
	try {
		// Validate division ID
		if (!divisionId) {
			return {
				totalDamage: 0,
				totalLoss: 0,
				byYear: new Map(),
				metadata: await createAssessmentMetadata("rapid", "low"),
			};
		}

		// Get disaster records for the division with improved spatial handling
		const recordIds = await getDisasterRecordsForDivision(
			countryAccountsId,
			divisionId,
			filters,
		);

		if (recordIds.length === 0) {
			return {
				totalDamage: 0,
				totalLoss: 0,
				byYear: new Map(),
				metadata: await createAssessmentMetadata("rapid", "low"),
			};
		}

		// Aggregate damages and losses with proper numeric handling
		const damageResult = await aggregateDamagesData(recordIds, []);
		const lossResult = await aggregateLossesData(recordIds, []);

		const { total: totalDamage } = damageResult;
		const { total: totalLoss } = lossResult;

		// Merge the yearly breakdowns
		const byYear: Map<number, number> = new Map();
		for (const [year, value] of damageResult.byYear) {
			byYear.set(year, value);
		}
		for (const [year, value] of lossResult.byYear) {
			if (byYear.has(year)) {
				byYear.set(year, byYear.get(year)! + value);
			} else {
				byYear.set(year, value);
			}
		}

		// Create assessment metadata following international standards
		const metadata = await createAssessmentMetadata(
			filters?.assessmentType || "rapid",
			filters?.confidenceLevel || "low",
		);

		return {
			totalDamage,
			totalLoss,
			byYear,
			metadata,
		};
	} catch (error) {
		console.error("[FETCH_IMPACT] Error fetching geographic impact data:", {
			countryAccountsId,
			divisionId,
			error: error instanceof Error ? error.message : String(error),
			stack: error instanceof Error ? error.stack : undefined,
		});
		return {
			totalDamage: 0,
			totalLoss: 0,
			byYear: new Map(),
			metadata: await createAssessmentMetadata("rapid", "low"),
		};
	}
}

/**
 * Aggregates damage costs by year across disaster records.
 *
 * Uses two calculation paths that are merged:
 * 1. **Sector overrides**: where `withDamage = true` and `damageCost IS NOT NULL` in
 *    `sector_disaster_records_relation` — uses the SDR cost directly
 * 2. **Detailed damages**: where no override exists — calculates using the formula:
 *    `pdDamageAmount * pdRepairCostUnit + tdDamageAmount * tdReplacementCostUnit`
 *
 * The `NOT EXISTS` subquery on path 2 excludes records that have an override on path 1,
 * preventing double-counting. Results from both paths are merged by year.
 */
async function aggregateDamagesData(
	recordIds: string[],
	sectorIds?: string[],
): Promise<{ total: number; byYear: Map<number, number> }> {
	try {
		if (recordIds.length === 0) {
			return { total: 0, byYear: new Map() };
		}

		const yearExpr = extractYearFromDate(disasterRecordsTable.startDate);

		// First get sector overrides
		const sectorOverrides = await dr
			.select({
				year: yearExpr.as("year"),
				totalDamage: sql<string>`COALESCE(SUM(
                    CASE 
                        WHEN ${sectorDisasterRecordsRelationTable.withDamage} = true AND ${sectorDisasterRecordsRelationTable.damageCost} IS NOT NULL
 THEN
                            COALESCE(${sectorDisasterRecordsRelationTable.damageCost}, 0)::numeric
                        ELSE 0
                    END
                ), 0)`,
			})
			.from(disasterRecordsTable)
			.innerJoin(
				sectorDisasterRecordsRelationTable,
				eq(
					sectorDisasterRecordsRelationTable.disasterRecordId,
					disasterRecordsTable.id,
				),
			)
			.where(
				and(
					inArray(disasterRecordsTable.id, recordIds),
					sectorIds?.length
						? inArray(sectorDisasterRecordsRelationTable.sectorId, sectorIds)
						: undefined,
				),
			)
			.groupBy(disasterRecordsTable.startDate)
			.orderBy(yearExpr);

		// Then get detailed damages
		const detailedDamages = await dr
			.select({
				year: yearExpr.as("year"),
				totalDamage: sql<string>`COALESCE(SUM(
                    CASE 
                        WHEN ${damagesTable.totalRepairReplacementOverride} = true THEN
                            COALESCE(${damagesTable.totalRepairReplacement}, 0)::numeric
                        ELSE
                            COALESCE(${damagesTable.pdDamageAmount}, 0)::numeric * COALESCE(${damagesTable.pdRepairCostUnit}, 0)::numeric +
                            COALESCE(${damagesTable.tdDamageAmount}, 0)::numeric * COALESCE(${damagesTable.tdReplacementCostUnit}, 0)::numeric
                    END
                ), 0)`,
			})
			.from(disasterRecordsTable)
			.innerJoin(
				damagesTable,
				eq(damagesTable.recordId, disasterRecordsTable.id),
			)
			.where(
				and(
					inArray(disasterRecordsTable.id, recordIds),
					sectorIds?.length
						? inArray(damagesTable.sectorId, sectorIds)
						: undefined,
					not(
						exists(
							dr
								.select()
								.from(sectorDisasterRecordsRelationTable)
								.where(
									and(
										eq(
											sectorDisasterRecordsRelationTable.disasterRecordId,
											disasterRecordsTable.id,
										),
										eq(sectorDisasterRecordsRelationTable.withDamage, true),
										sql`${sectorDisasterRecordsRelationTable.damageCost} IS NOT NULL`,
										sectorIds?.length
											? inArray(
													sectorDisasterRecordsRelationTable.sectorId,
													sectorIds,
												)
											: undefined,
									),
								),
						),
					),
				),
			)
			.groupBy(disasterRecordsTable.startDate)
			.orderBy(yearExpr);

		// Process results with safe numeric conversion
		let total = 0;
		const byYear = new Map<number, number>();

		// Process sector overrides first
		for (const row of sectorOverrides) {
			const year = Number(row.year);
			if (isNaN(year)) {
				continue;
			}

			const damage = safeMoneyToNumber(row.totalDamage);
			total += damage;
			byYear.set(year, (byYear.get(year) || 0) + damage);
		}

		// Then add detailed damages where there are no overrides
		for (const row of detailedDamages) {
			const year = Number(row.year);
			if (isNaN(year)) {
				continue;
			}

			const damage = safeMoneyToNumber(row.totalDamage);

			total += damage;
			byYear.set(year, (byYear.get(year) || 0) + damage);
		}

		return { total, byYear };
	} catch (error) {
		console.error("[DAMAGE_AGGREGATION] Error aggregating damages data:", {
			recordIds: recordIds.slice(0, 5),
			sectorIds: sectorIds?.slice(0, 5),
			error: error instanceof Error ? error.message : String(error),
			stack: error instanceof Error ? error.stack : undefined,
		});
		return { total: 0, byYear: new Map() };
	}
}

/**
 * Aggregates loss costs by year across disaster records.
 *
 * Same dual-path structure as `aggregateDamagesData` but for losses. The detailed
 * loss calculation is more complex because it has two independent override flags:
 * - `publicCostTotalOverride`: if true, uses `publicCostTotal` directly; otherwise
 *   calculates `publicUnits * publicCostUnit`
 * - `privateCostTotalOverride`: if true, uses `privateCostTotal` directly; otherwise
 *   calculates `privateUnits * privateCostUnit`
 *
 * Total loss per row = public portion + private portion.
 * The `NOT EXISTS` subquery checks for `withLosses = true` and `lossesCost IS NOT NULL`.
 */
async function aggregateLossesData(
	recordIds: string[],
	sectorIds?: string[],
): Promise<{ total: number; byYear: Map<number, number> }> {
	try {
		if (recordIds.length === 0) {
			return { total: 0, byYear: new Map() };
		}

		const yearExpr = extractYearFromDate(disasterRecordsTable.startDate);

		// First get sector overrides
		const sectorOverrides = await dr
			.select({
				year: yearExpr.as("year"),
				totalLoss: sql<string>`COALESCE(SUM(
                    CASE 
                        WHEN ${sectorDisasterRecordsRelationTable.withLosses} = true AND ${sectorDisasterRecordsRelationTable.lossesCost} IS NOT NULL THEN
                            COALESCE(${sectorDisasterRecordsRelationTable.lossesCost}, 0)::numeric
                        ELSE 0
                    END
                ), 0)`,
			})
			.from(disasterRecordsTable)
			.innerJoin(
				sectorDisasterRecordsRelationTable,
				eq(
					sectorDisasterRecordsRelationTable.disasterRecordId,
					disasterRecordsTable.id,
				),
			)
			.where(
				and(
					inArray(disasterRecordsTable.id, recordIds),
					sectorIds?.length
						? inArray(sectorDisasterRecordsRelationTable.sectorId, sectorIds)
						: undefined,
				),
			)
			.groupBy(disasterRecordsTable.startDate)
			.orderBy(yearExpr);

		// Then get detailed losses
		const detailedLosses = await dr
			.select({
				year: yearExpr.as("year"),
				totalLoss: sql<string>`COALESCE(SUM(
                    CASE 
                        WHEN ${lossesTable.publicCostTotalOverride} = true THEN
                            COALESCE(${lossesTable.publicCostTotal}, 0)::numeric
                        ELSE
                            COALESCE(${lossesTable.publicUnits}, 0)::numeric * COALESCE(${lossesTable.publicCostUnit}, 0)::numeric +
                            COALESCE(${lossesTable.privateCostTotal}, 0)::numeric
                    END +
                    CASE 
                        WHEN ${lossesTable.privateCostTotalOverride} = true THEN
                            COALESCE(${lossesTable.privateCostTotal}, 0)::numeric
                        ELSE
                            COALESCE(${lossesTable.privateUnits}, 0)::numeric * COALESCE(${lossesTable.privateCostUnit}, 0)::numeric
                    END
                ), 0)`,
			})
			.from(disasterRecordsTable)
			.innerJoin(lossesTable, eq(lossesTable.recordId, disasterRecordsTable.id))
			.where(
				and(
					inArray(disasterRecordsTable.id, recordIds),
					sectorIds?.length
						? inArray(lossesTable.sectorId, sectorIds)
						: undefined,
					not(
						exists(
							dr
								.select()
								.from(sectorDisasterRecordsRelationTable)
								.where(
									and(
										eq(
											sectorDisasterRecordsRelationTable.disasterRecordId,
											disasterRecordsTable.id,
										),
										eq(sectorDisasterRecordsRelationTable.withLosses, true),
										sql`${sectorDisasterRecordsRelationTable.lossesCost} IS NOT NULL`,
										sectorIds?.length
											? inArray(
													sectorDisasterRecordsRelationTable.sectorId,
													sectorIds,
												)
											: undefined,
									),
								),
						),
					),
				),
			)
			.groupBy(disasterRecordsTable.startDate)
			.orderBy(yearExpr);

		// Process results with safe numeric conversion
		let total = 0;
		const byYear = new Map<number, number>();

		// Process sector overrides first
		for (const row of sectorOverrides) {
			const year = Number(row.year);
			if (isNaN(year)) {
				continue;
			}

			const loss = safeMoneyToNumber(row.totalLoss);

			total += loss;
			byYear.set(year, (byYear.get(year) || 0) + loss);
		}

		// Then add detailed losses where there are no overrides
		for (const row of detailedLosses) {
			const year = Number(row.year);
			if (isNaN(year)) {
				continue;
			}

			const loss = safeMoneyToNumber(row.totalLoss);

			total += loss;
			byYear.set(year, (byYear.get(year) || 0) + loss);
		}

		return { total, byYear };
	} catch (error) {
		console.error("[LOSS_AGGREGATION] Error aggregating losses data:", {
			recordIds: recordIds.slice(0, 5),
			sectorIds: sectorIds?.slice(0, 5),
			error: error instanceof Error ? error.message : String(error),
			stack: error instanceof Error ? error.stack : undefined,
		});
		return { total: 0, byYear: new Map() };
	}
}

/**
 * Main function to get geographic impact following international standards
 */
export async function getGeographicImpactGeoJSON(
	countryAccountsId: string,
	sectorId: string,
	subSectorId?: string,
): Promise<GeoJSONFeatureCollection> {
	try {
		const result = await getGeographicImpact(countryAccountsId, {
			sectorId,
			subSectorId,
		});

		if (!result.success) {
			return {
				type: "FeatureCollection",
				features: [],
			};
		}

		const features: GeoJSONFeature[] = [];

		for (const division of result.divisions) {
			try {
				// Skip divisions without geometry data
				if (!division.geojson) {
					continue;
				}

				// Parse and validate GeoJSON
				let geometry: GeoJSONGeometry;
				try {
					// Handle both string and object formats
					if (typeof division.geojson === "string") {
						const parsed = JSON.parse(division.geojson);
						if (!isValidGeoJSON(parsed)) {
							continue;
						}
						geometry = parsed as GeoJSONGeometry;
					} else {
						if (!isValidGeoJSON(division.geojson)) {
							continue;
						}
						geometry = division.geojson as GeoJSONGeometry;
					}
				} catch (error) {
					console.error(
						`[GEOJSON_FEATURE] Error parsing GeoJSON for division ${division.id}:`,
						{
							error: error instanceof Error ? error.message : String(error),
							stack: error instanceof Error ? error.stack : undefined,
						},
					);
					continue;
				}

				// Create feature with proper properties
				const featureProperties = {
					id: Number(division.id),
					name: division.name as Record<string, string>,
					level: division.level,
					parentId: division.parentId,
					totalDamage: result.values[division.id.toString()]?.totalDamage ?? 0,
					totalLoss: result.values[division.id.toString()]?.totalLoss ?? 0,
					dataAvailability:
						result.values[division.id.toString()]?.dataAvailability ||
						"no_data",
				};

				features.push({
					type: "Feature" as const,
					geometry,
					properties: featureProperties,
				});
			} catch (error) {
				console.error(
					`[GEOJSON_FEATURE] Error processing division ${division.id} for GeoJSON:`,
					{
						divisionId: division.id,
						error: error instanceof Error ? error.message : String(error),
						stack: error instanceof Error ? error.stack : undefined,
					},
				);
				// Continue with other divisions instead of failing the entire operation
				continue;
			}
		}

		return {
			type: "FeatureCollection",
			features,
		};
	} catch (error) {
		console.error("[GEOJSON_EXPORT] Error in getGeographicImpactGeoJSON:", {
			countryAccountsId,
			sectorId,
			subSectorId,
			error: error instanceof Error ? error.message : String(error),
			stack: error instanceof Error ? error.stack : undefined,
		});
		return {
			type: "FeatureCollection",
			features: [],
		};
	}
}
