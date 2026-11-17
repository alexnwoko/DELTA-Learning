// Rebuilds the geoportal read model (geo schema) for one tenant or all.
// Usage: yarn geo:refresh [countryAccountsId]
import { sql } from "drizzle-orm";
import { dr, endDB, initDB } from "../app/db.server";
import { refreshGeoReadModel } from "../app/backend.server/models/geo/refresh";
import { loadEnvFile } from "../app/utils/env";

async function main() {
	// An explicit DATABASE_URL (for example inside a container, where .env
	// points at 127.0.0.1) wins over the .env file, which loadEnvFile would
	// otherwise apply on top of it (Analytics, 2026-10-17).
	const explicitUrl = process.env.DATABASE_URL;
	loadEnvFile("");
	if (explicitUrl) process.env.DATABASE_URL = explicitUrl;
	initDB();
	const only = process.argv[2];
	const tenants = only
		? [only]
		: (
				await dr.execute(
					sql`SELECT id FROM public.country_accounts ORDER BY id`,
				)
			).rows.map((r) => String((r as { id: string }).id));
	for (const t of tenants) {
		const started = Date.now();
		const r = await refreshGeoReadModel(t);
		console.log(
			`${t}: ${r.divisionCount} divisions, ${r.atomCount} atoms, ${Date.now() - started} ms`,
		);
	}
	await endDB();
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
