import { and, desc, eq, exists, inArray, sql, SQL } from "drizzle-orm";
import { approvalBasis, type ApprovalAudience } from "~/utils/approvalBasis";
import { dr } from "~/db.server";
import { sectorDisasterRecordsRelationTable } from "~/drizzle/schema/sectorDisasterRecordsRelationTable";
import { disasterRecordsTable } from "~/drizzle/schema/disasterRecordsTable";
import { hipTypeTable } from "~/drizzle/schema/hipTypeTable";
import { lossesTable } from "~/drizzle/schema/lossesTable";
import { damagesTable } from "~/drizzle/schema/damagesTable";
import { disasterEventTable } from "~/drizzle/schema/disasterEventTable";
import { hazardousEventTable } from "~/drizzle/schema/hazardousEventTable";
import createLogger from "~/utils/logger.server";

// Initialize logger for this module
const logger = createLogger("backend.server/models/analytics/hazardImpact");
import { HazardDataPoint, HazardImpactFilters } from "~/types/hazardImpact";
import { monetaryValue } from "~/utils/valueState";
import { getSectorsByParentId } from "./sectors";
import {
	createAssessmentMetadata,
	calculateFaoAgriculturalDamage,
	calculateFaoAgriculturalLoss,
} from "~/backend.server/utils/disasterCalculations";
import type {
	DisasterImpactMetadata,
	FaoAgriSubsector,
	FaoAgriculturalDamage,
	FaoAgriculturalLoss,
} from "~/types/disasterCalculations";
import {
	applyGeographicFilters,
	getDivisionInfo,
} from "~/backend.server/utils/geographicFilters";
import {
	parseFlexibleDate,
	createDateCondition,
} from "~/backend.server/utils/dateFilters";
import { BackendContext } from "~/backend.server/context";

const getAgriSubsector = (
	sectorId: string | undefined,
): FaoAgriSubsector | null => {
	if (!sectorId) {
		logger.debug("No sector ID provided for agricultural subsector lookup");
		return null;
	}
	const subsectorMap: { [key: string]: FaoAgriSubsector } = {
		agri_crops: "crops",
		agri_livestock: "livestock",
		agri_fisheries: "fisheries",
		agri_forestry: "forestry",
	};
	return subsectorMap[sectorId] || null;
};

/**
 * Gets all subsector IDs for a given sector and all its subsectors recursively
 * @param sectorId - The ID of the sector to get subsectors for
 * @returns Array of sector IDs including the input sector and all its subsectors at all levels
 */
const getAllSubsectorIds = async (
	ctx: BackendContext,
	sectorId: string,
): Promise<string[]> => {
	// Get immediate subsectors
	const subsectors = await getSectorsByParentId(ctx, sectorId);

	// Initialize result with the current sector ID
	const result: string[] = [sectorId];

	// Recursively get all subsectors at all levels
	if (subsectors.length > 0) {
		// Add immediate subsector IDs
		result.push(...subsectors.map((s) => s.id));

		// For each subsector, recursively get its subsectors
		for (const subsector of subsectors) {
			const childSubsectorIds = await getAllSubsectorIds(
				ctx,
				subsector.id.toString(),
			);
			// Filter out the subsector ID itself as it's already included
			const uniqueChildIds = childSubsectorIds.filter(
				(id) => id !== subsector.id,
			);
			result.push(...uniqueChildIds);
		}
	}

	// Remove duplicates and return
	return [...new Set(result)];
};

export interface HazardImpactResult {
	eventsCount: HazardDataPoint[] | null;
	damages: HazardDataPoint[] | null;
	losses: HazardDataPoint[] | null;
	metadata: DisasterImpactMetadata;
	faoAgriculturalImpact?: {
		damage: FaoAgriculturalDamage;
		loss: FaoAgriculturalLoss;
	};
	dataAvailability?: {
		events: "available" | "zero" | "no_data";
		damages: "available" | "zero" | "no_data";
		losses: "available" | "zero" | "no_data";
	};
}

export async function fetchHazardImpactData(
	ctx: BackendContext,
	countryAccountsId: string,
	audience: ApprovalAudience,
	filters: HazardImpactFilters,
): Promise<HazardImpactResult> {
	const {
		sectorId,
		hazardTypeId,
		hazardClusterId,
		specificHazardId,
		geographicLevelId,
		fromDate,
		toDate,
		disasterEventId,
		_disasterEventId,
		assessmentType = "rapid",
		confidenceLevel = "medium",
	} = filters;

	// Create assessment metadata
	const metadata = await createAssessmentMetadata(
		assessmentType,
		confidenceLevel,
	);

	logger.debug("Created assessment metadata", { metadata });

	// Build base conditions array
	let baseConditions: SQL[] = [
		approvalBasis(audience, disasterRecordsTable),
		// Add tenant isolation filter
		sql`${disasterRecordsTable.countryAccountsId} = ${countryAccountsId}`,
	];

	// Get all sector IDs (including subsectors)
	const sectorIds = sectorId ? await getAllSubsectorIds(ctx, sectorId) : [];

	// Handle sector filtering using proper hierarchy
	if (sectorId && sectorIds.length > 0) {
		// Add condition for sectorDisasterRecordsRelation
		baseConditions.push(
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
							inArray(sectorDisasterRecordsRelationTable.sectorId, sectorIds),
						),
					),
			),
		);
	}

	// Add date filters if provided
	if (fromDate) {
		const parsedFromDate = parseFlexibleDate(fromDate);
		if (parsedFromDate) {
			baseConditions.push(
				createDateCondition(
					disasterRecordsTable.startDate,
					parsedFromDate,
					"gte",
				),
			);
		} else {
			logger.error("Invalid from date format", { fromDate });
		}
	}

	if (toDate) {
		const parsedToDate = parseFlexibleDate(toDate);
		if (parsedToDate) {
			baseConditions.push(
				createDateCondition(disasterRecordsTable.endDate, parsedToDate, "lte"),
			);
		} else {
			logger.error("Invalid to date format", { toDate });
		}
	}

	// Add hazard type filters if provided
	if (hazardTypeId) {
		baseConditions.push(eq(hazardousEventTable.hipTypeId, hazardTypeId));
	}
	if (hazardClusterId) {
		baseConditions.push(eq(hazardousEventTable.hipClusterId, hazardClusterId));
	}
	if (specificHazardId) {
		baseConditions.push(eq(hazardousEventTable.hipHazardId, specificHazardId));
	}

	// Apply geographic level filter
	if (geographicLevelId) {
		const divisionInfo = await getDivisionInfo(geographicLevelId);
		if (!divisionInfo) {
			logger.warn("Geographic level not found", { geographicLevelId });
			return {
				eventsCount: [],
				damages: [],
				losses: [],
				metadata,
				faoAgriculturalImpact: undefined,
			};
		}

		// Apply geographic filters from utility
		baseConditions = await applyGeographicFilters(
			divisionInfo,
			disasterRecordsTable,
			baseConditions,
		);
	}

	// Add disaster event filter if provided
	if (disasterEventId) {
		try {
			const eventId = _disasterEventId || disasterEventId;
			baseConditions.push(eq(disasterRecordsTable.disasterEventId, eventId));
		} catch (error) {
			logger.error("Invalid disaster event ID format", {
				error: error instanceof Error ? error.message : String(error),
				disasterEventId,
				_disasterEventId,
			});
			return {
				eventsCount: [],
				damages: [],
				losses: [],
				metadata,
				faoAgriculturalImpact: undefined,
			};
		}
	}

	// Check if we need FAO agricultural calculations
	const agriSubsector = getAgriSubsector(sectorId);
	let faoAgriculturalImpact;

	if (agriSubsector) {
		const [faoAgriDamage, faoAgriLoss] = await Promise.all([
			calculateFaoAgriculturalDamage(damagesTable, agriSubsector),
			calculateFaoAgriculturalLoss(lossesTable, agriSubsector),
		]);

		if (faoAgriDamage && faoAgriLoss) {
			faoAgriculturalImpact = {
				damage: faoAgriDamage,
				loss: faoAgriLoss,
			};
		}
	}

	// Query for disaster events count by hazard type
	const eventsCount = await dr
		.select({
			hazardId: sql<string>`${hazardousEventTable.hipTypeId}`,
			hazardName: sql<string>`dts_jsonb_localized(${hipTypeTable.name}, ${ctx.lang})`,

			value: sql<number>`COUNT(DISTINCT ${disasterEventTable.id})`,
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
		.leftJoin(hipTypeTable, eq(hazardousEventTable.hipTypeId, hipTypeTable.id))
		.where(and(...baseConditions))
		.groupBy(hazardousEventTable.hipTypeId, hipTypeTable.id)
		.orderBy(desc(sql`COUNT(DISTINCT ${disasterEventTable.id})`));

	// Calculate total events for percentage
	const total = eventsCount.reduce((sum, item) => sum + Number(item.value), 0);

	// Add percentage to each item and ensure types match HazardDataPoint
	const eventsCountWithPercentage = eventsCount.map((item) => ({
		hazardId: item.hazardId,
		hazardName: String(item.hazardName),
		value: String(item.value),
		percentage: total > 0 ? (Number(item.value) / total) * 100 : 0,
	}));

	// Per record and sector relation: the sector-level cost, else the first
	// asset row. NULL, not 0, when neither carries a cost (TR-076).
	const damageCost = sql`
        CASE
            WHEN ${sectorDisasterRecordsRelationTable.withDamage} = true AND ${sectorDisasterRecordsRelationTable.damageCost} IS NOT NULL THEN
                ${sectorDisasterRecordsRelationTable.damageCost}::numeric
            ELSE (
                SELECT
                    CASE
                        WHEN ${damagesTable.totalRepairReplacementOverride} = true THEN
                            ${damagesTable.totalRepairReplacement}::numeric
                        WHEN (${damagesTable.pdDamageAmount} IS NOT NULL AND ${damagesTable.pdRepairCostUnit} IS NOT NULL)
                            OR (${damagesTable.tdDamageAmount} IS NOT NULL AND ${damagesTable.tdReplacementCostUnit} IS NOT NULL) THEN
                            COALESCE(${damagesTable.pdDamageAmount}::numeric * ${damagesTable.pdRepairCostUnit}::numeric, 0) +
                            COALESCE(${damagesTable.tdDamageAmount}::numeric * ${damagesTable.tdReplacementCostUnit}::numeric, 0)
                    END
                FROM ${damagesTable}
                WHERE ${damagesTable.recordId} = ${disasterRecordsTable.id}
                AND ${damagesTable.sectorId} = ${sectorDisasterRecordsRelationTable.sectorId}
                LIMIT 1
            )
        END`;
	const lossPublic = sql`CASE
            WHEN ${lossesTable.publicCostTotalOverride} = true THEN ${lossesTable.publicCostTotal}::numeric
            ELSE ${lossesTable.publicUnits}::numeric * ${lossesTable.publicCostUnit}::numeric
        END`;
	const lossPrivate = sql`CASE
            WHEN ${lossesTable.privateCostTotalOverride} = true THEN ${lossesTable.privateCostTotal}::numeric
            ELSE ${lossesTable.privateUnits}::numeric * ${lossesTable.privateCostUnit}::numeric
        END`;
	const lossCost = sql`
        CASE
            WHEN ${sectorDisasterRecordsRelationTable.withLosses} = true AND ${sectorDisasterRecordsRelationTable.lossesCost} IS NOT NULL THEN
                ${sectorDisasterRecordsRelationTable.lossesCost}::numeric
            ELSE (
                SELECT
                    CASE
                        WHEN (${lossPublic}) IS NULL AND (${lossPrivate}) IS NULL THEN NULL
                        ELSE COALESCE(${lossPublic}, 0) + COALESCE(${lossPrivate}, 0)
                    END
                FROM ${lossesTable}
                WHERE ${lossesTable.recordId} = ${disasterRecordsTable.id}
                AND ${lossesTable.sectorId} = ${sectorDisasterRecordsRelationTable.sectorId}
                LIMIT 1
            )
        END`;

	// Query for damages by hazard type
	const damages = await dr
		.select({
			hazardId: sql<string>`${hazardousEventTable.hipTypeId}`,
			hazardName: sql<string>`dts_jsonb_localized(${hipTypeTable.name}, ${ctx.lang})`,
			value: sql<string | null>`SUM(${damageCost})`,
			recordsReported: sql<string>`COUNT(DISTINCT ${disasterRecordsTable.id}) FILTER (WHERE (${damageCost}) IS NOT NULL)`,
			recordsTotal: sql<string>`COUNT(DISTINCT ${disasterRecordsTable.id})`,
		})
		.from(disasterRecordsTable)
		.innerJoin(
			sectorDisasterRecordsRelationTable,
			and(
				eq(
					sectorDisasterRecordsRelationTable.disasterRecordId,
					disasterRecordsTable.id,
				),
				inArray(sectorDisasterRecordsRelationTable.sectorId, sectorIds),
			),
		)
		.leftJoin(
			disasterEventTable,
			eq(disasterRecordsTable.disasterEventId, disasterEventTable.id),
		)
		.leftJoin(
			hazardousEventTable,
			eq(disasterEventTable.hazardousEventId, hazardousEventTable.id),
		)
		.leftJoin(hipTypeTable, eq(hazardousEventTable.hipTypeId, hipTypeTable.id))
		.where(and(...baseConditions))
		.groupBy(hazardousEventTable.hipTypeId, hipTypeTable.id)
		.orderBy(sql`SUM(${damageCost}) DESC NULLS LAST`);

	// Query for losses by hazard type
	const losses = await dr
		.select({
			hazardId: sql<string>`${hazardousEventTable.hipTypeId}`,
			hazardName: sql<string>`dts_jsonb_localized(${hipTypeTable.name}, ${ctx.lang})`,
			value: sql<string | null>`SUM(${lossCost})`,
			recordsReported: sql<string>`COUNT(DISTINCT ${disasterRecordsTable.id}) FILTER (WHERE (${lossCost}) IS NOT NULL)`,
			recordsTotal: sql<string>`COUNT(DISTINCT ${disasterRecordsTable.id})`,
		})
		.from(disasterRecordsTable)
		.innerJoin(
			sectorDisasterRecordsRelationTable,
			and(
				eq(
					sectorDisasterRecordsRelationTable.disasterRecordId,
					disasterRecordsTable.id,
				),
				inArray(sectorDisasterRecordsRelationTable.sectorId, sectorIds),
			),
		)
		.leftJoin(
			disasterEventTable,
			eq(disasterRecordsTable.disasterEventId, disasterEventTable.id),
		)
		.leftJoin(
			hazardousEventTable,
			eq(disasterEventTable.hazardousEventId, hazardousEventTable.id),
		)
		.leftJoin(hipTypeTable, eq(hazardousEventTable.hipTypeId, hipTypeTable.id))
		.where(and(...baseConditions))
		.groupBy(hazardousEventTable.hipTypeId, hipTypeTable.id)
		.orderBy(sql`SUM(${lossCost}) DESC NULLS LAST`);

	// Each hazard's figure carries its state. Money has no tri-state source:
	// a summed 0 is a reported 0, never zero_confirmed; a hazard with no
	// reported cost is null and not_reported, never 0 (TR-076, PD-04:596).
	const withState = (
		rows: {
			hazardId: string;
			hazardName: string;
			value: string | null;
			recordsReported: string;
			recordsTotal: string;
		}[],
	): HazardDataPoint[] => {
		const figures = rows.map((item) => ({
			item,
			figure: monetaryValue({
				sum: item.value,
				reported: item.recordsReported,
				total: item.recordsTotal,
			}),
		}));
		// Shares of the reported total only.
		const total = figures.reduce((sum, f) => sum + (f.figure.value ?? 0), 0);
		return figures.map(({ item, figure }) => ({
			hazardId: item.hazardId,
			hazardName: String(item.hazardName),
			value: figure.value === null ? null : String(figure.value),
			percentage:
				figure.value === null
					? null
					: total > 0
						? (figure.value / total) * 100
						: 0,
			valueState: figure.valueState,
			recordsReported: figure.recordsReported,
			recordsTotal: figure.recordsTotal,
		}));
	};
	const damagesWithPercentage = withState(damages);
	const lossesWithPercentage = withState(losses);
	const totalDamages = damagesWithPercentage.reduce(
		(sum, item) => sum + Number(item.value ?? 0),
		0,
	);
	const totalLosses = lossesWithPercentage.reduce(
		(sum, item) => sum + Number(item.value ?? 0),
		0,
	);
	const anyReported = (rows: HazardDataPoint[]) =>
		rows.some((r) => r.valueState === "reported");

	return {
		eventsCount:
			eventsCountWithPercentage.length > 0 ? eventsCountWithPercentage : [],
		damages: damagesWithPercentage.length > 0 ? damagesWithPercentage : [],
		losses: lossesWithPercentage.length > 0 ? lossesWithPercentage : [],
		metadata,
		faoAgriculturalImpact,
		dataAvailability: {
			events:
				eventsCountWithPercentage.length > 0
					? total > 0
						? "available"
						: "zero"
					: "no_data",
			// zero: a reported 0, not a confirmed zero (money, PD-04:596).
			damages: anyReported(damagesWithPercentage)
				? totalDamages > 0
					? "available"
					: "zero"
				: "no_data",
			losses: anyReported(lossesWithPercentage)
				? totalLosses > 0
					? "available"
					: "zero"
				: "no_data",
		},
	};
}
