import { sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { dr } from "~/db.server";

// Fixtures for the E1 reference-store tests: a tenant whose country has a
// free iso3 code, divisions, and sources and releases named with a run tag
// so cleanup removes only what the test created.

export interface RefTenant {
	countryId: string;
	countryAccountsId: string;
	iso3: string;
}

export const runTag = () => randomUUID().slice(0, 8);

async function freeIso3(): Promise<string> {
	const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
	for (let i = 0; i < 50; i++) {
		const code =
			"X" +
			letters[Math.floor(Math.random() * 26)] +
			letters[Math.floor(Math.random() * 26)];
		const res = await dr.execute(
			sql`SELECT 1 FROM countries WHERE iso3 = ${code}`,
		);
		if (res.rows.length === 0) return code;
	}
	throw new Error("no free iso3 code for the test country");
}

export async function createRefTenant(withIso3 = true): Promise<RefTenant> {
	const countryId = randomUUID();
	const countryAccountsId = randomUUID();
	const iso3 = withIso3 ? await freeIso3() : "";
	await dr.execute(sql`
		INSERT INTO countries (id, name, iso3)
		VALUES (${countryId}, ${`Ref Test ${countryId.slice(0, 8)}`}, ${iso3 || null})
	`);
	await dr.execute(sql`
		INSERT INTO country_accounts (id, short_description, country_id, status, type)
		VALUES (${countryAccountsId}, 'Ref Test', ${countryId}, 1, 'Training')
	`);
	return { countryId, countryAccountsId, iso3 };
}

export async function createDivision(
	countryAccountsId: string,
	keys: { nationalId?: string; importId?: string },
): Promise<string> {
	const id = randomUUID();
	await dr.execute(sql`
		INSERT INTO division (id, country_accounts_id, national_id, import_id, name, level)
		VALUES (${id}, ${countryAccountsId}, ${keys.nationalId ?? null}, ${keys.importId ?? null}, '{"en":"Test division"}'::jsonb, 1)
	`);
	return id;
}

export async function createSourceRelease(opts: {
	name: string;
	sourceStatus: "official_national" | "international_official" | "modelled";
	version?: string;
	releaseDate?: string | null;
	licence?: string;
}): Promise<{ sourceId: string; releaseId: string }> {
	const src = await dr.execute(sql`
		INSERT INTO ref.source (name, licence, redistribution_rule, source_status)
		VALUES (${opts.name}, ${opts.licence ?? "CC BY 4.0"}, 'display_and_redistribute', ${opts.sourceStatus})
		RETURNING id
	`);
	const sourceId = (src.rows[0] as { id: string }).id;
	const rel = await dr.execute(sql`
		INSERT INTO ref.release (source_id, source_status, version, release_date)
		VALUES (${sourceId}, ${opts.sourceStatus}, ${opts.version ?? "v1"}, ${opts.releaseDate ?? null}::date)
		RETURNING id
	`);
	return { sourceId, releaseId: (rel.rows[0] as { id: string }).id };
}

export async function insertValue(v: {
	countryAccountsId: string;
	releaseId: string;
	sourceStatus: string;
	value: number | null;
	valueState?: string;
	grade?: string;
	divisionId?: string | null;
	boundaryVintage?: string;
	periodStart?: string;
	periodEnd?: string;
	indicatorCode?: string;
	quantityType?: string;
	method?: string;
	keyScheme?: string;
	lowerBound?: number | null;
	upperBound?: number | null;
}): Promise<string> {
	const keyScheme = v.keyScheme ?? (v.divisionId ? "national_id" : "iso3");
	const res = await dr.execute(sql`
		INSERT INTO ref.value (
			country_accounts_id, division_id, key_scheme, boundary_vintage, indicator_code,
			quantity_type, release_id, source_status, period_start, period_end, value,
			value_state, lower_bound, upper_bound, method, grade
		) VALUES (
			${v.countryAccountsId}, ${v.divisionId ?? null}::uuid, ${keyScheme},
			${v.boundaryVintage ?? "national"}, ${v.indicatorCode ?? "POP_TOTAL"},
			${v.quantityType ?? "extensive"}, ${v.releaseId}, ${v.sourceStatus},
			${v.periodStart ?? "2024-01-01"}::date, ${v.periodEnd ?? "2024-12-31"}::date,
			${v.value}::double precision, ${v.valueState ?? "reported"},
			${v.lowerBound ?? null}::double precision, ${v.upperBound ?? null}::double precision,
			${v.method ?? "as_published"},
			${v.grade ?? "REF-B"}
		) RETURNING id
	`);
	return (res.rows[0] as { id: string }).id;
}

/** Removes the tenants' values, records and divisions, then the tenants. */
export async function cleanupRefTenants(tenants: RefTenant[]) {
	for (const t of tenants) {
		await dr.execute(
			sql`DELETE FROM ref.value WHERE country_accounts_id = ${t.countryAccountsId}`,
		);
		await dr.execute(sql`
			DELETE FROM human_category_presence WHERE record_id IN (
				SELECT id FROM disaster_records WHERE country_accounts_id = ${t.countryAccountsId}
			)
		`);
		await dr.execute(
			sql`DELETE FROM disaster_records WHERE country_accounts_id = ${t.countryAccountsId}`,
		);
		await dr.execute(
			sql`DELETE FROM division WHERE country_accounts_id = ${t.countryAccountsId}`,
		);
		await dr.execute(
			sql`DELETE FROM country_accounts WHERE id = ${t.countryAccountsId}`,
		);
		await dr.execute(sql`DELETE FROM countries WHERE id = ${t.countryId}`);
	}
}

/** Removes sources (and their releases) whose name contains the tag. */
export async function cleanupRefSources(tag: string) {
	await dr.execute(sql`
		DELETE FROM ref.release WHERE source_id IN (
			SELECT id FROM ref.source WHERE name LIKE ${`%${tag}%`}
		)
	`);
	await dr.execute(sql`DELETE FROM ref.source WHERE name LIKE ${`%${tag}%`}`);
}
