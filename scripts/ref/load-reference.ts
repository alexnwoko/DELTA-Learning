// E1 (Enrichment Data Integration, section 7.1): loads reference values
// (population first) from a CSV into the ref schema.
//
// The CSV columns follow delta_reference_value.schema.json plus iso3.
// division_key is the division's national_id or import_id within the tenant;
// the country's iso3 or "national" means the national value.
//
// Usage (inside a container with node_modules, DATABASE_URL set):
//   npx tsx scripts/ref/load-reference.ts <file.csv> [--dry-run] [--tenant <country_accounts_id>]
//
// --dry-run runs the full load in a transaction that is rolled back and
// prints the counts. Without --tenant, each row's iso3 must match exactly
// one country account. Invalid rows are rejected and listed; valid rows are
// upserted, so a second run of the same file changes nothing. Exit code: 0
// when every row loaded, 2 when any row was rejected, 1 on a file error.

import { readFileSync } from "fs";
import { endDB, initDB } from "~/db.server";
import { loadReferenceCsv } from "~/backend.server/models/ref/referenceLoader";

function usage(msg?: string): never {
	if (msg) console.error(msg);
	console.error(
		"usage: tsx scripts/ref/load-reference.ts <file.csv> [--dry-run] [--tenant <country_accounts_id>]",
	);
	process.exit(1);
}

function parseArgs(argv: string[]) {
	let file: string | undefined;
	let dryRun = false;
	let tenant: string | undefined;
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--dry-run") dryRun = true;
		else if (a === "--tenant") {
			tenant = argv[++i];
			if (!tenant) usage("--tenant needs a value");
		} else if (a.startsWith("--")) usage(`unknown option ${a}`);
		else if (!file) file = a;
		else usage(`unexpected argument ${a}`);
	}
	if (!file) usage();
	return { file, dryRun, tenant };
}

async function main() {
	const { file, dryRun, tenant } = parseArgs(process.argv.slice(2));
	const text = readFileSync(file, "utf8");
	initDB();
	try {
		const report = await loadReferenceCsv(text, {
			dryRun,
			countryAccountsId: tenant,
		});
		const { rejected, ...counts } = report;
		console.log(JSON.stringify(counts, null, 2));
		if (report.fileErrors.length > 0) {
			for (const e of report.fileErrors) console.error(`file error: ${e}`);
			process.exitCode = 1;
			return;
		}
		if (rejected.length > 0) {
			console.error(`rejected ${rejected.length} row(s):`);
			for (const r of rejected) {
				console.error(
					`  row ${r.row} (${r.iso3 || "?"} ${r.divisionKey || "?"}): ${r.errors.join("; ")}`,
				);
			}
			process.exitCode = 2;
		}
	} finally {
		await endDB();
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
