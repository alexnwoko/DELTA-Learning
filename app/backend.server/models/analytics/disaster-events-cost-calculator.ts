import { Tx } from "~/db.server";
import { sectorDisasterRecordsRelationTable } from "~/drizzle/schema/sectorDisasterRecordsRelationTable";
import { disasterRecordsTable } from "~/drizzle/schema/disasterRecordsTable";
import { damagesTable } from "~/drizzle/schema/damagesTable";
import { disruptionTable } from "~/drizzle/schema/disruptionTable";
import { disasterEventTable } from "~/drizzle/schema/disasterEventTable";
import { and, eq, inArray } from "drizzle-orm";

// Null is not zero: a total is null when no linked value is reported, so an
// event with nothing recorded stays empty instead of showing 0 (1,984 events
// held a computed 0 this way). A reported 0 still counts as 0.
interface Totals {
	repairCost: string | null;
	replacementCost: string | null;
	rehabilitationCost: string | null;
	recoveryCost: string | null;
}

/** Sum of the reported values; null when none is reported. */
export function sumReported(
	values: (string | number | null | undefined)[],
): number | null {
	let any = false;
	let total = 0;
	for (const v of values) {
		if (v === null || v === undefined || v === "") continue;
		const n = Number(v);
		if (!Number.isFinite(n)) continue;
		any = true;
		total += n;
	}
	return any ? total : null;
}

const asText = (n: number | null) => (n === null ? null : String(n));

export async function updateTotals(tx: Tx, disasterEventId: string) {
	let totals = await calculateTotals(tx, disasterEventId);

	await tx
		.update(disasterEventTable)
		.set({
			repairCostsLocalCurrencyCalc: totals.repairCost,
			replacementCostsLocalCurrencyCalc: totals.replacementCost,
			rehabilitationCostsLocalCurrencyCalc: totals.rehabilitationCost,
			recoveryNeedsLocalCurrencyCalc: totals.recoveryCost,
		})
		.where(eq(disasterEventTable.id, disasterEventId));
}

export async function updateTotalsUsingDisasterRecordId(
	tx: Tx,
	disasterRecordId: string,
) {
	let rows = await tx
		.select({
			disasterEventId: disasterRecordsTable.disasterEventId,
		})
		.from(disasterRecordsTable)
		.where(eq(disasterRecordsTable.id, disasterRecordId))
		.execute();
	if (!rows.length) throw new Error("disaster record not found by id");
	// not all are linked to disaster event
	if (!rows[0].disasterEventId) return;
	await updateTotals(tx, rows[0].disasterEventId);
}

export async function calculateTotals(
	tx: Tx,
	disasterEventId: string,
): Promise<Totals> {
	let repairCostNum = await calculateTotalRepairCost(tx, disasterEventId);
	let replacementCostNum = await calculateTotalReplacementCost(
		tx,
		disasterEventId,
	);
	let rehabilitationCostNum = await calculateTotalRehabilitationCost(
		tx,
		disasterEventId,
	);
	let recoveryCostNum = await calculateTotalRecoveryCost(tx, disasterEventId);

	return {
		repairCost: asText(repairCostNum),
		replacementCost: asText(replacementCostNum),
		rehabilitationCost: asText(rehabilitationCostNum),
		recoveryCost: asText(recoveryCostNum),
	};
}

/**
 * Calculates the total repair cost of a disaster event.
 */
export const calculateTotalRepairCost = async (
	tx: Tx,
	disaster_event_id: string,
): Promise<number | null> => {
	if (!disaster_event_id) {
		throw new Error("Missing disaster_event_id");
	}

	try {
		// Fetch all disaster records linked to the disaster event
		const disasterRecords = await tx
			.select({ id: disasterRecordsTable.id })
			.from(disasterRecordsTable)
			.where(eq(disasterRecordsTable.disasterEventId, disaster_event_id));

		const recordIds = disasterRecords.map((record) => record.id);
		if (recordIds.length === 0) {
			return null;
		}

		// Fetch all damages linked to thedisaster records
		const damages = await tx
			.select({ pdRepairCostTotal: damagesTable.pdRepairCostTotal })
			.from(damagesTable)
			.where(inArray(damagesTable.recordId, recordIds));

		return sumReported(damages.map((d) => d.pdRepairCostTotal));
	} catch (error) {
		console.error("Error fetching repair cost:", error);
		throw new Error("Internal server error");
	}
};

/**
 * Calculates the total replacement cost of a disaster event.
 */
export const calculateTotalReplacementCost = async (
	tx: Tx,
	disaster_event_id: string,
): Promise<number | null> => {
	if (!disaster_event_id) {
		throw new Error("Missing disaster_event_id");
	}

	try {
		// Fetch all disaster records linked to the disaster event
		const disasterRecords = await tx
			.select({ id: disasterRecordsTable.id })
			.from(disasterRecordsTable)
			.where(eq(disasterRecordsTable.disasterEventId, disaster_event_id));

		const recordIds = disasterRecords.map((record) => record.id);
		if (recordIds.length === 0) {
			return null;
		}

		// Fetch all damages linked to the disaster records
		const damages = await tx
			.select({ tdReplacementCostTotal: damagesTable.tdReplacementCostTotal })
			.from(damagesTable)
			.where(inArray(damagesTable.recordId, recordIds));

		return sumReported(damages.map((d) => d.tdReplacementCostTotal));
	} catch (error) {
		console.error("Error fetching replacement cost:", error);
		throw new Error("Internal server error");
	}
};

export const calculateTotalRehabilitationCost = async (
	tx: Tx,
	disaster_event_id: string,
): Promise<number | null> => {
	if (!disaster_event_id) {
		throw new Error("Missing disaster_event_id");
	}

	try {
		// Fetch all disaster record IDs linked to the given disaster event
		const disasterRecords = await tx
			.select({ id: disasterRecordsTable.id })
			.from(disasterRecordsTable)
			.where(eq(disasterRecordsTable.disasterEventId, disaster_event_id));

		const recordIds = disasterRecords.map((record) => record.id);
		if (recordIds.length === 0) {
			return null;
		}

		// Fetch all disruption linked to the disaster records
		const disruptions = await tx
			.select({
				responseCost: disruptionTable.responseCost,
			})
			.from(disruptionTable)
			.where(inArray(disruptionTable.recordId, recordIds));

		return sumReported(disruptions.map((d) => d.responseCost));
	} catch (error) {
		console.error("Error fetching repair cost:", error);
		throw new Error("Internal server error");
	}
};

/**
 * Calculates total recovery cost for a disaster event using a two-level fallback.
 *
 * For each sector-disaster record pair:
 * 1. Use `sector_disaster_records_relation.damage_recovery_cost` if set
 * 2. Otherwise, sum `damages.total_recovery` for that record+sector combination
 *
 * Null when no value is reported (null is not zero).
 *
 * The N+1 query pattern (one query per sector per record) could be a performance
 * issue for events with many records and sectors.
 */
export const calculateTotalRecoveryCost = async (
	tx: Tx,
	disaster_event_id: string,
): Promise<number | null> => {
	if (!disaster_event_id) {
		throw new Error("Missing disaster_event_id");
	}

	try {
		// Fetch all disaster record IDs linked to the given disaster event
		const disasterRecords = await tx
			.select({ id: disasterRecordsTable.id })
			.from(disasterRecordsTable)
			.where(eq(disasterRecordsTable.disasterEventId, disaster_event_id));

		const recordIds = disasterRecords.map((record) => record.id);
		if (recordIds.length === 0) {
			return null;
		}

		//Get the recovery cost from sector_disaster_records_relation.damage_recovery_cost if exit
		const sectorDisasterRecordsRelations = await tx
			.select({
				damageRecoveryCost:
					sectorDisasterRecordsRelationTable.damageRecoveryCost,
				sectorId: sectorDisasterRecordsRelationTable.sectorId,
				recordId: sectorDisasterRecordsRelationTable.disasterRecordId,
			})
			.from(sectorDisasterRecordsRelationTable)
			.where(
				inArray(sectorDisasterRecordsRelationTable.disasterRecordId, recordIds),
			);

		const parts: (string | number | null)[] = [];
		for (const sectorDisaster of sectorDisasterRecordsRelations) {
			if (
				sectorDisaster.damageRecoveryCost !== null &&
				sectorDisaster.damageRecoveryCost !== undefined
			) {
				parts.push(sectorDisaster.damageRecoveryCost);
			} else {
				// Check in damages.td_recovery_cost_total
				// Fetch all damages linked to the disaster records
				const damages = await tx
					.select({
						totalRecovery: damagesTable.totalRecovery,
					})
					.from(damagesTable)
					.where(
						and(
							eq(damagesTable.recordId, sectorDisaster.recordId),
							eq(damagesTable.sectorId, sectorDisaster.sectorId),
						),
					);

				for (const damage of damages) parts.push(damage.totalRecovery);
			}
		}

		return sumReported(parts);
	} catch (error) {
		console.error("Error fetching repair cost:", error);
		throw new Error("Internal server error");
	}
};
