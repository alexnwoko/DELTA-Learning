// Recomputes the stored cost totals of disaster events that hold a computed 0
// (Alex approved, 2026-10-26). The totals are rebuilt with the app's own
// updateTotals, so a total with nothing reported becomes empty (null) and a
// reported 0 stays 0. No source record is changed; only the four *_calc
// columns on disaster_event are rewritten.
//
// Usage (inside a container with node_modules, DATABASE_URL set):
//   npx tsx scripts/analytics/recompute-event-cost-totals.ts [--dry-run]
// --dry-run rebuilds inside a transaction that is rolled back and prints the
// counts it would leave.

import { sql } from "drizzle-orm";
import { dr, endDB, initDB } from "~/db.server";
import { updateTotals } from "~/backend.server/models/analytics/disaster-events-cost-calculator";

const ZERO = sql`(repair_costs_local_currency_calc::numeric = 0
	OR replacement_costs_local_currency_calc::numeric = 0
	OR rehabilitation_costs_local_currency_calc::numeric = 0
	OR recovery_needs_local_currency_calc::numeric = 0)`;

class DryRun extends Error {}

async function counts(q: typeof dr) {
	const r = await q.execute(sql`
		SELECT COUNT(*) FILTER (WHERE ${ZERO}) AS zero,
			COUNT(*) FILTER (WHERE repair_costs_local_currency_calc IS NULL
				AND replacement_costs_local_currency_calc IS NULL
				AND rehabilitation_costs_local_currency_calc IS NULL
				AND recovery_needs_local_currency_calc IS NULL) AS empty,
			COUNT(*) AS events
		FROM disaster_event`);
	return r.rows[0];
}

async function main() {
	const dryRun = process.argv.includes("--dry-run");
	initDB();
	try {
		console.log("before", await counts(dr));
		await dr.transaction(async (tx) => {
			const ids = await tx.execute(
				sql`SELECT id FROM disaster_event WHERE ${ZERO}`,
			);
			for (const row of ids.rows as { id: string }[])
				await updateTotals(tx, row.id);
			console.log(`recomputed ${ids.rows.length} events`);
			console.log("after", await counts(tx as unknown as typeof dr));
			if (dryRun) throw new DryRun();
		});
	} catch (e) {
		if (!(e instanceof DryRun)) throw e;
		console.log("dry run: rolled back");
	} finally {
		await endDB();
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
