// Geoportal interaction benchmark against NFR-113 (I-6). Read-only: it runs
// the geo read side (choropleth, boundaries, dossier, hazard tree) for the
// given tenants, one query at a time, and prints medians, p95 and the
// gzipped size of the level payloads. It never writes.
//
// Usage: DATABASE_URL=... yarn tsx scripts/geo-bench.ts <tenantId> [<tenantId> ...]
// Budgets (NFR-113): filter repaint <= 300 ms p95; level switch <= 900 ms;
// level-1 payload <= 500 KB gzipped.
import { gzipSync } from "zlib";
import { endDB, initDB } from "../app/db.server";
import {
	getBoundaries,
	getChoropleth,
	getHazardTree,
	getPlaceDossier,
	type GeoRequest,
} from "../app/backend.server/models/geo/queries";
import { loadEnvFile } from "../app/utils/env";
import { parseDeltaQuery } from "../app/utils/deltaQuery";

const RUNS = 7;

function req(params: Record<string, string>): GeoRequest {
	const { query } = parseDeltaQuery(new URLSearchParams(params));
	return {
		query,
		level: params.level ? Number(params.level) : undefined,
		// Every record in the shared database is a draft today.
		audience: "reviewer-provisional",
		notApplied: [],
	};
}

async function time<T>(fn: () => Promise<T>): Promise<{ ms: number[]; last: T }> {
	const ms: number[] = [];
	let last: T | undefined;
	for (let i = 0; i < RUNS; i++) {
		const t0 = performance.now();
		last = await fn();
		ms.push(performance.now() - t0);
	}
	return { ms, last: last as T };
}

function stats(ms: number[]) {
	const s = [...ms].sort((a, b) => a - b);
	const pick = (q: number) => s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)];
	return { median: Math.round(pick(0.5)), p95: Math.round(pick(0.95)) };
}

function kb(obj: unknown) {
	const raw = Buffer.from(JSON.stringify(obj));
	return {
		rawKB: Math.round(raw.length / 1024),
		gzipKB: Math.round(gzipSync(raw).length / 1024),
	};
}

async function bench(t: string) {
	const out: Record<string, unknown> = { tenant: t };
	for (const level of [1, 2]) {
		const b = await time(() => getBoundaries(t, { level, z: 8, lang: "en" }));
		const c = await time(() =>
			getChoropleth(t, req({ measure: "deaths", basis: "provisional", level: String(level) })),
		);
		const f = await time(() =>
			getChoropleth(
				t,
				req({ measure: "deaths", basis: "provisional", level: String(level), from: "2010", to: "2020" }),
			),
		);
		out[`level${level}`] = {
			boundaries: { ...stats(b.ms), ...kb(b.last) },
			choropleth: { ...stats(c.ms), ...kb(c.last), cells: c.last.cells.length },
			filtered: stats(f.ms),
			// What a level switch costs on the server: boundaries plus choropleth.
			levelSwitchMedianMs: stats(b.ms).median + stats(c.ms).median,
		};
		if (level === 1) {
			const top = [...c.last.cells].sort((a, b) => (b.value ?? -1) - (a.value ?? -1))[0];
			if (top) {
				const d = await time(() =>
					getPlaceDossier(t, top.division_id, req({ measure: "deaths", basis: "provisional", level: "1" }), "en"),
				);
				out.dossier = stats(d.ms);
			}
			const h = await time(() =>
				getHazardTree(t, req({ measure: "deaths", basis: "provisional" }), "en"),
			);
			out.hazardTree = stats(h.ms);
		}
	}
	return out;
}

async function main() {
	// An explicit DATABASE_URL wins over .env (as in geo-refresh).
	const explicitUrl = process.env.DATABASE_URL;
	loadEnvFile("");
	if (explicitUrl) process.env.DATABASE_URL = explicitUrl;
	initDB();
	for (const t of process.argv.slice(2)) {
		console.log(JSON.stringify(await bench(t)));
	}
	await endDB();
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
