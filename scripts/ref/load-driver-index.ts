// Loads climate driver series into ref.driver_index (geoportal gap review,
// CLM-01; Alex approved the downloads 2026-10-19):
// - RONI: NOAA CPC Relative Oceanic Nino Index, which CPC uses for official
//   ENSO monitoring and prediction; three-month running seasons.
// - ONI: NOAA CPC Oceanic Nino Index, kept for comparison; three-month seasons.
// - DMI: NOAA PSL Dipole Mode Index (Indian Ocean Dipole), HadISST, monthly.
//
// A season "DJF 1950" runs from 1949-12-01 to 1950-02-28; "NDJ 1950" from
// 1950-11-01 to 1951-01-31. A missing value (-9999) is left out, never 0.
// Rows are upserted on the natural key, so a second run changes nothing.
//
// Usage (inside a container with node_modules, DATABASE_URL set):
//   npx tsx scripts/ref/load-driver-index.ts <dir> [--dry-run]
// <dir> holds RONI.ascii.txt, oni.ascii.txt and dmi.had.long.csv.

import { createHash } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";
import { sql } from "drizzle-orm";
import { dr, endDB, initDB } from "~/db.server";

interface Row {
	index: string;
	window: string;
	start: string;
	end: string;
	value: number;
}

const SEASONS = [
	"DJF",
	"JFM",
	"FMA",
	"MAM",
	"AMJ",
	"MJJ",
	"JJA",
	"JAS",
	"ASO",
	"SON",
	"OND",
	"NDJ",
];

const iso = (y: number, m: number, d: number) =>
	`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const lastDay = (y: number, m: number) =>
	new Date(Date.UTC(y, m, 0)).getUTCDate();

/** First and last day of a three-month season; DJF starts in the previous December. */
export function seasonPeriod(season: string, year: number): [string, string] {
	const i = SEASONS.indexOf(season);
	if (i < 0) throw new Error(`unknown season ${season}`);
	const first = i === 0 ? { y: year - 1, m: 12 } : { y: year, m: i };
	const lastM = ((first.m + 1) % 12) + 1;
	const lastY = lastM < first.m ? first.y + 1 : first.y;
	return [iso(first.y, first.m, 1), iso(lastY, lastM, lastDay(lastY, lastM))];
}

function parseSeasonal(text: string, index: string): Row[] {
	const out: Row[] = [];
	for (const line of text.split("\n")) {
		const p = line.trim().split(/\s+/);
		if (p.length < 3 || !SEASONS.includes(p[0])) continue;
		const value = Number(p[p.length - 1]);
		if (!Number.isFinite(value) || value <= -99) continue;
		const [start, end] = seasonPeriod(p[0], Number(p[1]));
		out.push({ index, window: "3-month running", start, end, value });
	}
	return out;
}

function parseDmi(text: string): Row[] {
	const out: Row[] = [];
	for (const line of text.split("\n")) {
		const m = line.match(/^(\d{4})-(\d{2})-01,\s*(-?[\d.]+)/);
		if (!m) continue;
		const value = Number(m[3]);
		if (value <= -9999) continue;
		const y = Number(m[1]);
		const mo = Number(m[2]);
		out.push({
			index: "DMI",
			window: "monthly",
			start: iso(y, mo, 1),
			end: iso(y, mo, lastDay(y, mo)),
			value,
		});
	}
	return out;
}

const SOURCES = {
	cpc: {
		name: "NOAA Climate Prediction Center ENSO indices",
		provider: "NOAA CPC",
		url: "https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/ensostuff/ONI_v5.php",
		licence:
			"Public domain (NWS web pages, unless noted otherwise; weather.gov/disclaimer)",
		rule: "display_and_redistribute",
	},
	psl: {
		name: "NOAA Physical Sciences Laboratory Dipole Mode Index",
		provider: "NOAA PSL",
		url: "https://psl.noaa.gov/data/timeseries/month/",
		licence: "Not stated by the provider; NOAA data, licence not confirmed",
		rule: "display_only",
	},
} as const;

async function main() {
	const dir = process.argv[2];
	const dryRun = process.argv.includes("--dry-run");
	if (!dir) throw new Error("usage: load-driver-index.ts <dir> [--dry-run]");
	const files = [
		{
			file: "RONI.ascii.txt",
			src: SOURCES.cpc,
			parse: (t: string) => parseSeasonal(t, "RONI"),
		},
		{
			file: "oni.ascii.txt",
			src: SOURCES.cpc,
			parse: (t: string) => parseSeasonal(t, "ONI"),
		},
		{ file: "dmi.had.long.csv", src: SOURCES.psl, parse: parseDmi },
	];
	initDB();
	try {
		await dr.transaction(async (tx) => {
			for (const f of files) {
				const raw = readFileSync(join(dir, f.file));
				const checksum = createHash("sha256").update(raw).digest("hex");
				const rows = f.parse(raw.toString("utf8"));
				const src = await tx.execute(sql`
					INSERT INTO ref."source" ("name", "provider", "documentation_url", "licence", "redistribution_rule", "source_status")
					VALUES (${f.src.name}, ${f.src.provider}, ${f.src.url}, ${f.src.licence}, ${f.src.rule}, 'international_official')
					ON CONFLICT ("name") DO UPDATE SET "licence" = EXCLUDED."licence"
					RETURNING "id"`);
				const sourceId = (src.rows[0] as { id: string }).id;
				const version = `${f.file} sha256:${checksum.slice(0, 12)}`;
				const rel = await tx.execute(sql`
					INSERT INTO ref."release" ("source_id", "source_status", "version", "checksum", "reference_period_start", "reference_period_end")
					VALUES (${sourceId}, 'international_official', ${version}, ${checksum}, ${rows[0]?.start ?? null}, ${rows.at(-1)?.end ?? null})
					ON CONFLICT ("source_id", "version") DO UPDATE SET "checksum" = EXCLUDED."checksum"
					RETURNING "id"`);
				const releaseId = (rel.rows[0] as { id: string }).id;
				let n = 0;
				for (const r of rows) {
					await tx.execute(sql`
						INSERT INTO ref."driver_index" ("index_name", "averaging_window", "period_start", "period_end", "value", "value_state", "provider", "release_id")
						VALUES (${r.index}, ${r.window}, ${r.start}, ${r.end}, ${r.value}, 'reported', ${f.src.provider}, ${releaseId})
						ON CONFLICT ("index_name", "averaging_window", "provider", "period_start")
						DO UPDATE SET "value" = EXCLUDED."value", "period_end" = EXCLUDED."period_end", "release_id" = EXCLUDED."release_id"`);
					n++;
				}
				console.log(
					`${f.file}: ${n} rows, ${rows[0]?.start} to ${rows.at(-1)?.end}, release ${version}`,
				);
			}
			if (dryRun) throw new DryRun();
		});
	} catch (e) {
		if (!(e instanceof DryRun)) throw e;
		console.log("dry run: rolled back");
	} finally {
		await endDB();
	}
}

class DryRun extends Error {}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
