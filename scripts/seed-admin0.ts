// Loads the world admin-0 reference layer into geo.admin0 (Alex, 2026-10-18,
// rulings 1 and 2). Input: a GeoJSON FeatureCollection of countries, such as
// Natural Earth 1:50m admin-0 countries (public domain), kept outside the
// repository. The whole table is replaced in one transaction.
//
// Usage: yarn tsx scripts/seed-admin0.ts <file.geojson> [source] [version]
//   default source "Natural Earth 1:50m admin-0 countries"
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { dr, endDB, initDB } from "../app/db.server";
import { loadEnvFile } from "../app/utils/env";

interface Feature {
	properties: Record<string, unknown> | null;
	geometry: { type: string; coordinates: unknown } | null;
}

/** ISO 3166-1 alpha-3 for a feature; Natural Earth marks some with -99. */
export function admin0Key(p: Record<string, unknown>): string | null {
	for (const k of ["ISO_A3_EH", "ISO_A3", "ADM0_A3", "iso3"]) {
		const v = p[k];
		if (typeof v === "string" && /^[A-Z]{3}$/.test(v)) return v;
	}
	return null;
}

export function admin0Name(p: Record<string, unknown>): string {
	for (const k of ["NAME_EN", "NAME", "ADMIN", "name"]) {
		const v = p[k];
		if (typeof v === "string" && v.trim()) return v.trim();
	}
	return "";
}

async function main() {
	const [
		file,
		source = "Natural Earth 1:50m admin-0 countries",
		version = "unknown",
	] = process.argv.slice(2);
	if (!file) {
		console.error("Usage: seed-admin0.ts <file.geojson> [source] [version]");
		process.exit(2);
	}
	const fc = JSON.parse(readFileSync(file, "utf8")) as { features?: Feature[] };
	const features = (fc.features ?? []).filter(
		(f) =>
			f.geometry &&
			(f.geometry.type === "Polygon" || f.geometry.type === "MultiPolygon"),
	);
	const seen = new Set<string>();
	const rows: { iso3: string; name: string; geom: string }[] = [];
	const skipped: string[] = [];
	for (const f of features) {
		const p = f.properties ?? {};
		const iso3 = admin0Key(p);
		if (!iso3 || seen.has(iso3)) {
			skipped.push(admin0Name(p) || "(no name)");
			continue;
		}
		seen.add(iso3);
		rows.push({ iso3, name: admin0Name(p), geom: JSON.stringify(f.geometry) });
	}

	// An explicit DATABASE_URL wins over .env (as in geo-refresh).
	const explicitUrl = process.env.DATABASE_URL;
	loadEnvFile("");
	if (explicitUrl) process.env.DATABASE_URL = explicitUrl;
	initDB();
	await dr.transaction(async (tx) => {
		await tx.execute(sql`DELETE FROM geo.admin0`);
		for (const r of rows) {
			await tx.execute(sql`
				WITH g AS (
					SELECT ST_Multi(ST_CollectionExtract(ST_MakeValid(
						ST_SetSRID(ST_GeomFromGeoJSON(${r.geom}), 4326)), 3)) AS geom
				)
				INSERT INTO geo.admin0 (iso3, name, geom, label_point, source, source_version)
				SELECT ${r.iso3}, ${r.name}, g.geom, ST_PointOnSurface(g.geom), ${source}, ${version}
				FROM g
			`);
		}
	});
	console.log(
		`geo.admin0: ${rows.length} countries loaded from ${source} (${version}); ${skipped.length} skipped without an ISO code: ${skipped.join(", ")}`,
	);
	await endDB();
}

if (process.argv[1]?.endsWith("seed-admin0.ts")) {
	main().catch((err) => {
		console.error(err);
		process.exit(1);
	});
}
