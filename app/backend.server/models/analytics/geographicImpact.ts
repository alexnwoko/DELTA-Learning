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
import {
	getDescendantDivisionIds,
	recordInDivisionCondition,
} from "~/backend.server/utils/geographicFilters";
import {
	divisionTable,
	type SelectDivision,
} from "~/drizzle/schema/divisionTable";
import { createAssessmentMetadata } from "~/backend.server/utils/disasterCalculations";
import type { DisasterImpactMetadata } from "~/types/disasterCalculations";
import { approvalBasis, type ApprovalAudience } from "~/utils/approvalBasis";
import {
	parseFlexibleDate,
	createDateCondition,
	extractYearFromDate,
} from "~/backend.server/utils/dateFilters";
import { monetaryValue, type MonetaryValue } from "~/utils/valueState";

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
	/** damage.value: null when no record in the division reported a cost. */
	totalDamage: number | null;
	/** loss.value: null when no record in the division reported a cost. */
	totalLoss: number | null;
	/** Value state and record counts (TR-076, PD-10:62). */
	damage: MonetaryValue;
	loss: MonetaryValue;
	metadata: DisasterImpactMetadata;
	/** no_data: neither damage nor loss was reported; zero: reported 0. */
	dataAvailability: "available" | "no_data" | "zero";
}

/** Aggregated cost over a record set, with the records that reported it. */
interface CostAggregate {
	/** Sum over the reported rows; null when no row reported a cost. */
	total: number | null;
	/** Records with at least one reported cost row. */
	recordsReported: number;
	byYear: Map<number, number>;
}

const NO_COST: CostAggregate = {
	total: null,
	recordsReported: 0,
	byYear: new Map(),
};

/**
 * Division figures from the damage and loss aggregates over recordsTotal
 * records. Money has no tri-state source, so a summed 0 is a reported 0 and
 * never zero_confirmed (PD-04:596); a division where no record reported a
 * cost is null and not_reported, never 0 (TR-076).
 */
function divisionValues(
	damageResult: CostAggregate,
	lossResult: CostAggregate,
	recordsTotal: number,
	metadata: DisasterImpactMetadata,
): CleanDivisionValues {
	const damage = monetaryValue({
		sum: damageResult.total,
		reported: damageResult.recordsReported,
		total: recordsTotal,
	});
	const loss = monetaryValue({
		sum: lossResult.total,
		reported: lossResult.recordsReported,
		total: recordsTotal,
	});
	const anyReported =
		damage.valueState === "reported" || loss.valueState === "reported";
	return {
		totalDamage: damage.value,
		totalLoss: loss.value,
		damage,
		loss,
		metadata,
		dataAvailability: !anyReported
			? "no_data"
			: (damage.value ?? 0) > 0 || (loss.value ?? 0) > 0
				? "available"
				: "zero",
	};
}

/**
 * Folds per-date cost rows into a total and a yearly breakdown. Undated rows
 * stay in the total but have no year (C09).
 */
function foldCostRows(
	rows: { year: unknown; cost: string | null; reported: unknown }[],
	into: CostAggregate,
): CostAggregate {
	let { total, recordsReported } = into;
	const byYear = new Map(into.byYear);
	for (const row of rows) {
		recordsReported += Number(row.reported) || 0;
		if (row.cost === null || row.cost === undefined) {
			continue;
		}
		const cost = safeMoneyToNumber(row.cost);
		total = (total ?? 0) + cost;
		if (row.year == null) {
			continue;
		}
		const year = Number(row.year);
		if (isNaN(year)) {
			continue;
		}
		byYear.set(year, (byYear.get(year) || 0) + cost);
	}
	return { total, recordsReported, byYear };
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
	audience: ApprovalAudience,
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
						audience,
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

					// No record in scope: not reported, never 0 (TR-076, PD-10:62).
					if (!disasterRecords || disasterRecords.length === 0) {
						values[division.id.toString()] = divisionValues(
							NO_COST,
							NO_COST,
							0,
							metadata,
						);
						return;
					}

					const [damageResult, lossResult] = await Promise.all([
						aggregateDamagesData(disasterRecords, sectorIds),
						aggregateLossesData(disasterRecords, sectorIds),
					]);

					values[division.id.toString()] = divisionValues(
						damageResult,
						lossResult,
						disasterRecords.length,
						metadata,
					);
				} catch (error) {
					console.error(
						`[DIVISION_PROCESS] Error processing division ${division.id}:`,
						{
							divisionId: division.id,
							error: error instanceof Error ? error.message : String(error),
							stack: error instanceof Error ? error.stack : undefined,
						},
					);
					// A failed division shows no figure rather than a false 0.
					values[division.id.toString()] = divisionValues(
						NO_COST,
						NO_COST,
						0,
						metadata,
					);
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
 * Record-level filters shared by every division query: tenant, approval
 * basis (C23), HIPs classification, sector, date range and disaster event.
 *
 * The hazard classification is read from the record itself, as in
 * hazard-analysis.ts, so records without a linked disaster event still count.
 */
function buildRecordConditions(
	countryAccountsId: string,
	audience: ApprovalAudience,
	filters: GeographicFilters | undefined,
	sectorIds: string[],
): SQL[] {
	const conditions: SQL[] = [
		eq(disasterRecordsTable.countryAccountsId, countryAccountsId),
		approvalBasis(audience, disasterRecordsTable),
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
	audience: ApprovalAudience,
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

		const rows = await dr
			.selectDistinct({ id: disasterRecordsTable.id })
			.from(disasterRecordsTable)
			.where(
				and(
					...buildRecordConditions(
						countryAccountsId,
						audience,
						filters,
						sectorIds,
					),
					recordInDivisionCondition(
						disasterRecordsTable,
						divisionId,
						descendantIds,
					),
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
	audience: ApprovalAudience,
	divisionId: string,
	filters?: GeographicFilters,
): Promise<{
	totalDamage: MonetaryValue;
	totalLoss: MonetaryValue;
	byYear: Map<number, number>;
	metadata?: DisasterImpactMetadata;
}> {
	const none = monetaryValue({ sum: null, reported: 0, total: 0 });
	try {
		// Validate division ID
		if (!divisionId) {
			return {
				totalDamage: none,
				totalLoss: none,
				byYear: new Map(),
				metadata: await createAssessmentMetadata("rapid", "low"),
			};
		}

		// Get disaster records for the division with improved spatial handling
		const recordIds = await getDisasterRecordsForDivision(
			countryAccountsId,
			audience,
			divisionId,
			filters,
		);

		if (recordIds.length === 0) {
			return {
				totalDamage: none,
				totalLoss: none,
				byYear: new Map(),
				metadata: await createAssessmentMetadata("rapid", "low"),
			};
		}

		// Aggregate damages and losses with proper numeric handling
		const damageResult = await aggregateDamagesData(recordIds, []);
		const lossResult = await aggregateLossesData(recordIds, []);

		const totalDamage = monetaryValue({
			sum: damageResult.total,
			reported: damageResult.recordsReported,
			total: recordIds.length,
		});
		const totalLoss = monetaryValue({
			sum: lossResult.total,
			reported: lossResult.recordsReported,
			total: recordIds.length,
		});

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
			totalDamage: none,
			totalLoss: none,
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
): Promise<CostAggregate> {
	try {
		if (recordIds.length === 0) {
			return NO_COST;
		}

		const yearExpr = extractYearFromDate(disasterRecordsTable.startDate);

		// First get sector overrides
		const sectorOverrides = await dr
			.select({
				year: yearExpr.as("year"),
				// NULL, not 0, when no override reported a cost (TR-076).
				cost: sql<string | null>`SUM(
                    CASE
                        WHEN ${sectorDisasterRecordsRelationTable.withDamage} = true AND ${sectorDisasterRecordsRelationTable.damageCost} IS NOT NULL
                        THEN ${sectorDisasterRecordsRelationTable.damageCost}::numeric
                    END
                )`,
				reported: sql<string>`COUNT(DISTINCT ${disasterRecordsTable.id}) FILTER (
                    WHERE ${sectorDisasterRecordsRelationTable.withDamage} = true AND ${sectorDisasterRecordsRelationTable.damageCost} IS NOT NULL
                )`,
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
				// A row counts only when it carries a cost: the override total,
				// or an amount with its unit cost. NULL otherwise (TR-076).
				cost: sql<string | null>`SUM(
                    CASE
                        WHEN ${damagesTable.totalRepairReplacementOverride} = true THEN
                            ${damagesTable.totalRepairReplacement}::numeric
                        WHEN (${damagesTable.pdDamageAmount} IS NOT NULL AND ${damagesTable.pdRepairCostUnit} IS NOT NULL)
                            OR (${damagesTable.tdDamageAmount} IS NOT NULL AND ${damagesTable.tdReplacementCostUnit} IS NOT NULL) THEN
                            COALESCE(${damagesTable.pdDamageAmount}::numeric * ${damagesTable.pdRepairCostUnit}::numeric, 0) +
                            COALESCE(${damagesTable.tdDamageAmount}::numeric * ${damagesTable.tdReplacementCostUnit}::numeric, 0)
                    END
                )`,
				reported: sql<string>`COUNT(DISTINCT ${disasterRecordsTable.id}) FILTER (
                    WHERE CASE
                        WHEN ${damagesTable.totalRepairReplacementOverride} = true THEN
                            ${damagesTable.totalRepairReplacement}::numeric
                        WHEN (${damagesTable.pdDamageAmount} IS NOT NULL AND ${damagesTable.pdRepairCostUnit} IS NOT NULL)
                            OR (${damagesTable.tdDamageAmount} IS NOT NULL AND ${damagesTable.tdReplacementCostUnit} IS NOT NULL) THEN
                            COALESCE(${damagesTable.pdDamageAmount}::numeric * ${damagesTable.pdRepairCostUnit}::numeric, 0) +
                            COALESCE(${damagesTable.tdDamageAmount}::numeric * ${damagesTable.tdReplacementCostUnit}::numeric, 0)
                    END IS NOT NULL
                )`,
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

		// The two paths count disjoint records: the detailed path excludes
		// records with a reported override, so the counts add.
		return foldCostRows(
			detailedDamages,
			foldCostRows(sectorOverrides, NO_COST),
		);
	} catch (error) {
		console.error("[DAMAGE_AGGREGATION] Error aggregating damages data:", {
			recordIds: recordIds.slice(0, 5),
			sectorIds: sectorIds?.slice(0, 5),
			error: error instanceof Error ? error.message : String(error),
			stack: error instanceof Error ? error.stack : undefined,
		});
		return NO_COST;
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
): Promise<CostAggregate> {
	try {
		if (recordIds.length === 0) {
			return NO_COST;
		}

		const yearExpr = extractYearFromDate(disasterRecordsTable.startDate);

		// First get sector overrides
		const sectorOverrides = await dr
			.select({
				year: yearExpr.as("year"),
				// NULL, not 0, when no override reported a cost (TR-076).
				cost: sql<string | null>`SUM(
                    CASE
                        WHEN ${sectorDisasterRecordsRelationTable.withLosses} = true AND ${sectorDisasterRecordsRelationTable.lossesCost} IS NOT NULL
                        THEN ${sectorDisasterRecordsRelationTable.lossesCost}::numeric
                    END
                )`,
				reported: sql<string>`COUNT(DISTINCT ${disasterRecordsTable.id}) FILTER (
                    WHERE ${sectorDisasterRecordsRelationTable.withLosses} = true AND ${sectorDisasterRecordsRelationTable.lossesCost} IS NOT NULL
                )`,
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
				// A row counts only when it carries a public or private cost; the
				// per-row arithmetic is unchanged. NULL otherwise (TR-076).
				cost: sql<string | null>`SUM(
                    CASE WHEN (
                        (${lossesTable.publicCostTotalOverride} = true AND ${lossesTable.publicCostTotal} IS NOT NULL)
                        OR (${lossesTable.publicUnits} IS NOT NULL AND ${lossesTable.publicCostUnit} IS NOT NULL)
                        OR (${lossesTable.privateCostTotalOverride} = true AND ${lossesTable.privateCostTotal} IS NOT NULL)
                        OR (${lossesTable.privateUnits} IS NOT NULL AND ${lossesTable.privateCostUnit} IS NOT NULL)
                    ) THEN
                    CASE
                        WHEN ${lossesTable.publicCostTotalOverride} = true THEN
                            COALESCE(${lossesTable.publicCostTotal}, 0)::numeric
                        ELSE
                            COALESCE(${lossesTable.publicUnits}, 0)::numeric * COALESCE(${lossesTable.publicCostUnit}, 0)::numeric
                    END +
                    CASE 
                        WHEN ${lossesTable.privateCostTotalOverride} = true THEN
                            COALESCE(${lossesTable.privateCostTotal}, 0)::numeric
                        ELSE
                            COALESCE(${lossesTable.privateUnits}, 0)::numeric * COALESCE(${lossesTable.privateCostUnit}, 0)::numeric
                    END
                    END
                )`,
				reported: sql<string>`COUNT(DISTINCT ${disasterRecordsTable.id}) FILTER (
                    WHERE (
                        (${lossesTable.publicCostTotalOverride} = true AND ${lossesTable.publicCostTotal} IS NOT NULL)
                        OR (${lossesTable.publicUnits} IS NOT NULL AND ${lossesTable.publicCostUnit} IS NOT NULL)
                        OR (${lossesTable.privateCostTotalOverride} = true AND ${lossesTable.privateCostTotal} IS NOT NULL)
                        OR (${lossesTable.privateUnits} IS NOT NULL AND ${lossesTable.privateCostUnit} IS NOT NULL)
                    )
                )`,
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

		// The two paths count disjoint records, as for damages.
		return foldCostRows(detailedLosses, foldCostRows(sectorOverrides, NO_COST));
	} catch (error) {
		console.error("[LOSS_AGGREGATION] Error aggregating losses data:", {
			recordIds: recordIds.slice(0, 5),
			sectorIds: sectorIds?.slice(0, 5),
			error: error instanceof Error ? error.message : String(error),
			stack: error instanceof Error ? error.stack : undefined,
		});
		return NO_COST;
	}
}

/**
 * Main function to get geographic impact following international standards
 */
export async function getGeographicImpactGeoJSON(
	countryAccountsId: string,
	audience: ApprovalAudience,
	sectorId: string,
	subSectorId?: string,
): Promise<GeoJSONFeatureCollection> {
	try {
		const result = await getGeographicImpact(countryAccountsId, audience, {
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
					// null when not reported, never 0 (TR-076).
					totalDamage:
						result.values[division.id.toString()]?.totalDamage ?? null,
					totalLoss: result.values[division.id.toString()]?.totalLoss ?? null,
					damageValueState:
						result.values[division.id.toString()]?.damage.valueState ??
						"not_reported",
					lossValueState:
						result.values[division.id.toString()]?.loss.valueState ??
						"not_reported",
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
