// C29 (solution pack): the increment 1 exit gate on the real Angola load.
//
// Compares the six human-effects headline measures in the local database with
// the migration ledger, through the C23 reconciliation basis (one tenant, one
// migration run, drafts included, retired excluded). Two readings per measure:
//   - the stored read-back (reconciliationReadBack): records by stored total;
//   - the analytics headline (getAffectedPeopleByHazardFilters with the
//     reconciliation basis): sum, value state, record counts, flagged count.
// The ledger is tests/fixtures/migrated/ago_realload_ledger.json, built by
// scripts/c29/build_migrated_fixture.py from Angola's delta_ready.jsonl with
// the loader's own he_measure_state and compute_plausibility_flags.
//
// Reads only: the database session is opened with
// default_transaction_read_only=on. Prints a JSON result and a Markdown
// table for the reconciliation document; exits 1 when any check fails.
//
// Run inside the app container:
//   docker exec delta-local-app sh -c 'cd /delta && npx tsx scripts/c29/angola_exit_gate.ts'

import { readFileSync } from "fs";
import path from "path";
import { endDB, initDB } from "~/db.server";
import { getAffectedPeopleByHazardFilters } from "~/backend.server/models/analytics/hazard-analysis";
import {
	RECONCILIATION_MEASURES,
	reconciliationReadBack,
	reconciliationRecordBasis,
} from "~/backend.server/models/reconciliationBasis.server";

const LEDGER = path.resolve(
	process.cwd(),
	"tests/fixtures/migrated/ago_realload_ledger.json",
);

function readOnlyUrl(raw: string): string {
	const u = new URL(raw);
	u.searchParams.set("options", "-c default_transaction_read_only=on");
	return u.toString();
}

interface Check {
	measure: string;
	field: string;
	ledger: number | string | null;
	delta: number | string | null;
	pass: boolean;
}

async function main() {
	const ledger = JSON.parse(readFileSync(LEDGER, "utf8"));
	if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL missing");
	process.env.DATABASE_URL = readOnlyUrl(process.env.DATABASE_URL);
	initDB();

	const scope = { countryAccountsId: ledger.tenant, runId: ledger.run_id };
	const readBack = await reconciliationReadBack(scope);
	const headline = await getAffectedPeopleByHazardFilters(
		{
			countryAccountsId: ledger.tenant,
			audience: "public",
			hazardTypeId: null,
			hazardClusterId: null,
			specificHazardId: null,
			geographicLevelId: null,
			fromDate: null,
			toDate: null,
		},
		reconciliationRecordBasis(scope),
	);

	const checks: Check[] = [];
	const add = (
		measure: string,
		field: string,
		l: number | string | null,
		d: number | string | null,
	) => checks.push({ measure, field, ledger: l, delta: d, pass: l === d });

	add("records", "count", ledger.records, readBack.records);
	add("records", "draft", ledger.records, readBack.byApprovalStatus.draft ?? 0);

	for (const m of RECONCILIATION_MEASURES) {
		const e = ledger.national[m];
		const rb = readBack.measures[m];
		const h = headline.measures[m];
		add(m, "stored value > 0", e.reported, rb.valuePositive);
		add(m, "stored total = 0", e.zero_confirmed, rb.totalZero);
		add(m, "stored total NULL", e.not_reported, rb.totalNull);
		add(m, "stored sum", e.sum ?? 0, rb.sum);
		add(m, "headline value", e.sum, h.value);
		add(m, "headline value state", e.value_state, h.valueState);
		add(m, "headline reported", e.reported, h.recordsReported);
		add(m, "headline zero confirmed", e.zero_confirmed, h.recordsZeroConfirmed);
		add(m, "headline not reported", e.not_reported, h.recordsNotReported);
		add(m, "headline records", e.records_total, h.recordsTotal);
		add(m, "headline flagged", e.flagged, h.recordsFlagged);
		// A flag must never contradict the stored total.
		add(m, "flag false with a value", 0, rb.flagFalse);
	}

	const passed = checks.every((c) => c.pass);
	const byMeasure = RECONCILIATION_MEASURES.map((m) => {
		const e = ledger.national[m];
		const h = headline.measures[m];
		const ok = checks.filter((c) => c.measure === m).every((c) => c.pass);
		return `| ${m} | ${e.sum ?? "NULL"} / ${e.value_state} / ${e.reported}, ${e.zero_confirmed}, ${e.not_reported} / ${e.flagged} | ${h.value ?? "NULL"} / ${h.valueState} / ${h.recordsReported}, ${h.recordsZeroConfirmed}, ${h.recordsNotReported} / ${h.recordsFlagged} | ${ok ? "Pass" : "Fail"} |`;
	});
	const markdown = [
		`| Measure | Ledger: sum / state / reported, zero, not reported / flagged | DELTA (reconciliation basis): same | Result |`,
		`|---|---|---|---|`,
		...byMeasure,
	].join("\n");

	const result = {
		gate: "C29 Angola exit gate",
		ranAt: new Date().toISOString(),
		tenant: ledger.tenant,
		runId: ledger.run_id,
		records: readBack.records,
		byApprovalStatus: readBack.byApprovalStatus,
		passed,
		failed: checks.filter((c) => !c.pass),
		checks: checks.length,
	};
	console.log(JSON.stringify(result, null, 1));
	console.log("\n" + markdown);
	await endDB();
	process.exit(passed ? 0 : 1);
}

main().catch(async (e) => {
	console.error(e);
	process.exit(2);
});
