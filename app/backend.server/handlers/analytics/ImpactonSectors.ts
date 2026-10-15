import { fetchSectorImpactData } from "~/backend.server/models/analytics/ImpactonSectors";

import { eq, and, sql, SQL } from "drizzle-orm";

import { dr } from "~/db.server";
import { sectorDisasterRecordsRelationTable } from "~/drizzle/schema/sectorDisasterRecordsRelationTable";
import { disasterRecordsTable } from "~/drizzle/schema/disasterRecordsTable";
import { hipHazardTable } from "~/drizzle/schema/hipHazardTable";
import { hipClusterTable } from "~/drizzle/schema/hipClusterTable";
import { hipTypeTable } from "~/drizzle/schema/hipTypeTable";
import { lossesTable } from "~/drizzle/schema/lossesTable";
import { damagesTable } from "~/drizzle/schema/damagesTable";
import { disruptionTable } from "~/drizzle/schema/disruptionTable";
import { disasterEventTable } from "~/drizzle/schema/disasterEventTable";
import { BackendContext } from "~/backend.server/context";
import { approvalBasis, type ApprovalAudience } from "~/utils/approvalBasis";
import { monetaryValue, type MonetaryValue } from "~/utils/valueState";

/**
 * Monetary figure from a total row: the summed cost, the records that
 * reported one and all records in scope. No reported cost is null and
 * not_reported, never 0; money has no tri-state source, so a summed 0 is a
 * reported 0, never zero_confirmed (TR-076, PD-04:596).
 */
function monetaryFromRow(
	row: { total: unknown; reported: unknown; records: unknown } | undefined,
): MonetaryValue {
	return monetaryValue({
		sum: (row?.total as string | number | null | undefined) ?? null,
		reported: (row?.reported as string | number | undefined) ?? 0,
		total: (row?.records as string | number | undefined) ?? 0,
	});
}

interface SectorImpactResponse {
	success: boolean;
	data?: {
		eventCount: number;
		/** null when no record reported a cost (TR-076). */
		totalDamage: string | null;
		totalLoss: string | null;
		damage: MonetaryValue;
		loss: MonetaryValue;
		eventsOverTime: { [key: string]: string };
		damageOverTime: { [key: string]: string };
		lossOverTime: { [key: string]: string };
		dataAvailability?: {
			damage: string;
			loss: string;
		};
	};
	error?: string;
}

interface Filters {
	startDate?: string | null;
	endDate?: string | null;
	hazardType?: string | null;
	hazardCluster?: string | null;
	specificHazard?: string | null;
	geographicLevel?: string | null;
	disasterEvent?: string | null;
}

export const getImpactOnSector = async (
	ctx: BackendContext,
	countryAccountsId: string,
	audience: ApprovalAudience,
	sectorId: string,
	filters?: Filters,
	currency?: any,
): Promise<SectorImpactResponse> => {
	try {
		// Input validation
		if (!sectorId) {
			return {
				success: false,
				error: "Invalid sector ID provided",
			};
		}

		// Validate tenant context
		if (!countryAccountsId) {
			console.error(
				"Invalid tenant context provided to getImpactOnSector:",
				countryAccountsId,
			);
			return {
				success: false,
				error:
					"Invalid tenant context. Please ensure you are logged in with a valid country account.",
			};
		}

		// Fetch data from the model with tenant context for isolation
		const data = await fetchSectorImpactData(
			ctx,
			countryAccountsId,
			audience,
			sectorId,
			filters,
			currency,
		);

		// Return successful response
		return {
			success: true,
			data,
		};
	} catch (error) {
		console.error("Error in getImpactOnSector:", error);
		return {
			success: false,
			error:
				error instanceof Error ? error.message : "An unexpected error occurred",
		};
	}
};

/**
 * Retrieves the total impact of a specified type on a sector by using the provided arguments.
 * This function can calculate impacts based on damages, losses, or disruptions
 * for a particular country account and may involve additional  SQL conditions.
 *
 * @param {Object} args - The arguments required to fetch the sector impact total.
 * @param {string} args.countryAccountsId - The unique identifier for the country account
 *                                           from which the impact data is to be retrieved.
 * @param {'damages' | 'losses' | 'disruption'} args.impact - Specifies the type of impact
 *                                                            to be retrieved. It can be either
 *                                                            'damages', 'losses', or 'disruption'.
 * @param {Object} [args.type] - An object representing additional filtering criteria:
 *                                - { sectorId: string } - Filters by specific sector.
 *                                - { disasterEventId: string } - Filters by specific disaster event.
 *                                - { hazardTypeId?: string, hazardClusterId?: string, hazardId?: string } -
 *                                  Filters based on hazard categories, optionally providing data for hazard type,
 *                                  cluster, and general hazard ID.
 * @param {string | null} [args.divisionId] - An optional identifier for a division
 *                                             that further narrows down the results. This can be null if no division
 *                                             filtering is needed.
 * @param {SQL[] | null} [extraConditions] - Optional parameter for additional SQL conditions
 *                                            that can be applied to the query. Can be null if no extra conditions
 *                                            are required.
 *
 * @example
 * // Get damages for a specific sector
 * await getSectorImpactTotal({
 *   countryAccountsId: "UUID",
 *   audience: "public",
 *   impact: "damages",
 * });
 *
 * @example
 * // Get losses for a specific disaster with extra conditions
 * await getSectorImpactTotal({
 *   countryAccountsId: "UUID",
 *   audience: "public",
 *   impact: "losses",
 *   type: { disasterEventId: "UUID" },
 *   divisionId: "UUID"
 * }, [sql`${disasterRecordsTable.startDate} > '2024-01-01'`]);
 *
 * @returns {Promise<Object>} - A promise that resolves to an object containing the total impact values based on the type of impact requested.
 *  Each total is null when no record in scope reported a cost, never 0
 *  (TR-076), and comes with its MonetaryValue (value state and counts):
 *  - If `args.impact` is 'damages':
 *      - { damagesTotal, recoveryTotal, damages, recovery }
 *  - If `args.impact` is 'losses':
 *      - { lossesTotal, losses }
 *  - If `args.impact` is 'disruption':
 *      - { disruptionTotal, disruption }
 */
export async function getSectorImpactTotal(
	args: {
		countryAccountsId: string;
		/** Approval basis audience (C23). */
		audience: ApprovalAudience;
		impact: "damages" | "losses" | "disruption";
		type?:
			| {
					sectorId: string;
			  }
			| {
					disasterEventId: string;
			  }
			| {
					hazardTypeId?: string;
					hazardClusterId?: string;
					hazardId?: string;
			  };
		divisionId?: string | null;
	},
	extraConditions?: SQL[] | null,
) {
	// select base columns to include
	const selects: any = {
		// Aliased so the total queries can count records over the CTE.
		recordId: sql<string>`${disasterRecordsTable.id}`.as("cte_record_id"),
		recordSectorId: sectorDisasterRecordsRelationTable.id,
		recordSector_SectorId: sectorDisasterRecordsRelationTable.sectorId,
		// flags that live on the sector relation
		withDamage: sectorDisasterRecordsRelationTable.withDamage,
		withLosses: sectorDisasterRecordsRelationTable.withLosses,
		withDisruption: sectorDisasterRecordsRelationTable.withDisruption,
	};

	// base where conditions
	const baseWhere: SQL[] = [
		eq(disasterRecordsTable.countryAccountsId, args.countryAccountsId),
		approvalBasis(args.audience, disasterRecordsTable),
	];

	const distinctOnCols = [
		disasterRecordsTable.id,
		sectorDisasterRecordsRelationTable.id,
	];

	if (args.impact === "damages") {
		selects.damageCost = sectorDisasterRecordsRelationTable.damageCost;
		selects.damageCostCurrency =
			sectorDisasterRecordsRelationTable.damageCostCurrency;
		selects.damageRecoveryCost =
			sectorDisasterRecordsRelationTable.damageRecoveryCost;
		selects.damageRecoveryCostCurrency =
			sectorDisasterRecordsRelationTable.damageRecoveryCostCurrency;
		// Per record and sector: the override, else the asset rows. NULL, not
		// 0, when neither carries a cost (TR-076).
		selects.damageCostComputed = sql`
        (
            COALESCE(
            ${sectorDisasterRecordsRelationTable.damageCost},
            SUM(${damagesTable.totalRepairReplacement})
            )
        )
        `.as("damageCostComputed");
		selects.damageCostRecoveryComputed = sql`
        (
            COALESCE(
            ${sectorDisasterRecordsRelationTable.damageRecoveryCost},
            SUM(${damagesTable.totalRecovery})
            )
        )
        `.as("damageCostRecoveryComputed");
	} else if (args.impact === "losses") {
		selects.lossesCost = sectorDisasterRecordsRelationTable.lossesCost;
		selects.lossesCostCurrency =
			sectorDisasterRecordsRelationTable.lossesCostCurrency;
		// A loss row with only a public or only a private total still
		// reports a cost; a row with neither reports none (TR-076).
		selects.lossesCostComputed = sql`
        (
            COALESCE(
            ${sectorDisasterRecordsRelationTable.lossesCost},
            SUM(
                CASE
                    WHEN ${lossesTable.privateCostTotal} IS NOT NULL OR ${lossesTable.publicCostTotal} IS NOT NULL
                    THEN COALESCE(${lossesTable.privateCostTotal}, 0) + COALESCE(${lossesTable.publicCostTotal}, 0)
                END
            )
            )
        )
        `.as("lossesCostComputed");
	} else if (args.impact === "disruption") {
		selects.disruptionCostComputed = sql`
        (
            SUM(${disruptionTable.responseCost})
        )
        `.as("disruptionCostComputed");
	}

	let q: any = dr
		.selectDistinctOn(distinctOnCols, selects)
		.from(sectorDisasterRecordsRelationTable)
		.innerJoin(
			disasterRecordsTable,
			eq(
				disasterRecordsTable.id,
				sectorDisasterRecordsRelationTable.disasterRecordId,
			),
		);

	// conditional joins
	if (args.impact === "damages") {
		q = q.leftJoin(
			damagesTable,
			and(
				eq(sectorDisasterRecordsRelationTable.withDamage, true),
				eq(
					damagesTable.recordId,
					sectorDisasterRecordsRelationTable.disasterRecordId,
				),
				eq(damagesTable.sectorId, sectorDisasterRecordsRelationTable.sectorId),
			),
		);

		baseWhere.push(eq(sectorDisasterRecordsRelationTable.withDamage, true));
	} else if (args.impact === "losses") {
		q = q.leftJoin(
			lossesTable,
			and(
				eq(sectorDisasterRecordsRelationTable.withLosses, true),
				eq(
					lossesTable.recordId,
					sectorDisasterRecordsRelationTable.disasterRecordId,
				),
				eq(lossesTable.sectorId, sectorDisasterRecordsRelationTable.sectorId),
			),
		);

		baseWhere.push(eq(sectorDisasterRecordsRelationTable.withLosses, true));
	} else if (args.impact === "disruption") {
		q = q.innerJoin(
			disruptionTable,
			and(
				eq(sectorDisasterRecordsRelationTable.withDisruption, true),
				eq(
					disruptionTable.recordId,
					sectorDisasterRecordsRelationTable.disasterRecordId,
				),
				eq(
					disruptionTable.sectorId,
					sectorDisasterRecordsRelationTable.sectorId,
				),
			),
		);

		baseWhere.push(eq(sectorDisasterRecordsRelationTable.withDisruption, true));
	}

	// Condition for division
	if (args.divisionId) {
		baseWhere.push(sql`EXISTS (
			WITH RECURSIVE division_tree AS (
				SELECT id
				FROM division
				WHERE id = ${args.divisionId}::uuid
				UNION ALL
				SELECT d.id
				FROM division d
				INNER JOIN division_tree dt ON d.parent_id = dt.id
			)
			SELECT 1
			FROM disaster_records_division drd
			WHERE drd.disaster_record_id = ${disasterRecordsTable.id}
				AND drd.division_id IN (SELECT id FROM division_tree)
		)`);
	}

	// Condition for Type = sector (sectorId)
	if (args.type && "sectorId" in args.type) {
		baseWhere.push(sql`(
            EXISTS(
              SELECT 1
              FROM unnest(dts_get_sector_children_idonly(${args.type.sectorId})) AS func_sectors
              WHERE func_sectors = ${sectorDisasterRecordsRelationTable.sectorId}
            )
        )`);
		// q = q.innerJoin(
		//   sql`unnest(dts_get_sector_children_idonly(${args.type.sectorId})) AS func_sectors`,
		//   sql`func_sectors = ${sectorDisasterRecordsRelationTable.sectorId}`
		// );
	}

	// Condition for Type = disaster event (disasterEventId)
	if (args.type && "disasterEventId" in args.type) {
		q = q.innerJoin(
			disasterEventTable,
			eq(disasterEventTable.id, disasterRecordsTable.disasterEventId),
		);

		baseWhere.push(eq(disasterEventTable.id, args.type.disasterEventId));
	}

	// Condition for Type = HIPs (disasterEventId)
	if (
		(args.type && "hazardTypeId" in args.type) ||
		(args.type && "hazardClusterId" in args.type) ||
		(args.type && "hazardId" in args.type)
	) {
		if (args.type && "hazardTypeId" in args.type) {
			q = q.innerJoin(
				hipTypeTable,
				eq(hipTypeTable.id, disasterRecordsTable.hipTypeId),
			);

			if (args.type.hazardTypeId) {
				baseWhere.push(eq(hipTypeTable.id, args.type.hazardTypeId));
			}
		}
		if (args.type && "hazardClusterId" in args.type) {
			q = q.innerJoin(
				hipClusterTable,
				eq(hipClusterTable.id, disasterRecordsTable.hipClusterId),
			);

			if (args.type.hazardClusterId) {
				baseWhere.push(eq(hipClusterTable.id, args.type.hazardClusterId));
			}
		}
		if (args.type && "hazardId" in args.type) {
			q = q.innerJoin(
				hipHazardTable,
				eq(hipHazardTable.id, disasterRecordsTable.hipHazardId),
			);

			if (args.type.hazardId) {
				baseWhere.push(eq(hipHazardTable.id, args.type.hazardId));
			}
		}
	}

	if (extraConditions && extraConditions.length)
		baseWhere.push(...extraConditions);

	q = q
		.where(and(...baseWhere))
		.groupBy(
			disasterRecordsTable.id,
			sectorDisasterRecordsRelationTable.sectorId,
			sectorDisasterRecordsRelationTable.id,
		);

	if (args.impact === "damages") {
		// create a CTE from the damages query, then sum the computed fields across all rows
		const cteDamages = dr.$with("cteDamages").as(q);
		const totalRowDamages = await dr
			.with(cteDamages)
			.select({
				total: sql`SUM(${cteDamages.damageCostComputed})`,
				reported: sql`COUNT(DISTINCT ${cteDamages.recordId}) FILTER (WHERE ${cteDamages.damageCostComputed} IS NOT NULL)`,
				records: sql`COUNT(DISTINCT ${cteDamages.recordId})`,
			})
			.from(cteDamages);

		const totalRowRecovery = await dr
			.with(cteDamages)
			.select({
				total: sql`SUM(${cteDamages.damageCostRecoveryComputed})`,
				reported: sql`COUNT(DISTINCT ${cteDamages.recordId}) FILTER (WHERE ${cteDamages.damageCostRecoveryComputed} IS NOT NULL)`,
				records: sql`COUNT(DISTINCT ${cteDamages.recordId})`,
			})
			.from(cteDamages);

		const damages = monetaryFromRow(totalRowDamages[0]);
		const recovery = monetaryFromRow(totalRowRecovery[0]);

		return {
			damagesTotal: damages.value,
			recoveryTotal: recovery.value,
			damages,
			recovery,
		};
	} else if (args.impact === "losses") {
		// create a CTE named 'cteLosses' from the losses query
		const cteLosses = dr.$with("cteLosses").as(q);

		// run a SELECT SUM(...) from the CTE
		const totalRowLosses = await dr
			.with(cteLosses)
			.select({
				total: sql`SUM(${cteLosses.lossesCostComputed})`,
				reported: sql`COUNT(DISTINCT ${cteLosses.recordId}) FILTER (WHERE ${cteLosses.lossesCostComputed} IS NOT NULL)`,
				records: sql`COUNT(DISTINCT ${cteLosses.recordId})`,
			})
			.from(cteLosses);

		const losses = monetaryFromRow(totalRowLosses[0]);

		return {
			lossesTotal: losses.value,
			losses,
		};
	} else if (args.impact === "disruption") {
		// create a CTE named 'cteDisruption' from the disruption query
		const cteDisruption = dr.$with("cteDisruption").as(q);

		// run a SELECT SUM(...) from the CTE
		const totalRow = await dr
			.with(cteDisruption)
			.select({
				total: sql`SUM(${cteDisruption.disruptionCostComputed})`,
				reported: sql`COUNT(DISTINCT ${cteDisruption.recordId}) FILTER (WHERE ${cteDisruption.disruptionCostComputed} IS NOT NULL)`,
				records: sql`COUNT(DISTINCT ${cteDisruption.recordId})`,
			})
			.from(cteDisruption);

		const disruption = monetaryFromRow(totalRow[0]);
		return {
			disruptionTotal: disruption.value,
			disruption,
		};
	}

	return null;
}
