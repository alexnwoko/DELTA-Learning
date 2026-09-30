import { SQL, sql } from "drizzle-orm";
import { dr } from "~/db.server";
import { notRetired } from "~/utils/approvalBasis";

// C23 item 2: the reconciliation basis. Safeguard 4 (plan section 5A)
// reconciles a migration run while its records are still draft, so this basis
// includes every approval status. It is separate from the approval basis on
// purpose and has exactly two consumers: the loader read-back and the
// safeguard 4 reconciliation. It is scoped to one tenant and one migration
// run (legacy_data.migration.run_id, stamped by the loader on every record)
// and excludes retired records like every other basis.
//
// Server only, and never imported by a route module: no public route can
// reach it (tests/unit/utils/approvalBasis.test.ts checks this).
// A caller outside this server must first authenticate and resolve the
// tenant from its own credentials, never from a request parameter.

export interface ReconciliationScope {
	/** The tenant, resolved from an authenticated session or API key. */
	countryAccountsId: string;
	/** The migration run id stamped in legacy_data.migration.run_id. */
	runId: string;
}

function assertScope(scope: ReconciliationScope) {
	if (!scope?.countryAccountsId || !scope?.runId) {
		throw new Error(
			"reconciliation basis needs a tenant and a migration run id",
		);
	}
}

/**
 * The reconciliation basis for disaster_records under a raw SQL alias (or
 * unqualified). Every approval status is included; retired records are not.
 */
export function reconciliationBasis(
	scope: ReconciliationScope,
	alias?: string,
): SQL {
	assertScope(scope);
	const p = alias ? sql`${sql.identifier(alias)}.` : sql``;
	return sql`(${p}"country_accounts_id" = ${scope.countryAccountsId}
		AND (${p}"legacy_data" -> 'migration' ->> 'run_id') = ${scope.runId}
		AND ${notRetired(sql`${p}"legacy_data"`)})`;
}

export const RECONCILIATION_MEASURES = [
	"deaths",
	"injured",
	"missing",
	"displaced",
	"affected_direct",
	"affected_indirect",
] as const;

export type ReconciliationMeasure = (typeof RECONCILIATION_MEASURES)[number];

export interface MeasureReadBack {
	/** Records whose stored total is above 0. */
	valuePositive: number;
	/** Records whose stored total is 0. */
	totalZero: number;
	/** Records with no stored total (including records with no presence row). */
	totalNull: number;
	sum: number;
	flagTrue: number;
	flagNull: number;
	flagFalse: number;
}

export interface ReconciliationReadBack {
	records: number;
	byApprovalStatus: Record<string, number>;
	measures: Record<ReconciliationMeasure, MeasureReadBack>;
}

/**
 * Read-back of one migration run for one tenant, in the shape of the Angola
 * read-side reconciliation: record count, approval status split and, per
 * human-effects measure, the stored flag and total states from
 * human_category_presence. The caller diffs these against the migration
 * ledger.
 */
export async function reconciliationReadBack(
	scope: ReconciliationScope,
): Promise<ReconciliationReadBack> {
	const basis = reconciliationBasis(scope, "dr");

	const statusRes = await dr.execute(sql`
		SELECT dr."approvalStatus" AS status, COUNT(*)::int AS n
		FROM disaster_records dr
		WHERE ${basis}
		GROUP BY dr."approvalStatus"
	`);
	const byApprovalStatus: Record<string, number> = {};
	let records = 0;
	for (const row of statusRes.rows as { status: string; n: number }[]) {
		byApprovalStatus[row.status] = Number(row.n);
		records += Number(row.n);
	}

	const parts = RECONCILIATION_MEASURES.map((m) => {
		const flag = sql.raw(`hcp."${m}"`);
		const total = sql.raw(`hcp."${m}_total"`);
		return sql`
			COUNT(*) FILTER (WHERE ${total} > 0)::int AS ${sql.raw(`"${m}_value_positive"`)},
			COUNT(*) FILTER (WHERE ${total} = 0)::int AS ${sql.raw(`"${m}_total_zero"`)},
			COUNT(*) FILTER (WHERE ${total} IS NULL)::int AS ${sql.raw(`"${m}_total_null"`)},
			COALESCE(SUM(${total}), 0)::bigint AS ${sql.raw(`"${m}_sum"`)},
			COUNT(*) FILTER (WHERE ${flag} IS TRUE)::int AS ${sql.raw(`"${m}_flag_true"`)},
			COUNT(*) FILTER (WHERE ${flag} IS NULL)::int AS ${sql.raw(`"${m}_flag_null"`)},
			COUNT(*) FILTER (WHERE ${flag} IS FALSE)::int AS ${sql.raw(`"${m}_flag_false"`)}`;
	});
	const measureRes = await dr.execute(sql`
		SELECT ${sql.join(parts, sql`, `)}
		FROM disaster_records dr
		LEFT JOIN human_category_presence hcp ON hcp.record_id = dr.id
		WHERE ${basis}
	`);
	const row = (measureRes.rows[0] ?? {}) as Record<string, unknown>;
	const n = (k: string) => Number(row[k] ?? 0);
	const measures = Object.fromEntries(
		RECONCILIATION_MEASURES.map((m) => [
			m,
			{
				valuePositive: n(`${m}_value_positive`),
				totalZero: n(`${m}_total_zero`),
				totalNull: n(`${m}_total_null`),
				sum: n(`${m}_sum`),
				flagTrue: n(`${m}_flag_true`),
				flagNull: n(`${m}_flag_null`),
				flagFalse: n(`${m}_flag_false`),
			},
		]),
	) as Record<ReconciliationMeasure, MeasureReadBack>;

	return { records, byApprovalStatus, measures };
}
