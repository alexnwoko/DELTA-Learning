import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { dr } from "~/db.server";
import {
	CSV_COLUMNS,
	loadReferenceCsv,
} from "~/backend.server/models/ref/referenceLoader";
import {
	cleanupRefSources,
	cleanupRefTenants,
	createDivision,
	createRefTenant,
	runTag,
	type RefTenant,
} from "./refFixtures";

// E1: the CSV loader validates every row, resolves tenant and division,
// upserts idempotently, and keeps nothing on --dry-run.

const tag = runTag();
let t: RefTenant;
let other: RefTenant;
let divByNational: string;
let divByImport: string;

function csv(rows: Record<string, string>[]): string {
	const header = CSV_COLUMNS.join(",");
	const lines = rows.map((r) =>
		CSV_COLUMNS.map((c) => {
			const v = r[c] ?? "";
			return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
		}).join(","),
	);
	return [header, ...lines].join("\n") + "\n";
}

function row(over: Record<string, string>): Record<string, string> {
	return {
		indicator_code: "POP_TOTAL",
		family: "population",
		quantity_type: "extensive",
		unit: "persons",
		division_key: t.iso3,
		key_scheme: "iso3",
		boundary_vintage: "national",
		period_start: "2024-01-01",
		period_end: "2024-12-31",
		value: "1000000",
		value_state: "reported",
		lower_bound: "",
		upper_bound: "",
		method: "as_published",
		grade: "REF-B",
		source: `WPP ${tag}`,
		release: "2024",
		licence: "CC BY 3.0 IGO",
		redistribution_rule: "display_and_redistribute",
		source_status: "international_official",
		rdls_id: "",
		iso3: t.iso3,
		...over,
	};
}

async function tenantValues(id: string) {
	const res = await dr.execute(sql`
		SELECT division_id, value, value_state, grade, boundary_vintage
		FROM ref.value WHERE country_accounts_id = ${id}
		ORDER BY division_id NULLS FIRST, period_start
	`);
	return res.rows as Record<string, unknown>[];
}

describe("reference CSV loader", () => {
	let file: string;

	beforeAll(async () => {
		t = await createRefTenant();
		other = await createRefTenant();
		divByNational = await createDivision(t.countryAccountsId, {
			nationalId: `N-${tag}`,
		});
		divByImport = await createDivision(t.countryAccountsId, {
			importId: `I-${tag}`,
		});
		// A division with the same key in another tenant must not be used.
		await createDivision(other.countryAccountsId, { nationalId: `N-${tag}` });
		file = csv([
			row({}),
			row({
				division_key: `N-${tag}`,
				key_scheme: "national_id",
				boundary_vintage: "V1",
				method: "zonal_sum",
				grade: "REF-C",
				source: `Grid ${tag}`,
				release: "R1",
				licence: "CC BY 4.0",
				source_status: "modelled",
				value: "250000",
			}),
			row({
				division_key: `I-${tag}`,
				key_scheme: "pcode",
				boundary_vintage: "V1",
				method: "zonal_sum",
				grade: "REF-C",
				source: `Grid ${tag}`,
				release: "R1",
				licence: "CC BY 4.0",
				source_status: "modelled",
				value: "",
				value_state: "not_reported",
			}),
			// Invalid: not_reported with a value.
			row({
				period_start: "2023-01-01",
				period_end: "2023-12-31",
				value: "5",
				value_state: "not_reported",
			}),
			// Invalid: modelled REF-A.
			row({
				period_start: "2022-01-01",
				period_end: "2022-12-31",
				source_status: "modelled",
				grade: "REF-A",
			}),
			// Unresolvable division.
			row({
				division_key: `NOPE-${tag}`,
				key_scheme: "national_id",
				boundary_vintage: "V1",
			}),
		]);
	});

	afterAll(async () => {
		await cleanupRefTenants([t, other]);
		await cleanupRefSources(tag);
	});

	it("dry run reports exact counts and writes nothing", async () => {
		const report = await loadReferenceCsv(file, { dryRun: true });
		expect(report).toMatchObject({
			dryRun: true,
			rowsRead: 6,
			rowsValid: 3,
			rowsRejected: 3,
			inserted: 3,
			updated: 0,
			unchanged: 0,
			sourcesCreated: 2,
			releasesCreated: 2,
		});
		expect(await tenantValues(t.countryAccountsId)).toEqual([]);
		const src = await dr.execute(
			sql`SELECT 1 FROM ref.source WHERE name LIKE ${`%${tag}%`}`,
		);
		expect(src.rows).toHaveLength(0);
	});

	it("loads valid rows, rejects invalid ones with reasons, and resolves divisions in the tenant", async () => {
		const report = await loadReferenceCsv(file);
		expect(report.inserted).toBe(3);
		expect(report.rejected.map((r) => r.row)).toEqual([4, 5, 6]);
		expect(report.rejected[0].errors[0]).toContain("null is not zero");
		expect(report.rejected[1].errors).toContain(
			"grade: modelled values take REF-C or REF-D only",
		);
		expect(report.rejected[2].errors[0]).toContain(
			"no division with that national_id or import_id",
		);
		const values = await tenantValues(t.countryAccountsId);
		expect(values).toHaveLength(3);
		const byDiv = Object.fromEntries(
			values.map((v) => [String(v.division_id), v]),
		);
		expect(byDiv["null"]).toMatchObject({ value: 1000000, grade: "REF-B" });
		expect(byDiv[divByNational]).toMatchObject({
			value: 250000,
			boundary_vintage: "V1",
		});
		expect(byDiv[divByImport]).toMatchObject({
			value: null,
			value_state: "not_reported",
		});
		expect(await tenantValues(other.countryAccountsId)).toEqual([]);
	});

	it("is idempotent: a second load changes nothing", async () => {
		const before = await dr.execute(sql`
			SELECT id, created_at FROM ref.value WHERE country_accounts_id = ${t.countryAccountsId} ORDER BY id
		`);
		const report = await loadReferenceCsv(file);
		expect(report).toMatchObject({
			inserted: 0,
			updated: 0,
			unchanged: 3,
			sourcesCreated: 0,
			releasesCreated: 0,
			rowsRejected: 3,
		});
		const after = await dr.execute(sql`
			SELECT id, created_at FROM ref.value WHERE country_accounts_id = ${t.countryAccountsId} ORDER BY id
		`);
		expect(after.rows).toEqual(before.rows);
	});

	it("updates a changed value in place on the natural key", async () => {
		const report = await loadReferenceCsv(csv([row({ value: "1000500" })]));
		expect(report).toMatchObject({ inserted: 0, updated: 1, unchanged: 0 });
		const values = await tenantValues(t.countryAccountsId);
		expect(values).toHaveLength(3);
		expect(values[0]).toMatchObject({ division_id: null, value: 1000500 });
	});

	it("rejects a row whose source facts contradict the stored source", async () => {
		const report = await loadReferenceCsv(
			csv([
				row({
					period_start: "2021-01-01",
					period_end: "2021-12-31",
					licence: "CC BY-NC 4.0",
				}),
			]),
		);
		expect(report.rowsRejected).toBe(1);
		expect(report.rejected[0].errors[0]).toContain("licence");
	});

	it("v0.2: refuses an unknown boundary vintage, a global key and a wrong iso3 key", async () => {
		const report = await loadReferenceCsv(
			csv([
				row({
					period_start: "2020-01-01",
					period_end: "2020-12-31",
					boundary_vintage: "unknown",
				}),
				row({
					period_start: "2020-01-01",
					period_end: "2020-12-31",
					key_scheme: "global",
				}),
				row({
					period_start: "2020-01-01",
					period_end: "2020-12-31",
					division_key: "ZZZ",
				}),
			]),
		);
		expect(report.rowsValid).toBe(0);
		expect(report.rejected.map((r) => r.errors[0])).toEqual([
			"boundary_vintage: unknown vintage; the value is refused, not graded",
			"key_scheme global: not allowed for a tenant value in ref.value",
			`division_key ZZZ: key_scheme iso3 needs the country's iso3 (${t.iso3})`,
		]);
	});

	it("rejects a row whose iso3 does not match the --tenant country", async () => {
		const report = await loadReferenceCsv(csv([row({})]), {
			countryAccountsId: other.countryAccountsId,
		});
		expect(report.rowsRejected).toBe(1);
		expect(report.rejected[0].errors[0]).toContain("does not match the tenant");
	});

	it("reports a malformed CSV as a file error", async () => {
		const report = await loadReferenceCsv(
			file.replace("iso3\n", "iso3,extra\n"),
		);
		expect(report.fileErrors[0]).toContain("CSV parse error");
	});

	it("stops on an unknown column before any write", async () => {
		const bad = file
			.trimEnd()
			.split("\n")
			.map((l) => `${l},x`)
			.join("\n")
			.replace(/^(.*),x/, "$1,extra");
		const report = await loadReferenceCsv(bad);
		expect(report.fileErrors).toEqual(["unknown column(s): extra"]);
		expect(report.rowsRead).toBe(6);
		expect(report.inserted + report.updated + report.unchanged).toBe(0);
	});
});
