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

// BM-3 (D-BM-05): reference value contract v0.3 and the seven SEC-19
// redistribution rules, enforced in the database whatever path writes the
// row (TR-151, TR-153, TR-162; PD-04 cross-field rules 3 to 6).

const tag = runTag();
let tenant: RefTenant;
let wpp: { sourceId: string; releaseId: string };
let grid: { sourceId: string; releaseId: string };

async function pgError(p: Promise<unknown>): Promise<string> {
	try {
		await p;
	} catch (e: any) {
		const cause = e?.cause ?? e;
		return `${cause?.constraint ?? ""} ${cause?.message ?? e?.message ?? e}`;
	}
	throw new Error("expected the database to reject the row");
}

let sources = 0;
async function sourceWithRule(rule: string) {
	sources += 1;
	const src = await dr.execute(sql`
		INSERT INTO ref.source (name, licence, redistribution_rule, source_status)
		VALUES (${`${rule} ${sources} ${tag}`}, 'CC BY 4.0', ${rule}, 'modelled')
		RETURNING id
	`);
	const sourceId = (src.rows[0] as { id: string }).id;
	const rel = await dr.execute(sql`
		INSERT INTO ref.release (source_id, source_status, version)
		VALUES (${sourceId}, 'modelled', 'v1')
		RETURNING id
	`);
	return (rel.rows[0] as { id: string }).id;
}

function valueOn(releaseId: string, rule: string | null) {
	return dr.execute(sql`
		INSERT INTO ref.value (
			country_accounts_id, key_scheme, boundary_vintage, indicator_code,
			quantity_type, release_id, source_status, period_start, period_end,
			value, value_state, method, grade, redistribution_rule
		) VALUES (
			${tenant.countryAccountsId}, 'iso3', 'national', 'POP_TOTAL',
			'extensive', ${releaseId}, 'modelled', '2024-01-01', '2024-12-31',
			100, 'reported', 'as_published', 'REF-D', ${rule}
		) RETURNING id
	`);
}

describe("ref contract v0.3", () => {
	beforeAll(async () => {
		tenant = await createRefTenant();
		wpp = await createSourceRelease({
			name: `WPP ${tag}`,
			sourceStatus: "international_official",
		});
		grid = await createSourceRelease({
			name: `Grid ${tag}`,
			sourceStatus: "modelled",
		});
	});

	afterAll(async () => {
		await cleanupRefTenants([tenant]);
		await cleanupRefSources(tag);
	});

	it("adds the v0.3 columns with safe defaults", async () => {
		const res = await dr.execute(sql`
			SELECT table_name, column_name, is_nullable, column_default
			FROM information_schema.columns
			WHERE table_schema = 'ref'
				AND (table_name, column_name) IN (
					('release', 'grid_resolution'),
					('value', 'is_monetary'),
					('value', 'quality_flags'),
					('value', 'cell_coverage_sum'),
					('value', 'redistribution_rule'))
			ORDER BY table_name, column_name
		`);
		const cols = Object.fromEntries(
			(res.rows as any[]).map((r) => [
				`${r.table_name}.${r.column_name}`,
				r.is_nullable,
			]),
		);
		expect(cols).toEqual({
			"release.grid_resolution": "YES",
			"value.cell_coverage_sum": "YES",
			"value.is_monetary": "NO",
			"value.quality_flags": "NO",
			"value.redistribution_rule": "YES",
		});
	});

	it("keeps an existing row valid: not monetary, no flags", async () => {
		const id = await insertValue({
			countryAccountsId: tenant.countryAccountsId,
			releaseId: wpp.releaseId,
			sourceStatus: "international_official",
			value: 1000,
		});
		const res = await dr.execute(sql`
			SELECT is_monetary, quality_flags FROM ref.value WHERE id = ${id}
		`);
		expect(res.rows[0]).toEqual({ is_monetary: false, quality_flags: [] });
	});

	it("accepts each of the seven SEC-19 source rules", async () => {
		for (const rule of [
			"display_and_redistribute",
			"redistribute_share_alike",
			"display_only",
			"signed_in_only",
			"analysis_only",
			"per_resource",
			"excluded",
		]) {
			await expect(sourceWithRule(rule)).resolves.toBeTruthy();
		}
	});

	it("refuses any value from an excluded source (SEC-19 rule 7)", async () => {
		const rel = await sourceWithRule("excluded");
		expect(await pgError(valueOn(rel, null))).toContain("excluded");
	});

	it("needs the resolved rule on a per_resource source's value (rule 6)", async () => {
		const rel = await sourceWithRule("per_resource");
		expect(await pgError(valueOn(rel, null))).toContain("per_resource");
		await expect(
			valueOn(rel, "redistribute_share_alike"),
		).resolves.toBeTruthy();
	});

	it("refuses a value rule that contradicts its source rule", async () => {
		const rel = await sourceWithRule("display_only");
		expect(await pgError(valueOn(rel, "display_and_redistribute"))).toContain(
			"differs from source rule",
		);
		await expect(valueOn(rel, "display_only")).resolves.toBeTruthy();
	});

	it("refuses a source-level rule on a value", async () => {
		const rel = await sourceWithRule("per_resource");
		expect(await pgError(valueOn(rel, "excluded"))).toContain(
			"ref_value_redistribution_rule_check",
		);
	});

	it("runs the value guard on update as well as insert", async () => {
		const rel = await sourceWithRule("display_only");
		const res = await valueOn(rel, null);
		const id = (res.rows[0] as { id: string }).id;
		expect(
			await pgError(
				dr.execute(sql`
					UPDATE ref.value SET redistribution_rule = 'display_and_redistribute'
					WHERE id = ${id}
				`),
			),
		).toContain("differs from source rule");
		const excluded = await sourceWithRule("excluded");
		expect(
			await pgError(
				dr.execute(
					sql`UPDATE ref.value SET release_id = ${excluded} WHERE id = ${id}`,
				),
			),
		).toContain("excluded");
	});

	it("blocks a source rule change to excluded while values exist", async () => {
		const rel = await sourceWithRule("display_only");
		await valueOn(rel, null);
		expect(
			await pgError(
				dr.execute(sql`
					UPDATE ref.source SET redistribution_rule = 'excluded'
					WHERE id = (SELECT source_id FROM ref.release WHERE id = ${rel})
				`),
			),
		).toContain("while values exist");
	});

	it("blocks moving a release with values to another source", async () => {
		const rel = await sourceWithRule("display_only");
		await valueOn(rel, null);
		expect(
			await pgError(
				dr.execute(sql`
					UPDATE ref.release SET source_id = ${wpp.sourceId} WHERE id = ${rel}
				`),
			),
		).toContain("while values exist");
	});

	it("rejects a monetary value without currency, price basis and unit multiplier (rule 3)", async () => {
		const id = await insertValue({
			countryAccountsId: tenant.countryAccountsId,
			releaseId: wpp.releaseId,
			sourceStatus: "international_official",
			value: 5,
			periodStart: "2023-01-01",
			periodEnd: "2023-12-31",
		});
		expect(
			await pgError(
				dr.execute(
					sql`UPDATE ref.value SET is_monetary = true WHERE id = ${id}`,
				),
			),
		).toContain("ref_value_monetary_check");
	});

	it("needs a base year for constant prices (rule 3)", async () => {
		const id = await insertValue({
			countryAccountsId: tenant.countryAccountsId,
			releaseId: wpp.releaseId,
			sourceStatus: "international_official",
			value: 5,
			periodStart: "2022-01-01",
			periodEnd: "2022-12-31",
		});
		expect(
			await pgError(
				dr.execute(sql`
					UPDATE ref.value SET currency = 'AOA', price_basis = 'constant'
					WHERE id = ${id}
				`),
			),
		).toContain("ref_value_constant_base_year_check");
	});

	it("grades a coarse_grid value REF-D only (rule 4)", async () => {
		const id = await insertValue({
			countryAccountsId: tenant.countryAccountsId,
			releaseId: grid.releaseId,
			sourceStatus: "modelled",
			value: 7,
			grade: "REF-C",
			periodStart: "2021-01-01",
			periodEnd: "2021-12-31",
		});
		expect(
			await pgError(
				dr.execute(sql`
					UPDATE ref.value SET quality_flags = ARRAY['coarse_grid']
					WHERE id = ${id}
				`),
			),
		).toContain("ref_value_coarse_grid_grade_check");
		expect(
			await pgError(
				dr.execute(sql`
					UPDATE ref.value SET quality_flags = ARRAY['made_up'], grade = 'REF-D'
					WHERE id = ${id}
				`),
			),
		).toContain("ref_value_quality_flags_check");
		expect(
			await pgError(
				dr.execute(sql`
					UPDATE ref.value
					SET quality_flags = ARRAY['coarse_grid', 'coarse_grid'], grade = 'REF-D'
					WHERE id = ${id}
				`),
			),
		).toContain("ref_value_quality_flags_check");
	});

	it("rejects a negative cell coverage sum", async () => {
		const id = await insertValue({
			countryAccountsId: tenant.countryAccountsId,
			releaseId: grid.releaseId,
			sourceStatus: "modelled",
			value: 7,
			grade: "REF-D",
			periodStart: "2020-01-01",
			periodEnd: "2020-12-31",
		});
		expect(
			await pgError(
				dr.execute(
					sql`UPDATE ref.value SET cell_coverage_sum = -1 WHERE id = ${id}`,
				),
			),
		).toContain("ref_value_cell_coverage_sum_check");
	});

	it("grades interpolated or raked values REF-C or REF-D (rule 5)", async () => {
		const msg = await pgError(
			insertValue({
				countryAccountsId: tenant.countryAccountsId,
				releaseId: wpp.releaseId,
				sourceStatus: "international_official",
				value: 9,
				method: "raked_to_official",
				grade: "REF-B",
				periodStart: "2019-01-01",
				periodEnd: "2019-12-31",
			}),
		);
		expect(msg).toContain("ref_value_interpolation_grade_check");
	});

	it("needs an interval type when a bound is given (rule 6)", async () => {
		const msg = await pgError(
			insertValue({
				countryAccountsId: tenant.countryAccountsId,
				releaseId: wpp.releaseId,
				sourceStatus: "international_official",
				value: 10,
				lowerBound: 8,
				upperBound: 12,
				periodStart: "2018-01-01",
				periodEnd: "2018-12-31",
			}),
		);
		expect(msg).toContain("ref_value_interval_type_required_check");
	});

	it("checks the grid resolution format on a release", async () => {
		expect(
			await pgError(
				dr.execute(sql`
					UPDATE ref.release SET grid_resolution = 'about 1 km'
					WHERE id = ${grid.releaseId}
				`),
			),
		).toContain("ref_release_grid_resolution_check");
		await dr.execute(sql`
			UPDATE ref.release SET grid_resolution = '100 m' WHERE id = ${grid.releaseId}
		`);
	});
});
