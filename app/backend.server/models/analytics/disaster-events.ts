import { dr } from "~/db.server";

import { sectorDisasterRecordsRelationTable } from "~/drizzle/schema/sectorDisasterRecordsRelationTable";
import { sectorTable } from "~/drizzle/schema/sectorTable";
import { disasterRecordsTable } from "~/drizzle/schema/disasterRecordsTable";
import { lossesTable } from "~/drizzle/schema/lossesTable";
import { assetTable } from "~/drizzle/schema/assetTable";
import { damagesTable } from "~/drizzle/schema/damagesTable";
import { disruptionTable } from "~/drizzle/schema/disruptionTable";
import { disasterEventTable } from "~/drizzle/schema/disasterEventTable";

import { eq, sql, and, isNull, or, inArray } from "drizzle-orm";
import { monetaryValue, type MonetaryValue } from "~/utils/valueState";
import { BackendContext } from "~/backend.server/context";
import {
	approvalBasis,
	basisColumns,
	type ApprovalAudience,
} from "~/utils/approvalBasis";

/**
 * Fetch disaster events from the database based on the query parameter and tenant context.
 * @param countryAccountsId The tenant context for filtering by country account
 * @param audience Approval basis audience (C23).
 * @param query Search query string (optional).
 * @returns an array of disaster events.
 */
export const fetchDisasterEvents = async (
	countryAccountsId: string,
	audience: ApprovalAudience,
	query?: string,
) => {
	try {
		// Add conditions for searching multiple fields
		const queryCondition = query
			? sql`
        LOWER(name_national) LIKE ${"%" + query.toLowerCase() + "%"} OR 
        LOWER(glide) LIKE ${"%" + query.toLowerCase() + "%"} OR
        LOWER(national_disaster_id) LIKE ${"%" + query.toLowerCase() + "%"} OR
        id::text LIKE ${"%" + query.toLowerCase() + "%"} OR
        LOWER(other_id1) LIKE ${"%" + query.toLowerCase() + "%"}
      `
			: sql`TRUE`;

		// Execute query and return the full result object with tenant isolation
		const result = await dr.execute(
			sql`
        SELECT 
          id, 
          name_national AS name, 
          glide, 
          national_disaster_id, 
          other_id1,
          start_date,
          end_date,
          effects_total_usd
        FROM disaster_event
        WHERE (${queryCondition})
        AND country_accounts_id = ${countryAccountsId}
        AND ${approvalBasis(audience, basisColumns())}
        ORDER BY start_date DESC
      `,
		);

		return result; // Return the full QueryResult object
	} catch (error) {
		console.error(`[fetchDisasterEvents] Failed with query="${query}":`, error);
		throw new Error("Database query failed. Please try again later.");
	}
};

export async function disasterEventSectorsById(
	ctx: BackendContext,
	id: any,
	incAncestorsDescendants: boolean = false,
	audience: ApprovalAudience,
) {
	if (typeof id !== "string") {
		throw new Error("Invalid ID: must be a string");
	}

	const rows = await dr
		.selectDistinctOn([sectorTable.id], {
			id: sectorTable.id,
			sectorname:
				sql<string>`dts_jsonb_localized(${sectorTable.name}, ${ctx.lang})`.as(
					"sectorname",
				),
			relatedAncestorsDescendants: incAncestorsDescendants
				? sql`(
					dts_get_sector_ancestors_descendants(${ctx.lang}, ${sectorTable.id})
				)`.as("relatedAncestorsDescendants")
				: sql`(
					NULL
				)`.as("relatedAncestorsDescendants"),
		})
		.from(sectorDisasterRecordsRelationTable)
		.innerJoin(
			disasterRecordsTable,
			eq(
				disasterRecordsTable.id,
				sectorDisasterRecordsRelationTable.disasterRecordId,
			),
		)
		.innerJoin(
			disasterEventTable,
			eq(disasterEventTable.id, disasterRecordsTable.disasterEventId),
		)
		.innerJoin(
			sectorTable,
			eq(sectorTable.id, sectorDisasterRecordsRelationTable.sectorId),
		)
		.where(
			and(
				eq(disasterEventTable.id, id),
				approvalBasis(audience, disasterRecordsTable),
				approvalBasis(audience, disasterEventTable),
			),
		)
		.orderBy(sectorTable.id)
		.execute();

	return rows;
}

export async function disasterEvent_DisasterRecordsCount__ById(
	id: any,
	audience: ApprovalAudience,
) {
	if (typeof id !== "string") {
		throw new Error("Invalid ID: must be a string");
	}

	const record = await dr
		.select({
			count: sql<number>`count(*)`,
		})
		.from(disasterRecordsTable)
		.innerJoin(
			disasterEventTable,
			eq(disasterEventTable.id, disasterRecordsTable.disasterEventId),
		)
		.where(
			and(
				eq(disasterEventTable.id, id),
				approvalBasis(audience, disasterRecordsTable),
				approvalBasis(audience, disasterEventTable),
			),
		)
		.execute();

	return record[0].count;
}

export async function disasterEventTotalLosses_RecordsAssets__ById(
	disasterEventId: string,
	disasterRecordId: string,
	sectorId: string,
	audience: ApprovalAudience,
	countryAccountsId: string,
) {
	const queryLossesTable = dr
		.selectDistinctOn([lossesTable.id], {
			recordId: disasterRecordsTable.id,
			recordSectorId: sectorDisasterRecordsRelationTable.id,
			recordSector_SectorId: sectorDisasterRecordsRelationTable.sectorId,
			recordSectorLossesCost: sectorDisasterRecordsRelationTable.lossesCost,
			recordSectorLossesCostCurrency:
				sectorDisasterRecordsRelationTable.lossesCostCurrency,
			lossesId: lossesTable.id,
			privateCostTotal: lossesTable.privateCostTotal,
			privateCostTotalOverride: lossesTable.privateCostTotalOverride,
			privateUnits: lossesTable.privateUnits,
			privateCostUnit: lossesTable.privateCostUnit,
			publicCostTotal: lossesTable.publicCostTotal,
			publicCostTotalOverride: lossesTable.publicCostTotalOverride,
			publicUnits: lossesTable.publicUnits,
			publicCostUnit: lossesTable.publicCostUnit,
			// name: sql`(
			// 	1
			// )`.as('name'),
		})
		.from(sectorDisasterRecordsRelationTable)
		.innerJoin(
			disasterRecordsTable,
			eq(
				disasterRecordsTable.id,
				sectorDisasterRecordsRelationTable.disasterRecordId,
			),
		)
		.innerJoin(
			disasterEventTable,
			eq(disasterEventTable.id, disasterRecordsTable.disasterEventId),
		)
		.innerJoin(
			lossesTable,
			and(
				eq(
					lossesTable.recordId,
					sectorDisasterRecordsRelationTable.disasterRecordId,
				),
				eq(lossesTable.sectorId, sectorId),
			),
		)
		.where(
			and(
				eq(disasterEventTable.id, disasterEventId),
				eq(disasterRecordsTable.countryAccountsId, countryAccountsId),
				eq(sectorDisasterRecordsRelationTable.withLosses, true),
				eq(lossesTable.sectorId, sectorId),
				eq(
					sectorDisasterRecordsRelationTable.disasterRecordId,
					disasterRecordId,
				),
				eq(lossesTable.recordId, disasterRecordId),
				isNull(sectorDisasterRecordsRelationTable.lossesCost),
				approvalBasis(audience, disasterRecordsTable),
				approvalBasis(audience, disasterEventTable),
			),
		);

	return queryLossesTable.execute();
}

export async function disasterEventTotalRecovery_RecordsAssets__ById(
	disasterEventId: string,
	disasterRecordId: string,
	sectorId: string,
	audience: ApprovalAudience,
	countryAccountsId: string,
) {
	const queryDamageTable = dr
		.selectDistinctOn([damagesTable.id], {
			recordId: disasterRecordsTable.id,
			recordSectorId: sectorDisasterRecordsRelationTable.id,
			recordSector_SectorId: sectorDisasterRecordsRelationTable.sectorId,
			damageId: damagesTable.id,
			totalRecovery: damagesTable.totalRecovery,
		})
		.from(sectorDisasterRecordsRelationTable)
		.innerJoin(
			disasterRecordsTable,
			eq(
				disasterRecordsTable.id,
				sectorDisasterRecordsRelationTable.disasterRecordId,
			),
		)
		.innerJoin(
			disasterEventTable,
			eq(disasterEventTable.id, disasterRecordsTable.disasterEventId),
		)
		.innerJoin(
			damagesTable,
			and(
				eq(
					damagesTable.recordId,
					sectorDisasterRecordsRelationTable.disasterRecordId,
				),
				eq(damagesTable.sectorId, sectorId),
			),
		)
		.where(
			and(
				eq(disasterEventTable.id, disasterEventId),
				eq(disasterRecordsTable.countryAccountsId, countryAccountsId),
				eq(sectorDisasterRecordsRelationTable.withDamage, true),
				eq(damagesTable.sectorId, sectorId),
				eq(
					sectorDisasterRecordsRelationTable.disasterRecordId,
					disasterRecordId,
				),
				eq(damagesTable.recordId, disasterRecordId),
				isNull(sectorDisasterRecordsRelationTable.damageRecoveryCost),
				approvalBasis(audience, disasterRecordsTable),
				approvalBasis(audience, disasterEventTable),
			),
		);

	// return queryDamageTable;
	return queryDamageTable.execute();
}

export async function disasterEventTotalDamages_RecordsAssets__ById(
	disasterEventId: string,
	disasterRecordId: string,
	sectorId: string,
	audience: ApprovalAudience,
	countryAccountsId: string,
) {
	const queryDamageTable = dr
		.selectDistinctOn([damagesTable.id], {
			recordId: disasterRecordsTable.id,
			recordSectorId: sectorDisasterRecordsRelationTable.id,
			recordSector_SectorId: sectorDisasterRecordsRelationTable.sectorId,
			recordSectorDamageCost: sectorDisasterRecordsRelationTable.damageCost,
			recordSectorDamageCostCurrency:
				sectorDisasterRecordsRelationTable.damageCostCurrency,
			damageId: damagesTable.id,
			totalDamageAmountOverride: damagesTable.totalDamageAmountOverride,
			totalDamageAmount: damagesTable.totalDamageAmount,
			totalRepairReplacementOverride:
				damagesTable.totalRepairReplacementOverride,
			totalRepairReplacement: damagesTable.totalRepairReplacement,
			pdRepairCostTotalOverride: damagesTable.pdRepairCostTotalOverride,
			pdRepairCostTotal: damagesTable.pdRepairCostTotal,
			tdReplacementCostTotalOverride:
				damagesTable.tdReplacementCostTotalOverride,
			tdReplacementCostTotal: damagesTable.tdReplacementCostTotal,
			// name: sql`(
			// 	1
			// )`.as('name'),
		})
		.from(sectorDisasterRecordsRelationTable)
		.innerJoin(
			disasterRecordsTable,
			eq(
				disasterRecordsTable.id,
				sectorDisasterRecordsRelationTable.disasterRecordId,
			),
		)
		.innerJoin(
			disasterEventTable,
			eq(disasterEventTable.id, disasterRecordsTable.disasterEventId),
		)
		.innerJoin(
			damagesTable,
			and(
				eq(
					damagesTable.recordId,
					sectorDisasterRecordsRelationTable.disasterRecordId,
				),
				eq(sectorDisasterRecordsRelationTable.sectorId, sectorId),
			),
		)
		.where(
			and(
				eq(disasterEventTable.id, disasterEventId),
				eq(disasterRecordsTable.countryAccountsId, countryAccountsId),
				eq(sectorDisasterRecordsRelationTable.withDamage, true),
				eq(damagesTable.sectorId, sectorId),
				eq(
					sectorDisasterRecordsRelationTable.disasterRecordId,
					disasterRecordId,
				),
				eq(damagesTable.recordId, disasterRecordId),
				isNull(sectorDisasterRecordsRelationTable.damageCost),
				approvalBasis(audience, disasterRecordsTable),
				approvalBasis(audience, disasterEventTable),
			),
		);

	// return queryDamageTable;
	return queryDamageTable.execute();
}

/** One sector effect of an event: its figure in the configured currency. */
export type SectorEffect = MonetaryValue & {
	/** The figure value: null when no record reported a cost (TR-076). */
	total: number | null;
	/** The tenant's configured currency label; no conversion is applied. */
	currency: string;
};

export interface SectorEffects {
	damages: SectorEffect;
	losses: SectorEffect;
	recovery: SectorEffect;
}

interface SectorRelationRow {
	recordId: string;
	recordSector_SectorId: string;
	withDamage: boolean | null;
	damageCost: string | null;
	damageRecoveryCost: string | null;
	withLosses: boolean | null;
	lossesCost: string | null;
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

/** Running sum that stays null until a record reports a cost. */
class CostSum {
	sum: number | null = null;
	reported = new Set<string>();
	add(recordId: string, v: number | null) {
		if (v === null) return;
		this.sum = (this.sum ?? 0) + v;
		this.reported.add(recordId);
	}
	effect(recordsTotal: number, currency: string): SectorEffect {
		const v = monetaryValue({
			sum: this.sum,
			reported: this.reported.size,
			total: recordsTotal,
		});
		return { ...v, total: v.value, currency };
	}
}

/**
 * Damage, loss and recovery totals over an event's sector relation rows. The
 * sector-level cost is used when set, otherwise the asset rows. A cost that
 * no record reported is null and not_reported, never 0; money has no
 * tri-state source, so a summed 0 is a reported 0, never zero_confirmed
 * (TR-076, PD-04:596). Sums stay in the currency the rows carry; no
 * conversion (D-04, PD-09:1088).
 */
async function sumSectorEffects(
	rows: SectorRelationRow[],
	disasterEventId: string,
	countryAccountsId: string,
	currency: string,
	audience: ApprovalAudience,
): Promise<SectorEffects> {
	const damages = new CostSum();
	const losses = new CostSum();
	const recovery = new CostSum();
	const records = new Set<string>();

	for (const item of rows) {
		records.add(item.recordId);
		if (item.withDamage) {
			const damageCost = costOrNull(item.damageCost);
			if (damageCost !== null) {
				damages.add(item.recordId, damageCost);
			} else {
				try {
					const assets = await disasterEventTotalDamages_RecordsAssets__ById(
						disasterEventId,
						item.recordId,
						item.recordSector_SectorId,
						audience,
						countryAccountsId,
					);
					for (const a of assets) {
						damages.add(item.recordId, costOrNull(a.totalRepairReplacement));
					}
				} catch (error) {
					console.error(
						`Error processing damages for ${item.recordId}:`,
						error,
					);
				}
			}

			const recoveryCost = costOrNull(item.damageRecoveryCost);
			if (recoveryCost !== null) {
				recovery.add(item.recordId, recoveryCost);
			} else {
				try {
					const assets = await disasterEventTotalRecovery_RecordsAssets__ById(
						disasterEventId,
						item.recordId,
						item.recordSector_SectorId,
						audience,
						countryAccountsId,
					);
					for (const a of assets) {
						recovery.add(item.recordId, costOrNull(a.totalRecovery));
					}
				} catch (error) {
					console.error(
						`Error processing recovery for ${item.recordId}:`,
						error,
					);
				}
			}
		}

		if (item.withLosses) {
			const lossesCost = costOrNull(item.lossesCost);
			if (lossesCost !== null) {
				losses.add(item.recordId, lossesCost);
			} else {
				try {
					const assets = await disasterEventTotalLosses_RecordsAssets__ById(
						disasterEventId,
						item.recordId,
						item.recordSector_SectorId,
						audience,
						countryAccountsId,
					);
					for (const a of assets) {
						const pub = a.publicCostTotalOverride
							? costOrNull(a.publicCostTotal)
							: productOrNull(a.publicUnits, a.publicCostUnit);
						const priv = a.privateCostTotalOverride
							? costOrNull(a.privateCostTotal)
							: productOrNull(a.privateUnits, a.privateCostUnit);
						// A row reports a loss when either part carries a cost;
						// a missing part then adds nothing.
						losses.add(
							item.recordId,
							pub === null && priv === null ? null : (pub ?? 0) + (priv ?? 0),
						);
					}
				} catch (error) {
					console.error(`Error processing losses for ${item.recordId}:`, error);
				}
			}
		}
	}

	return {
		damages: damages.effect(records.size, currency),
		losses: losses.effect(records.size, currency),
		recovery: recovery.effect(records.size, currency),
	};
}

export async function disasterEventSectorTotal__ByDivisionId(
	countryAccountsId: string,
	disasterEventId: string,
	divisionId: string,
	currency: string,
	audience: ApprovalAudience,
): Promise<SectorEffects> {
	if (typeof disasterEventId !== "string") {
		throw new Error("Invalid ID: must be a string");
	}

	const queryRecordSectorTable = dr
		.selectDistinctOn(
			[disasterRecordsTable.id, sectorDisasterRecordsRelationTable.id],
			{
				recordId: disasterRecordsTable.id,
				recordSectorId: sectorDisasterRecordsRelationTable.id,
				recordSector_SectorId: sectorDisasterRecordsRelationTable.sectorId,
				withDamage: sectorDisasterRecordsRelationTable.withDamage,
				damageCost: sectorDisasterRecordsRelationTable.damageCost,
				damageCostCurrency:
					sectorDisasterRecordsRelationTable.damageCostCurrency,
				damageRecoveryCost:
					sectorDisasterRecordsRelationTable.damageRecoveryCost,
				damageRecoveryCostCurrency:
					sectorDisasterRecordsRelationTable.damageRecoveryCostCurrency,
				withLosses: sectorDisasterRecordsRelationTable.withLosses,
				lossesCost: sectorDisasterRecordsRelationTable.lossesCost,
				lossesCostCurrency:
					sectorDisasterRecordsRelationTable.lossesCostCurrency,
				// name: sql`(
				// 	1
				// )`.as('name'),
			},
		)
		.from(sectorDisasterRecordsRelationTable)
		.innerJoin(
			disasterRecordsTable,
			eq(
				disasterRecordsTable.id,
				sectorDisasterRecordsRelationTable.disasterRecordId,
			),
		)
		.innerJoin(
			disasterEventTable,
			eq(disasterEventTable.id, disasterRecordsTable.disasterEventId),
		)
		// .innerJoin(damagesTable, eq(damagesTable.recordId, disasterRecordsTable.id))
		.where(
			and(
				sql`EXISTS (
					SELECT 1
					FROM disaster_records_division drd
					WHERE drd.disaster_record_id = ${disasterRecordsTable.id}
						AND drd.division_id = ${divisionId}::uuid
				)`,
				eq(disasterRecordsTable.countryAccountsId, countryAccountsId),
				approvalBasis(audience, disasterRecordsTable),
				approvalBasis(audience, disasterEventTable),
				eq(disasterEventTable.id, disasterEventId),
				or(
					eq(sectorDisasterRecordsRelationTable.withDamage, true),
					eq(sectorDisasterRecordsRelationTable.withLosses, true),
				),
			),
		);

	// Execute the query
	const record = await queryRecordSectorTable.execute();
	return sumSectorEffects(
		record,
		disasterEventId,
		countryAccountsId,
		currency,
		audience,
	);
}

export async function disasterEventSectorTotal__ById(
	countryAccountsId: string,
	disasterEventId: string,
	isInSectorIds: string[] = [],
	currency: string,
	audience: ApprovalAudience,
): Promise<SectorEffects> {
	if (typeof disasterEventId !== "string") {
		throw new Error("Invalid ID: must be a string");
	}

	const queryRecordSectorTable = dr
		.selectDistinctOn(
			[disasterRecordsTable.id, sectorDisasterRecordsRelationTable.id],
			{
				recordId: disasterRecordsTable.id,
				recordSectorId: sectorDisasterRecordsRelationTable.id,
				recordSector_SectorId: sectorDisasterRecordsRelationTable.sectorId,
				withDamage: sectorDisasterRecordsRelationTable.withDamage,
				damageCost: sectorDisasterRecordsRelationTable.damageCost,
				damageCostCurrency:
					sectorDisasterRecordsRelationTable.damageCostCurrency,
				damageRecoveryCost:
					sectorDisasterRecordsRelationTable.damageRecoveryCost,
				damageRecoveryCostCurrency:
					sectorDisasterRecordsRelationTable.damageRecoveryCostCurrency,
				withLosses: sectorDisasterRecordsRelationTable.withLosses,
				lossesCost: sectorDisasterRecordsRelationTable.lossesCost,
				lossesCostCurrency:
					sectorDisasterRecordsRelationTable.lossesCostCurrency,
			},
		)
		.from(sectorDisasterRecordsRelationTable)
		.innerJoin(
			disasterRecordsTable,
			eq(
				disasterRecordsTable.id,
				sectorDisasterRecordsRelationTable.disasterRecordId,
			),
		)
		.innerJoin(
			disasterEventTable,
			eq(disasterEventTable.id, disasterRecordsTable.disasterEventId),
		)
		.where(
			and(
				eq(disasterRecordsTable.countryAccountsId, countryAccountsId),
				approvalBasis(audience, disasterRecordsTable),
				approvalBasis(audience, disasterEventTable),
				eq(disasterEventTable.id, disasterEventId),
				or(
					eq(sectorDisasterRecordsRelationTable.withDamage, true),
					eq(sectorDisasterRecordsRelationTable.withLosses, true),
				),
				isInSectorIds.length > 0
					? inArray(sectorDisasterRecordsRelationTable.sectorId, isInSectorIds)
					: undefined,
			),
		);

	// Execute the query
	const record = await queryRecordSectorTable.execute();
	return sumSectorEffects(
		record,
		disasterEventId,
		countryAccountsId,
		currency,
		audience,
	);
}

export async function disasterEventSectorDamageDetails__ById(
	ctx: BackendContext,
	disasterEventId: string,
	isInSectorIds: string[] = [],
	audience: ApprovalAudience,
) {
	if (typeof disasterEventId !== "string") {
		throw new Error("Invalid ID: must be a string");
	}

	const queryRecordSectorTable = dr
		.selectDistinctOn(
			[
				disasterEventTable.id,
				disasterRecordsTable.id,
				sectorDisasterRecordsRelationTable.id,
				damagesTable.id,
			],
			{
				recordId: disasterRecordsTable.id,
				damageId: damagesTable.id,
				damageTotalRepairReplacementCost: damagesTable.totalRepairReplacement,
				damageTotalRecoveryCost: damagesTable.totalRecovery,
				damageTotalNumberAssetAffected: damagesTable.totalDamageAmount,
				damageUnit: damagesTable.unit,
				assetId: assetTable.id,
				assetName: sql<string>`CASE
			WHEN ${assetTable.isBuiltIn} THEN dts_jsonb_localized(${assetTable.builtInName}, ${ctx.lang})
			ELSE ${assetTable.customName}
		END`.as("assetName"),
				assetIsBuiltIn: assetTable.isBuiltIn,
				sectorId: sectorTable.id,
				sectorName:
					sql<string>`dts_jsonb_localized(${sectorTable.name}, ${ctx.lang})`.as(
						"sectorname",
					),
			},
		)
		.from(sectorDisasterRecordsRelationTable)
		.innerJoin(
			disasterRecordsTable,
			and(
				eq(
					disasterRecordsTable.id,
					sectorDisasterRecordsRelationTable.disasterRecordId,
				),
				eq(sectorDisasterRecordsRelationTable.withDamage, true),
			),
		)
		.innerJoin(
			disasterEventTable,
			eq(disasterEventTable.id, disasterRecordsTable.disasterEventId),
		)
		.innerJoin(
			damagesTable,
			and(
				eq(damagesTable.recordId, disasterRecordsTable.id),
				eq(damagesTable.sectorId, sectorDisasterRecordsRelationTable.sectorId),
			),
		)
		.innerJoin(assetTable, eq(assetTable.id, damagesTable.assetId))
		.innerJoin(
			sectorTable,
			eq(sectorTable.id, sectorDisasterRecordsRelationTable.sectorId),
		)
		.where(
			and(
				approvalBasis(audience, disasterRecordsTable),
				approvalBasis(audience, disasterEventTable),
				eq(disasterEventTable.id, disasterEventId),
				isInSectorIds.length > 0
					? inArray(damagesTable.sectorId, isInSectorIds)
					: undefined,
			),
		);

	// Execute the query
	const record = await queryRecordSectorTable.execute();

	return record;
}

export async function disasterEventSectorLossesDetails__ById(
	ctx: BackendContext,
	disasterEventId: string,
	isInSectorIds: string[] = [],
	audience: ApprovalAudience,
) {
	if (typeof disasterEventId !== "string") {
		throw new Error("Invalid ID: must be a string");
	}

	const queryRecordSectorTable = dr
		.selectDistinctOn(
			[
				disasterEventTable.id,
				disasterRecordsTable.id,
				sectorDisasterRecordsRelationTable.id,
				lossesTable.id,
			],
			{
				recordId: disasterRecordsTable.id,
				lossesId: lossesTable.id,
				lossesDesc: lossesTable.description,
				lossesTotalPrivateCost: lossesTable.privateCostTotal,
				lossesTotalPrivateUnit: lossesTable.privateUnit,
				lossesTotalPrivateCostCurrency: lossesTable.privateCostUnitCurrency,
				lossesTotalPublicCost: lossesTable.publicCostTotal,
				lossesTotalPublicUnit: lossesTable.publicUnit,
				lossesTotalPublicCostCurrency: lossesTable.publicCostUnitCurrency,
				lossesSectorIsAgriculture: lossesTable.sectorIsAgriculture,
				lossesType: lossesTable.sectorIsAgriculture
					? lossesTable.typeAgriculture
					: lossesTable.typeNotAgriculture,
				lossesRelatedTo: lossesTable.sectorIsAgriculture
					? lossesTable.relatedToAgriculture
					: lossesTable.relatedToNotAgriculture,
				sectorId: sectorTable.id,
				sectorName:
					sql<string>`dts_jsonb_localized(${sectorTable.name}, ${ctx.lang})`.as(
						"sectorname",
					),
			},
		)
		.from(sectorDisasterRecordsRelationTable)
		.innerJoin(
			disasterRecordsTable,
			and(
				eq(
					disasterRecordsTable.id,
					sectorDisasterRecordsRelationTable.disasterRecordId,
				),
				eq(sectorDisasterRecordsRelationTable.withLosses, true),
			),
		)
		.innerJoin(
			disasterEventTable,
			eq(disasterEventTable.id, disasterRecordsTable.disasterEventId),
		)
		.innerJoin(
			lossesTable,
			and(
				eq(lossesTable.recordId, disasterRecordsTable.id),
				eq(lossesTable.sectorId, sectorDisasterRecordsRelationTable.sectorId),
			),
		)
		.innerJoin(
			sectorTable,
			eq(sectorTable.id, sectorDisasterRecordsRelationTable.sectorId),
		)
		.where(
			and(
				approvalBasis(audience, disasterRecordsTable),
				approvalBasis(audience, disasterEventTable),
				eq(disasterEventTable.id, disasterEventId),
				isInSectorIds.length > 0
					? inArray(lossesTable.sectorId, isInSectorIds)
					: undefined,
			),
		);

	// Execute the query
	const record = await queryRecordSectorTable.execute();

	return record;
}

export async function disasterEventSectorDisruptionDetails__ById(
	ctx: BackendContext,
	disasterEventId: string,
	isInSectorIds: string[] = [],
	audience: ApprovalAudience,
) {
	if (typeof disasterEventId !== "string") {
		throw new Error("Invalid ID: must be a string");
	}

	const queryRecordSectorTable = dr
		.selectDistinctOn(
			[
				disasterEventTable.id,
				disasterRecordsTable.id,
				sectorDisasterRecordsRelationTable.id,
				disruptionTable.id,
			],
			{
				recordId: disasterRecordsTable.id,
				disruptionId: disruptionTable.id,
				disruptionDurationDays: disruptionTable.durationDays,
				disruptionDurationHours: disruptionTable.durationHours,
				disruptionUsersAffected: disruptionTable.usersAffected,
				disruptionPeopleAffected: disruptionTable.peopleAffected,
				disruptionResponseCost: disruptionTable.responseCost,
				disruptionResponseCurrency: disruptionTable.responseCurrency,
				sectorId: sectorTable.id,
				sectorName:
					sql<string>`dts_jsonb_localized(${sectorTable.name}, ${ctx.lang})`.as(
						"sectorname",
					),
			},
		)
		.from(sectorDisasterRecordsRelationTable)
		.innerJoin(
			disasterRecordsTable,
			and(
				eq(
					disasterRecordsTable.id,
					sectorDisasterRecordsRelationTable.disasterRecordId,
				),
				eq(sectorDisasterRecordsRelationTable.withDisruption, true),
			),
		)
		.innerJoin(
			disasterEventTable,
			eq(disasterEventTable.id, disasterRecordsTable.disasterEventId),
		)
		.innerJoin(
			disruptionTable,
			and(
				eq(disruptionTable.recordId, disasterRecordsTable.id),
				eq(
					disruptionTable.sectorId,
					sectorDisasterRecordsRelationTable.sectorId,
				),
			),
		)
		.innerJoin(
			sectorTable,
			eq(sectorTable.id, sectorDisasterRecordsRelationTable.sectorId),
		)
		.where(
			and(
				approvalBasis(audience, disasterRecordsTable),
				approvalBasis(audience, disasterEventTable),
				eq(disasterEventTable.id, disasterEventId),
				isInSectorIds.length > 0
					? inArray(disruptionTable.sectorId, isInSectorIds)
					: undefined,
			),
		);

	// Execute the query
	const record = await queryRecordSectorTable.execute();

	return record;
}
