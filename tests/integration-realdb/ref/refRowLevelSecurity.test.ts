import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { dr } from "~/db.server";
import { sql } from "drizzle-orm";
import {
	cleanupRefSources,
	cleanupRefTenants,
	createRefTenant,
	createSourceRelease,
	insertValue,
	runTag,
	type RefTenant,
} from "./refFixtures";

// BM-5 (D-BM-06; ADR-03, SEC-06): ref.value carries a tenant policy, enabled
// and not forced. The app role owns the table and bypasses it until the
// Tenant Isolation lane splits the roles, so each test acts as a temporary
// non-owner role inside a transaction that is always rolled back. The tenant
// is a transaction-scoped setting (set_config(..., true)), never a session
// SET, because a pooled connection would carry it into the next request.

const tag = runTag();
const role = `ref_rls_probe_${tag}`;
let a: RefTenant;
let b: RefTenant;

class Rollback extends Error {}

/** Runs fn as the non-owner probe role with app.tenant set, then rolls back. */
async function asTenant<T>(
	tenant: string | null,
	fn: (tx: Parameters<Parameters<typeof dr.transaction>[0]>[0]) => Promise<T>,
): Promise<T> {
	let out: T | undefined;
	try {
		await dr.transaction(async (tx) => {
			await tx.execute(sql.raw(`CREATE ROLE "${role}" NOLOGIN`));
			await tx.execute(sql.raw(`GRANT USAGE ON SCHEMA ref TO "${role}"`));
			await tx.execute(
				sql.raw(`GRANT SELECT, INSERT ON ref.value TO "${role}"`),
			);
			// The licence guard trigger reads the source and release as the
			// calling role, so any role that writes values needs these reads.
			await tx.execute(
				sql.raw(`GRANT SELECT ON ref.release, ref.source TO "${role}"`),
			);
			await tx.execute(sql.raw(`SET LOCAL ROLE "${role}"`));
			if (tenant !== null) {
				await tx.execute(sql`SELECT set_config('app.tenant', ${tenant}, true)`);
			}
			out = await fn(tx);
			throw new Rollback();
		});
	} catch (e) {
		if (!(e instanceof Rollback)) throw e;
	}
	return out as T;
}

async function countBy(
	tx: Parameters<Parameters<typeof dr.transaction>[0]>[0],
): Promise<Record<string, number>> {
	const res = await tx.execute(sql`
		SELECT country_accounts_id AS t, count(*)::int AS n FROM ref.value
		WHERE country_accounts_id IN (${a.countryAccountsId}, ${b.countryAccountsId})
		GROUP BY country_accounts_id
	`);
	return Object.fromEntries(
		(res.rows as { t: string; n: number }[]).map((r) => [r.t, r.n]),
	);
}

describe("ref.value row-level security", () => {
	beforeAll(async () => {
		a = await createRefTenant();
		b = await createRefTenant();
		const wpp = await createSourceRelease({
			name: `WPP ${tag}`,
			sourceStatus: "international_official",
		});
		for (const t of [a, b]) {
			await insertValue({
				countryAccountsId: t.countryAccountsId,
				releaseId: wpp.releaseId,
				sourceStatus: "international_official",
				value: 1000,
			});
		}
	});

	afterAll(async () => {
		await cleanupRefTenants([a, b]);
		await cleanupRefSources(tag);
	});

	it("is enabled and not forced, with the tenant policy", async () => {
		const res = await dr.execute(sql`
			SELECT c.relrowsecurity, c.relforcerowsecurity, p.polname
			FROM pg_class c
			JOIN pg_namespace n ON n.oid = c.relnamespace
			LEFT JOIN pg_policy p ON p.polrelid = c.oid
			WHERE n.nspname = 'ref' AND c.relname = 'value'
		`);
		expect(res.rows).toEqual([
			{
				relrowsecurity: true,
				relforcerowsecurity: false,
				polname: "ref_value_tenant_isolation",
			},
		]);
	});

	it("shows a non-owner role only its own tenant's rows", async () => {
		const seen = await asTenant(a.countryAccountsId, countBy);
		expect(seen).toEqual({ [a.countryAccountsId]: 1 });
	});

	it("shows nothing when no tenant is set (fail closed)", async () => {
		expect(await asTenant(null, countBy)).toEqual({});
	});

	it("refuses a write for another tenant", async () => {
		const msg = await asTenant(a.countryAccountsId, async (tx) => {
			try {
				await tx.execute(sql`SAVEPOINT probe`);
				await tx.execute(sql`
					INSERT INTO ref.value (
						country_accounts_id, key_scheme, boundary_vintage, indicator_code,
						quantity_type, release_id, source_status, period_start, period_end,
						value, value_state, method, grade
					)
					SELECT ${b.countryAccountsId}, 'iso3', 'national', 'POP_TOTAL',
						'extensive', release_id, 'international_official', '2020-01-01',
						'2020-12-31', 1, 'reported', 'as_published', 'REF-B'
					FROM ref.value WHERE country_accounts_id = ${a.countryAccountsId}
					LIMIT 1
				`);
				return "inserted";
			} catch (e: any) {
				await tx.execute(sql`ROLLBACK TO SAVEPOINT probe`);
				return String(e?.cause?.message ?? e?.message ?? e);
			}
		});
		expect(msg).toContain("row-level security");
	});

	it("does not change what the owning app role sees", async () => {
		const res = await dr.execute(sql`
			SELECT count(*)::int AS n FROM ref.value
			WHERE country_accounts_id IN (${a.countryAccountsId}, ${b.countryAccountsId})
		`);
		expect(res.rows[0]).toEqual({ n: 2 });
	});
});
