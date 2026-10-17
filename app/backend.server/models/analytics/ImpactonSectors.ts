import { dr } from "~/db.server";
import { sql } from "drizzle-orm";
import { sectorDisasterRecordsRelationTable } from "~/drizzle/schema/sectorDisasterRecordsRelationTable";
import { disasterRecordsTable } from "~/drizzle/schema/disasterRecordsTable";
import { lossesTable } from "~/drizzle/schema/lossesTable";
import { damagesTable } from "~/drizzle/schema/damagesTable";
import { disasterEventTable } from "~/drizzle/schema/disasterEventTable";
import { hazardousEventTable } from "~/drizzle/schema/hazardousEventTable";
import { and, eq, inArray, SQL, exists } from "drizzle-orm";
import { getSectorsByParentId } from "./sectors";
import {
	applyGeographicFilters,
	getDivisionInfo,
} from "~/backend.server/utils/geographicFilters";
import {
	parseFlexibleDate,
	createDateCondition,
	extractYearFromDate,
} from "~/backend.server/utils/dateFilters";
import createLogger from "~/utils/logger.server";
import { BackendContext } from "~/backend.server/context";
import { approvalBasis, type ApprovalAudience } from "~/utils/approvalBasis";
import { monetaryValue, type MonetaryValue } from "~/utils/valueState";

// Create logger for this backend module
const logger = createLogger("backend.server/models/analytics/ImpactOnSectors");

type AssessmentType = "rapid" | "detailed";
type ConfidenceLevel = "low" | "medium" | "high";

interface DisasterImpactMetadata {
	assessmentType: AssessmentType;
	confidenceLevel: ConfidenceLevel;
	currency: string;
	assessmentDate: string;
	assessedBy: string;
	notes: string;
}

export const createAssessmentMetadata = async (
	assessmentType: AssessmentType = "rapid",
	confidenceLevel: ConfidenceLevel = "medium",
	currency: string = "USD",
): Promise<DisasterImpactMetadata> => {
	return {
		assessmentType,
		confidenceLevel,
		currency: currency,
		assessmentDate: new Date().toISOString(),
		assessedBy: "DELTA Resilience Analytics System",
		notes: "Automatically generated assessment based on database records",
	};
};

/**
 * Validates currency codes against ISO 4217 standard
 * Used to ensure consistent monetary reporting across assessments
 *
 * @param currency - Currency code to validate
 * @returns true if valid ISO 4217 code
 */
export const validateCurrency = (currency: string): boolean => {
	const iso4217Pattern = /^[A-Z]{3}$/;
	const isValid = iso4217Pattern.test(currency);

	if (!isValid) {
		logger.warn("Invalid currency code provided", { currency });
	}

	return isValid;
};

interface Filters {
	startDate?: string | null;
	endDate?: string | null;
	hazardType?: string | null;
	hazardCluster?: string | null;
	specificHazard?: string | null;
	geographicLevel?: string | null;
	disasterEvent?: string | null;
	_disasterEventId?: string | null;
	assessmentType?: "rapid" | "detailed";
	confidenceLevel?: "low" | "medium" | "high";
}

interface SectorImpactData {
	eventCount: number;
	/** damage.value as a string; null when no record reported a cost. */
	totalDamage: string | null;
	/** loss.value as a string; null when no record reported a cost. */
	totalLoss: string | null;
	/** Value state and record counts (TR-076). */
	damage: MonetaryValue;
	loss: MonetaryValue;
	eventsOverTime: { [year: string]: string };
	damageOverTime: { [year: string]: string };
	lossOverTime: { [year: string]: string };
	metadata: DisasterImpactMetadata;
	faoAgriculturalImpact?: {
		damage: any;
		loss: any;
	};
	dataAvailability: {
		damage: "available" | "zero" | "no_data";
		loss: "available" | "zero" | "no_data";
	};
}

/** Cost over a record set, with the records that reported it. */
interface CostAggregate {
	/** Sum over records that reported a cost; null when none did. */
	total: number | null;
	recordsReported: number;
	/** Reported costs by year; a year appears only when a cost was reported. */
	byYear: Map<number, number>;
}

/** A cost input: null when absent, never 0 (TR-076). */
function costOrNull(v: unknown): number | null {
	if (v === null || v === undefined || v === "") return null;
	const n = Number(v);
	return Number.isFinite(n) ? n : null;
}

/** a x b, or null when either factor is absent. */
function productOrNull(a: unknown, b: unknown): number | null {
	const x = costOrNull(a);
	const y = costOrNull(b);
	return x === null || y === null ? null : x * y;
}

/** Sum of the present parts, or null when every part is absent. */
function sumOrNull(...parts: (number | null)[]): number | null {
	const present = parts.filter((p): p is number => p !== null);
	return present.length ? present.reduce((a, b) => a + b, 0) : null;
}

/** dataAvailability from a monetary figure: a reported 0 is "zero". */
function availability(v: MonetaryValue): "available" | "zero" | "no_data" {
	if (v.valueState !== "reported") return "no_data";
	return (v.value ?? 0) > 0 ? "available" : "zero";
}

// Function to get all disaster records for a sector with tenant isolation
const getDisasterRecordsForSector = async (
	ctx: BackendContext,
	countryAccountsId: string,
	audience: ApprovalAudience,
	sectorId: string,
	filters?: Filters,
): Promise<string[]> => {
	try {
		// Get all relevant sector IDs (including subsectors if parent sector)
		const sectorIds = await getAllSubsectorIds(ctx, sectorId);
		const numericSectorIds = sectorIds;

		// Initialize conditions array with tenant isolation
		let conditions: SQL[] = [
			approvalBasis(audience, disasterRecordsTable),
			sql`${disasterRecordsTable.countryAccountsId} = ${countryAccountsId}`,
		];

		// Handle sector filtering using proper hierarchy
		if (sectorIds.length > 0) {
			conditions.push(
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
								inArray(
									sectorDisasterRecordsRelationTable.sectorId,
									numericSectorIds,
								),
							),
						),
				),
			);
		}

		// Apply geographic level filter
		if (filters?.geographicLevel) {
			try {
				const divisionInfo = await getDivisionInfo(filters.geographicLevel);
				if (divisionInfo) {
					logger.debug("Applying geographic filter", {
						geographicLevel: filters.geographicLevel,
						divisionInfo,
					});
					conditions = await applyGeographicFilters(
						divisionInfo,
						disasterRecordsTable,
						conditions,
					);
				}
			} catch (error) {
				logger.error("Error applying geographic filter", {
					geographicLevel: filters.geographicLevel,
					error: error instanceof Error ? error.message : "Unknown error",
				});
			}
		}

		// Add other filter conditions with proper error handling
		if (filters) {
			if (filters.startDate) {
				try {
					const startDate = parseFlexibleDate(filters.startDate);
					if (startDate) {
						conditions.push(
							createDateCondition(
								disasterRecordsTable.startDate,
								startDate,
								"gte",
							),
						);
						logger.debug("Applied start date filter", {
							startDate: filters.startDate,
						});
					} else {
						logger.error("Invalid start date format", {
							startDate: filters.startDate,
						});
					}
				} catch (error) {
					logger.error("Invalid start date", {
						startDate: filters.startDate,
						error: error instanceof Error ? error.message : "Unknown error",
					});
				}
			}

			if (filters.endDate) {
				try {
					const endDate = parseFlexibleDate(filters.endDate);
					if (endDate) {
						conditions.push(
							createDateCondition(disasterRecordsTable.endDate, endDate, "lte"),
						);
						logger.debug("Applied end date filter", {
							endDate: filters.endDate,
						});
					} else {
						logger.error("Invalid end date format", {
							endDate: filters.endDate,
						});
					}
				} catch (error) {
					logger.error("Invalid end date", {
						endDate: filters.endDate,
						error: error instanceof Error ? error.message : "Unknown error",
					});
				}
			}

			// Handle hazard type hierarchy
			if (filters.hazardType) {
				try {
					logger.debug("Applying hazard type filter", {
						hazardType: filters.hazardType,
					});
					conditions.push(
						sql`${hazardousEventTable.hipTypeId} = ${filters.hazardType}`,
					);
				} catch (error) {
					logger.error("Invalid hazard type ID", {
						hazardType: filters.hazardType,
						error: error instanceof Error ? error.message : "Unknown error",
					});
				}
			}

			if (filters.hazardCluster) {
				try {
					logger.debug("Applying hazard cluster filter", {
						hazardCluster: filters.hazardCluster,
					});
					conditions.push(
						sql`${hazardousEventTable.hipClusterId} = ${filters.hazardCluster}`,
					);
				} catch (error) {
					logger.error("Invalid hazard cluster ID", {
						hazardCluster: filters.hazardCluster,
						error: error instanceof Error ? error.message : "Unknown error",
					});
				}
			}

			if (filters.specificHazard) {
				try {
					logger.debug("Applying specific hazard filter", {
						specificHazard: filters.specificHazard,
					});
					conditions.push(
						sql`${hazardousEventTable.hipHazardId} = ${filters.specificHazard}`,
					);
				} catch (error) {
					logger.error("Invalid specific hazard ID", {
						specificHazard: filters.specificHazard,
						error: error instanceof Error ? error.message : "Unknown error",
					});
				}
			}

			if (filters.disasterEvent || filters._disasterEventId) {
				try {
					const eventId = filters._disasterEventId || filters.disasterEvent;
					if (eventId) {
						logger.debug("Applying disaster event filter", { eventId });
						// Check if it's a UUID (for direct ID matching)
						const uuidRegex =
							/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
						if (uuidRegex.test(eventId)) {
							// Direct ID match for UUID format
							conditions.push(eq(disasterEventTable.id, eventId));
							logger.debug("Using UUID direct match for disaster event", {
								eventId,
							});
						} else {
							// Text search across multiple fields for non-UUID format
							const searchConditions: SQL[] = [];
							searchConditions.push(
								sql`LOWER(${
									disasterEventTable.nameNational
								}::text) LIKE ${`%${eventId.toLowerCase()}%`}`,
							);
							searchConditions.push(
								sql`LOWER(${disasterEventTable.id}::text) LIKE ${`%${eventId.toLowerCase()}%`}`,
							);
							searchConditions.push(sql`
                CASE WHEN ${disasterEventTable.glide} IS NOT NULL 
                THEN LOWER(${disasterEventTable.glide}) LIKE ${`%${eventId.toLowerCase()}%`}
                ELSE FALSE END
              `);
							searchConditions.push(sql`
                CASE WHEN ${disasterEventTable.nationalDisasterId} IS NOT NULL 
                THEN LOWER(${
									disasterEventTable.nationalDisasterId
								}) LIKE ${`%${eventId.toLowerCase()}%`}
                ELSE FALSE END
              `);
							searchConditions.push(sql`
                CASE WHEN ${disasterEventTable.otherId1} IS NOT NULL 
                THEN LOWER(${disasterEventTable.otherId1}) LIKE ${`%${eventId.toLowerCase()}%`}
                ELSE FALSE END
              `);
							logger.debug("Using text search for disaster event", {
								eventId,
								searchFieldsCount: searchConditions.length,
							});
						}
					}
				} catch (error) {
					logger.error("Error filtering by disaster event", {
						disasterEvent: filters.disasterEvent,
						_disasterEventId: filters._disasterEventId,
						error: error instanceof Error ? error.message : "Unknown error",
					});
				}
			}
		}

		// Execute the query with robust error handling
		try {
			// Build the final query with all conditions
			const query = dr
				.select({
					id: disasterRecordsTable.id,
				})
				.from(disasterRecordsTable)
				.leftJoin(
					disasterEventTable,
					eq(disasterRecordsTable.disasterEventId, disasterEventTable.id),
				)
				.leftJoin(
					hazardousEventTable,
					eq(disasterEventTable.hazardousEventId, hazardousEventTable.id),
				)
				.where(conditions.length > 0 ? and(...conditions) : sql`TRUE`);

			// Execute the query and map results
			const results = await query;

			return results.map((r) => r.id.toString());
		} catch (error) {
			logger.error("Error executing getDisasterRecordsForSector query", {
				sectorId,
				error: error instanceof Error ? error.message : "Unknown error",
				stack: error instanceof Error ? error.stack : undefined,
			});
			// Return empty array instead of throwing to prevent cascading failures
			return [];
		}
	} catch (error) {
		logger.error("Error in getDisasterRecordsForSector", {
			sectorId,
			error: error instanceof Error ? error.message : "Unknown error",
			stack: error instanceof Error ? error.stack : undefined,
		});
		throw error;
	}
};

/**
 * This implementation uses the proper hierarchical structure defined in the sector table
 * rather than relying on ID patterns, making it suitable for all countries.
 *
 * @param sectorId - The ID of the sector to get subsectors for
 * @returns Array of sector IDs including the input sector and all its subsectors
 */
const getAllSubsectorIds = async (
	ctx: BackendContext,
	sectorId: string | undefined,
): Promise<string[]> => {
	if (sectorId === undefined || sectorId === null) return [];

	const rootId = sectorId;
	logger.debug("Starting sector hierarchy traversal", { rootId });

	const result: string[] = [];
	const seen = new Set<string>();
	const queue: string[] = [rootId];

	while (queue.length > 0) {
		const currentId = queue.shift()!;
		if (seen.has(currentId)) continue;
		seen.add(currentId);
		result.push(currentId);

		logger.debug("Processing sector in hierarchy", { currentId });

		const children = await getSectorsByParentId(ctx, currentId);
		logger.debug("Found subsectors", {
			parentId: currentId,
			childrenCount: children.length,
			childrenIds: children.map((c) => c.id),
		});

		for (const child of children) {
			if (!seen.has(child.id)) queue.push(child.id);
		}
	}

	return result;
};

// Update aggregateDamagesData function
const aggregateDamagesData = async (
	ctx: BackendContext,
	recordIds: string[],
	sectorId: string | undefined,
): Promise<CostAggregate & { faoAgriDamage?: any }> => {
	logger.debug("Starting damage data aggregation", {
		recordCount: recordIds.length,
		sectorId,
	});

	const sectorIds = sectorId ? await getAllSubsectorIds(ctx, sectorId) : [];

	// First check sectorDisasterRecordsRelation for overrides
	const sectorOverrides = await dr
		.select({
			recordId: sectorDisasterRecordsRelationTable.disasterRecordId,
			sectorId: sectorDisasterRecordsRelationTable.sectorId,
			damageCost: sectorDisasterRecordsRelationTable.damageCost,
			withDamage: sectorDisasterRecordsRelationTable.withDamage,
		})
		.from(sectorDisasterRecordsRelationTable)
		.where(
			and(
				inArray(sectorDisasterRecordsRelationTable.disasterRecordId, recordIds),
				sectorIds.length > 0
					? inArray(sectorDisasterRecordsRelationTable.sectorId, sectorIds)
					: undefined,
			),
		);

	logger.debug("Found sector override records", {
		overrideCount: sectorOverrides.length,
	});

	// Get detailed damages for records without sector overrides
	const detailedDamages = await dr
		.select({
			recordId: damagesTable.recordId,
			sectorId: damagesTable.sectorId,
			totalRepairReplacement: damagesTable.totalRepairReplacement,
			totalRepairReplacementOverride:
				damagesTable.totalRepairReplacementOverride,
			pdDamageAmount: damagesTable.pdDamageAmount,
			pdRepairCostUnit: damagesTable.pdRepairCostUnit,
			tdDamageAmount: damagesTable.tdDamageAmount,
			tdReplacementCostUnit: damagesTable.tdReplacementCostUnit,
		})
		.from(damagesTable)
		.where(
			and(
				inArray(damagesTable.recordId, recordIds),
				sectorIds.length > 0
					? inArray(damagesTable.sectorId, sectorIds)
					: undefined,
			),
		);

	logger.debug("Found detailed damage records", {
		detailedDamageCount: detailedDamages.length,
	});

	let total: number | null = null;
	let recordsReported = 0;
	const byYear = new Map<number, number>();

	// Process each record. A record counts only when it reported a cost,
	// which may be 0; a record with no cost adds nothing (TR-076).
	for (const recordId of recordIds) {
		let recordDamageAmount: number | null = null;

		// Check sector overrides for all matching subsectors
		const matchingOverrides = sectorOverrides.filter(
			(so) => so.recordId === recordId && sectorIds.includes(so.sectorId),
		);

		// Sum up all sector override damages
		for (const override of matchingOverrides) {
			const overrideDamage = override?.withDamage
				? costOrNull(override.damageCost)
				: null;
			if (overrideDamage !== null) {
				recordDamageAmount = (recordDamageAmount ?? 0) + overrideDamage;

				logger.debug("Using sector override for damage", {
					recordId,
					sectorId: override.sectorId,
					overrideAmount: overrideDamage,
				});
			}
		}

		// If no override reported a damage cost, check detailed damages for all matching subsectors
		if (recordDamageAmount === null) {
			const matchingDamages = detailedDamages.filter(
				(d) => d.recordId === recordId && sectorIds.includes(d.sectorId),
			);

			// Sum up all detailed damages
			for (const damage of matchingDamages) {
				// Only include PD repair and TD replacement costs; null when the
				// row carries no cost.
				const damageAmount = damage.totalRepairReplacementOverride
					? costOrNull(damage.totalRepairReplacement)
					: sumOrNull(
							productOrNull(damage.pdDamageAmount, damage.pdRepairCostUnit),
							productOrNull(
								damage.tdDamageAmount,
								damage.tdReplacementCostUnit,
							),
						);
				if (damageAmount === null) {
					continue;
				}

				recordDamageAmount = (recordDamageAmount ?? 0) + damageAmount;

				logger.debug("Calculated damage from detailed records", {
					recordId,
					sectorId: damage.sectorId,
					calculatedAmount: damageAmount,
					usedOverride: damage.totalRepairReplacementOverride,
				});
			}
		}

		if (recordDamageAmount !== null) {
			total = (total ?? 0) + recordDamageAmount;
			recordsReported++;

			// Get year and update yearly breakdown
			const record = await dr
				.select({
					year: extractYearFromDate(disasterRecordsTable.startDate).as("year"),
				})
				.from(disasterRecordsTable)
				.where(eq(disasterRecordsTable.id, recordId))
				.limit(1);

			if (record && record[0]?.year) {
				const year = Number(record[0].year);
				byYear.set(year, (byYear.get(year) || 0) + recordDamageAmount);
			}
		}
	}

	return { total, recordsReported, byYear };
};

// Update aggregateLossesData function
const aggregateLossesData = async (
	ctx: BackendContext,
	recordIds: string[],
	sectorId: string | undefined,
): Promise<CostAggregate & { faoAgriLoss?: any }> => {
	logger.debug("Starting loss data aggregation", {
		recordCount: recordIds.length,
		sectorId,
	});

	const sectorIds = sectorId ? await getAllSubsectorIds(ctx, sectorId) : [];
	const numericSectorIds = sectorIds;

	// First check sectorDisasterRecordsRelation for overrides
	const sectorOverrides = await dr
		.select({
			recordId: sectorDisasterRecordsRelationTable.disasterRecordId,
			sectorId: sectorDisasterRecordsRelationTable.sectorId,
			lossesCost: sectorDisasterRecordsRelationTable.lossesCost,
			withLosses: sectorDisasterRecordsRelationTable.withLosses,
		})
		.from(sectorDisasterRecordsRelationTable)
		.where(
			and(
				inArray(sectorDisasterRecordsRelationTable.disasterRecordId, recordIds),
				numericSectorIds.length > 0
					? inArray(
							sectorDisasterRecordsRelationTable.sectorId,
							numericSectorIds,
						)
					: undefined,
			),
		);

	logger.debug("Found sector override records for losses", {
		overrideCount: sectorOverrides.length,
	});

	// Get detailed losses for records without sector overrides
	const detailedLosses = await dr
		.select({
			recordId: lossesTable.recordId,
			sectorId: lossesTable.sectorId,
			publicCostTotal: lossesTable.publicCostTotal,
			publicCostTotalOverride: lossesTable.publicCostTotalOverride,
			publicUnits: lossesTable.publicUnits,
			publicCostUnit: lossesTable.publicCostUnit,
			privateCostTotal: lossesTable.privateCostTotal,
			privateCostTotalOverride: lossesTable.privateCostTotalOverride,
			privateUnits: lossesTable.privateUnits,
			privateCostUnit: lossesTable.privateCostUnit,
		})
		.from(lossesTable)
		.where(
			and(
				inArray(lossesTable.recordId, recordIds),
				numericSectorIds.length > 0
					? inArray(lossesTable.sectorId, numericSectorIds)
					: undefined,
			),
		);

	logger.debug("Found detailed loss records", {
		detailedLossCount: detailedLosses.length,
	});

	let total: number | null = null;
	let recordsReported = 0;
	const byYear = new Map<number, number>();

	// Process each record; as for damages, only reported costs count.
	for (const recordId of recordIds) {
		let recordLossAmount: number | null = null;

		// Check sector overrides for all matching subsectors
		const matchingOverrides = sectorOverrides.filter(
			(so) =>
				so.recordId === recordId && numericSectorIds.includes(so.sectorId),
		);

		// Sum up all sector override losses
		for (const override of matchingOverrides) {
			const overrideLoss = override?.withLosses
				? costOrNull(override.lossesCost)
				: null;
			if (overrideLoss !== null) {
				recordLossAmount = (recordLossAmount ?? 0) + overrideLoss;

				logger.debug("Using sector override for loss", {
					recordId,
					sectorId: override.sectorId,
					overrideAmount: overrideLoss,
				});
			}
		}

		// If no override reported a loss cost, check detailed losses for all matching subsectors
		if (recordLossAmount === null) {
			const matchingLosses = detailedLosses.filter(
				(l) => l.recordId === recordId && numericSectorIds.includes(l.sectorId),
			);

			// Sum up all detailed losses
			for (const loss of matchingLosses) {
				// Calculate from public and private costs; null when the row
				// carries neither.
				const lossAmount = sumOrNull(
					loss.publicCostTotalOverride
						? costOrNull(loss.publicCostTotal)
						: productOrNull(loss.publicUnits, loss.publicCostUnit),
					loss.privateCostTotalOverride
						? costOrNull(loss.privateCostTotal)
						: productOrNull(loss.privateUnits, loss.privateCostUnit),
				);
				if (lossAmount === null) {
					continue;
				}

				recordLossAmount = (recordLossAmount ?? 0) + lossAmount;

				logger.debug("Calculated loss from detailed records", {
					recordId,
					sectorId: loss.sectorId,
					calculatedAmount: lossAmount,
					usedPublicOverride: loss.publicCostTotalOverride,
					usedPrivateOverride: loss.privateCostTotalOverride,
				});
			}
		}

		if (recordLossAmount !== null) {
			total = (total ?? 0) + recordLossAmount;
			recordsReported++;

			// Get year and update yearly breakdown
			const record = await dr
				.select({
					year: extractYearFromDate(disasterRecordsTable.startDate).as("year"),
				})
				.from(disasterRecordsTable)
				.where(eq(disasterRecordsTable.id, recordId))
				.limit(1);

			if (record && record[0]?.year) {
				const year = Number(record[0].year);
				byYear.set(year, (byYear.get(year) || 0) + recordLossAmount);
			}
		}
	}

	return { total, recordsReported, byYear };
};

// Function to get event counts by year
const getEventCountsByYear = async (
	recordIds: string[],
): Promise<Map<number, number>> => {
	if (recordIds.length === 0) return new Map();

	logger.debug("Getting event counts by year", {
		recordCount: recordIds.length,
	});

	// Get events that span years by considering both start and end dates
	const eventYearSpans = await dr
		.select({
			eventId: disasterEventTable.id,
			startYear: extractYearFromDate(disasterEventTable.startDate).as(
				"startYear",
			),
			endYear: extractYearFromDate(disasterEventTable.endDate).as("endYear"),
		})
		.from(disasterRecordsTable)
		.innerJoin(
			disasterEventTable,
			eq(disasterRecordsTable.disasterEventId, disasterEventTable.id),
		)
		.where(inArray(disasterRecordsTable.id, recordIds))
		.groupBy(disasterEventTable.id);

	// Process events and count them for each year they span
	const yearCounts = new Map<number, number>();
	for (const event of eventYearSpans) {
		// An undated event has no year to count in (C09).
		if (event.startYear == null) {
			continue;
		}
		const startYear = Number(event.startYear);
		const endYear = event.endYear == null ? startYear : Number(event.endYear); // fallback to startYear if no end date

		// Count event for each year in its duration
		for (let year = startYear; year <= endYear; year++) {
			yearCounts.set(year, (yearCounts.get(year) || 0) + 1);
		}
	}

	logger.debug("Event count calculation completed", {
		uniqueEvents: eventYearSpans.length,
		yearsWithEvents: yearCounts.size,
		yearCounts: [...yearCounts.entries()],
	});

	return yearCounts;
};

/**
 * Fetches comprehensive sector impact data following multiple international standards:
 * @param countryAccountsId - Tenant context for filtering by country account
 * @param sectorId - ID of the sector to analyze
 * @param filters - Optional filters for data selection
 * @returns Comprehensive sector impact data with metadata
 */
export async function fetchSectorImpactData(
	ctx: BackendContext,
	countryAccountsId: string,
	audience: ApprovalAudience,
	sectorId: string,
	filters?: Filters,
	currency?: string,
): Promise<SectorImpactData> {
	try {
		const recordIds = await getDisasterRecordsForSector(
			ctx,
			countryAccountsId,
			audience,
			sectorId,
			filters,
		);

		// If no records found, return null values (not_reported, TR-076)
		if (recordIds.length === 0) {
			const none = monetaryValue({ sum: null, reported: 0, total: 0 });
			return {
				eventCount: 0,
				totalDamage: null,
				totalLoss: null,
				damage: none,
				loss: none,
				eventsOverTime: {},
				damageOverTime: {},
				lossOverTime: {},
				metadata: await createAssessmentMetadata(
					filters?.assessmentType || "detailed",
					filters?.confidenceLevel || "medium",
				),
				dataAvailability: {
					damage: "no_data",
					loss: "no_data",
				},
			};
		}

		const [damagesResult, lossesResult, eventCounts] = await Promise.all([
			aggregateDamagesData(ctx, recordIds, sectorId),
			aggregateLossesData(ctx, recordIds, sectorId),
			getEventCountsByYear(recordIds),
		]);

		// Create assessment metadata
		const metadata = await createAssessmentMetadata(
			filters?.assessmentType || "detailed",
			filters?.confidenceLevel || "medium",
			currency,
		);

		// Only include FAO data if both damage and loss calculations are available
		const faoAgriculturalImpact =
			damagesResult.faoAgriDamage && lossesResult.faoAgriLoss
				? {
						damage: damagesResult.faoAgriDamage,
						loss: lossesResult.faoAgriLoss,
					}
				: undefined;

		// Money has no tri-state source: a summed 0 is a reported 0, never
		// zero_confirmed; no reported cost is null, never 0 (PD-04:596).
		const damage = monetaryValue({
			sum: damagesResult.total,
			reported: damagesResult.recordsReported,
			total: recordIds.length,
		});
		const loss = monetaryValue({
			sum: lossesResult.total,
			reported: lossesResult.recordsReported,
			total: recordIds.length,
		});

		return {
			eventCount: recordIds.length,
			totalDamage: damage.value === null ? null : damage.value.toString(),
			totalLoss: loss.value === null ? null : loss.value.toString(),
			damage,
			loss,
			eventsOverTime: Object.fromEntries(
				[...eventCounts].map(([year, count]) => [
					year.toString(),
					count.toString(),
				]),
			),
			// Only years with a reported cost: a year with events but no
			// reported cost is a gap, not 0 (TR-076).
			damageOverTime: Object.fromEntries(
				[...damagesResult.byYear].map(([year, v]) => [
					year.toString(),
					v.toString(),
				]),
			),
			lossOverTime: Object.fromEntries(
				[...lossesResult.byYear].map(([year, v]) => [
					year.toString(),
					v.toString(),
				]),
			),
			metadata,
			faoAgriculturalImpact,
			dataAvailability: {
				damage: availability(damage),
				loss: availability(loss),
			},
		};
	} catch (error) {
		logger.error("Error in fetchSectorImpactData", {
			sectorId,
			error: error instanceof Error ? error.message : "Unknown error",
			stack: error instanceof Error ? error.stack : undefined,
			filters,
		});
		throw error;
	}
}
