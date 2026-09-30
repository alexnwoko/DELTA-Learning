import { SQL, sql } from "drizzle-orm";
import type { approvalStatusIds } from "~/frontend/approval";
import { isRetiredLegacyData } from "~/utils/provisional";

// C23 (solution pack, decision 19): the one approval basis for every
// analytics and public read path. Call sites never write their own
// approvalStatus filter; they ask this module for the basis of the audience
// they serve.
//
// - public: requests without a signed-in user.
// - signed-in: requests with a signed-in user. Follows D-04.
// - official: official and Sendai Framework Monitor exports. Never follows
//   D-04, so provisional records can never enter them.
//
// Every basis excludes retired records (DEC-012, standard OP-29).
//
// Builds SQL only, no database access: safe for server and client code (the
// content picker configs are shared with the browser). The request audience
// comes from ~/backend.server/approvalAudience.server.

export type ApprovalAudience = "public" | "signed-in" | "official";

export const PUBLIC_BASIS_STATUSES: readonly approvalStatusIds[] = [
	"published",
];

/**
 * D-04 is not ruled. Until Alex rules it, signed-in views see published
 * records only (pack decision 19). The ruling changes this one line.
 */
export const SIGNED_IN_BASIS_STATUSES: readonly approvalStatusIds[] = [
	"published",
];

export const OFFICIAL_BASIS_STATUSES: readonly approvalStatusIds[] = [
	"published",
];

export function basisStatuses(
	audience: ApprovalAudience,
): readonly approvalStatusIds[] {
	switch (audience) {
		case "public":
			return PUBLIC_BASIS_STATUSES;
		case "signed-in":
			return SIGNED_IN_BASIS_STATUSES;
		case "official":
			return OFFICIAL_BASIS_STATUSES;
	}
}

/**
 * True when the basis can admit records below published, so figures built
 * on it may include provisional records and must carry the
 * "provisional, not for citation" label.
 */
export function basisIncludesProvisional(audience: ApprovalAudience): boolean {
	return basisStatuses(audience).some((s) => s !== "published");
}

export interface BasisColumns {
	/** The approvalStatus column (a Drizzle column or raw SQL). */
	approvalStatus: unknown;
	/**
	 * The legacy_data column. Omit only for tables that have none
	 * (hazardous_event); every migrated record carries one.
	 */
	legacyData?: unknown;
}

/**
 * Columns of a table referenced through a raw SQL alias, for example
 * basisColumns("dr") for `disaster_records dr`. Without an alias the columns
 * are unqualified.
 */
export function basisColumns(
	alias?: string,
	opts: { legacyData?: boolean } = { legacyData: true },
): BasisColumns {
	const prefix = alias ? sql`${sql.identifier(alias)}.` : sql``;
	return {
		approvalStatus: sql`${prefix}"approvalStatus"`,
		legacyData:
			opts.legacyData === false ? undefined : sql`${prefix}"legacy_data"`,
	};
}

/**
 * SQL condition that is true for records that are not retired. The retired
 * marker is not stored yet (OP-29 gap): DEC-012 says it will live in
 * legacy_data.migration. The condition is written against
 * legacy_data->'migration'->'retired' and is a no-op until the loader writes
 * that key; a JSON null or false there does not retire the record.
 */
export function notRetired(legacyData: unknown): SQL {
	return sql`COALESCE((${legacyData} -> 'migration' -> 'retired') IN ('null'::jsonb, 'false'::jsonb), TRUE)`;
}

/**
 * The approval basis for one audience: the allowed approval statuses, minus
 * retired records.
 */
export function approvalBasis(
	audience: ApprovalAudience,
	cols: BasisColumns,
): SQL {
	const statuses = basisStatuses(audience);
	const statusList = sql.join(
		statuses.map((s) => sql`${s}`),
		sql`, `,
	);
	const statusCondition = sql`${cols.approvalStatus} IN (${statusList})`;
	if (cols.legacyData === undefined) {
		return sql`(${statusCondition})`;
	}
	return sql`(${statusCondition} AND ${notRetired(cols.legacyData)})`;
}

/**
 * The same basis applied to a row already in memory, for detail views that
 * load one record and then decide whether the audience may see it.
 */
export function rowOnApprovalBasis(
	audience: ApprovalAudience,
	row: { approvalStatus?: string | null; legacyData?: unknown },
): boolean {
	if (!row.approvalStatus) return false;
	if (
		!basisStatuses(audience).includes(row.approvalStatus as approvalStatusIds)
	)
		return false;
	return !isRetiredLegacyData(row.legacyData);
}

/**
 * SQL for "this row is a migrated record not yet published", used to label
 * provisional records in signed-in lists.
 */
export function provisionalSql(cols: BasisColumns): SQL<boolean> {
	return sql<boolean>`(${cols.approvalStatus} <> 'published' AND (${cols.legacyData} -> 'migration' ->> 'run_id') IS NOT NULL)`;
}
