// Monthly refresh of the one exchange rate DELTA uses for US dollars (Alex,
// 2026-10-22): the World Bank official exchange rate, PA.NUS.FCRF (local
// currency units per US dollar, annual average). No other rate is loaded.
//
// The World Bank updates World Development Indicators on no fixed date, so
// this runs on the first of every month, in two steps. The fetch step
// (scripts/ref/fetch-worldbank-fx.sh, on a machine with internet access)
// asks the API when WDI was last updated and saves the rate file into
// <dir>/<lastupdated>/ only when that release is new. This load step reads
// the newest saved release and does nothing when it is already loaded;
// otherwise it builds one national row per tenant and year and loads them as
// a new ref release. Earlier releases stay in the store for audit; the cost
// panels read only the newest one.
//
// Usage (inside a container with node_modules, DATABASE_URL set):
//   npx tsx scripts/ref/refresh-worldbank-fx.ts --from <dir> [--dry-run]
// Exit code: 0 when up to date or loaded, 2 when any row was rejected, 1 on
// an error.

import { existsSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { sql } from "drizzle-orm";
import { dr, endDB, initDB } from "~/db.server";
import {
	CSV_COLUMNS,
	loadReferenceCsv,
} from "~/backend.server/models/ref/referenceLoader";

const INDICATOR = "PA.NUS.FCRF";
const SOURCE = "World Bank World Development Indicators";
const versionFor = (lastUpdated: string) => `WDI ${INDICATOR} ${lastUpdated}`;

/**
 * Territories the World Bank does not publish a rate for, read from the
 * country whose currency they use (same currency code, so the same rate).
 */
const RATE_FROM: Record<string, string> = {
	COK: "NZL",
	NIU: "NZL",
	TKL: "NZL",
	PSE: "ISR",
	WLF: "NCL",
};

function parseArgs(argv: string[]) {
	let from: string | undefined;
	let dryRun = false;
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--dry-run") dryRun = true;
		else if (argv[i] === "--from") from = argv[++i];
		else throw new Error(`unknown argument ${argv[i]}`);
	}
	if (!from)
		throw new Error("usage: refresh-worldbank-fx.ts --from <dir> [--dry-run]");
	return { from, dryRun };
}

const csvCell = (v: string) =>
	/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;

async function main() {
	const { from, dryRun } = parseArgs(process.argv.slice(2));
	const releases = readdirSync(from)
		.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
		.filter((d) => existsSync(join(from, d, `${INDICATOR}.json`)))
		.sort();
	const lastUpdated = releases.at(-1);
	if (!lastUpdated) throw new Error(`no saved World Bank release in ${from}`);
	const dir = join(from, lastUpdated);
	const version = versionFor(lastUpdated);

	initDB();
	try {
		const loaded = await dr.execute(sql`
			SELECT 1 FROM ref."release" rl JOIN ref."source" s ON s."id" = rl."source_id"
			WHERE s."name" = ${SOURCE} AND rl."version" = ${version} LIMIT 1`);
		if (loaded.rows.length > 0) {
			console.log(`up to date: ${version} is already loaded`);
			return;
		}

		const raw = readFileSync(join(dir, `${INDICATOR}.json`));
		const body = JSON.parse(raw.toString("utf8")) as [
			{ lastupdated?: string },
			{ countryiso3code: string; date: string; value: number | null }[],
		];
		if (body[0]?.lastupdated !== lastUpdated)
			throw new Error(
				`${dir}: file says last updated ${body[0]?.lastupdated ?? "?"}, folder says ${lastUpdated}`,
			);
		const rates = new Map<string, Map<number, number>>();
		for (const r of body[1] ?? []) {
			if (r.value == null || !(r.value > 0) || !r.countryiso3code) continue;
			const m = rates.get(r.countryiso3code) ?? new Map<number, number>();
			m.set(Number(r.date), r.value);
			rates.set(r.countryiso3code, m);
		}

		const tenants = await dr.execute(sql`
			SELECT DISTINCT upper(c."iso3") AS iso3, s."currency_code" AS currency
			FROM "country_accounts" ca
			JOIN "countries" c ON c."id" = ca."country_id"
			JOIN "instance_system_settings" s ON s."country_accounts_id" = ca."id"
			WHERE c."iso3" IS NOT NULL AND s."currency_code" IS NOT NULL`);

		const lines = [CSV_COLUMNS.join(",")];
		const missing: string[] = [];
		for (const t of tenants.rows as { iso3: string; currency: string }[]) {
			const series = rates.get(RATE_FROM[t.iso3] ?? t.iso3);
			if (!series) {
				missing.push(t.iso3);
				continue;
			}
			for (const [y, value] of [...series].sort((a, b) => a[0] - b[0])) {
				const row: Record<string, string> = {
					indicator_code: "FX_LCU_PER_USD",
					family: "economic",
					quantity_type: "intensive",
					unit: "local currency units per US dollar",
					division_key: t.iso3,
					key_scheme: "iso3",
					boundary_vintage: "national",
					period_start: `${y}-01-01`,
					period_end: `${y}-12-31`,
					value: String(value),
					value_state: "reported",
					currency: t.currency,
					price_basis: "current",
					method: "as_published",
					grade: "REF-B",
					source: SOURCE,
					release: version,
					licence: "CC BY 4.0",
					redistribution_rule: "display_and_redistribute",
					source_status: "international_official",
					iso3: t.iso3,
				};
				lines.push(CSV_COLUMNS.map((c) => csvCell(row[c] ?? "")).join(","));
			}
		}
		const csv = `${lines.join("\n")}\n`;

		if (!dryRun) writeFileSync(join(dir, "fx_tenants.csv"), csv);

		const report = await loadReferenceCsv(csv, { dryRun });
		const { rejected, ...counts } = report;
		console.log(
			JSON.stringify({ version, noRate: missing, ...counts }, null, 2),
		);
		if (report.fileErrors.length > 0) {
			for (const e of report.fileErrors) console.error(`file error: ${e}`);
			process.exitCode = 1;
		} else if (rejected.length > 0) {
			console.error(`rejected ${rejected.length} row(s)`);
			for (const r of rejected.slice(0, 20))
				console.error(`  row ${r.row} (${r.iso3}): ${r.errors.join("; ")}`);
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
