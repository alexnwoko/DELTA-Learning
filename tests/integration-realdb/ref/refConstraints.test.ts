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

// E1: the ref.value CHECK constraints enforce the JSON schema rules in the
// database, whatever path writes the row.

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

describe("ref.value CHECK constraints", () => {
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

	it("rejects a not_reported row that carries a value", async () => {
		const msg = await pgError(
			insertValue({
				countryAccountsId: tenant.countryAccountsId,
				releaseId: wpp.releaseId,
				sourceStatus: "international_official",
				value: 0,
				valueState: "not_reported",
			}),
		);
		expect(msg).toContain("ref_value_null_is_not_zero_check");
	});

	it("rejects a reported row with no value", async () => {
		const msg = await pgError(
			insertValue({
				countryAccountsId: tenant.countryAccountsId,
				releaseId: wpp.releaseId,
				sourceStatus: "international_official",
				value: null,
				valueState: "reported",
			}),
		);
		expect(msg).toContain("ref_value_null_is_not_zero_check");
	});

	it("rejects zero_confirmed with a non-zero value", async () => {
		const msg = await pgError(
			insertValue({
				countryAccountsId: tenant.countryAccountsId,
				releaseId: wpp.releaseId,
				sourceStatus: "international_official",
				value: 4,
				valueState: "zero_confirmed",
			}),
		);
		expect(msg).toContain("ref_value_zero_confirmed_check");
	});

	it("rejects a modelled value graded REF-A", async () => {
		const msg = await pgError(
			insertValue({
				countryAccountsId: tenant.countryAccountsId,
				releaseId: grid.releaseId,
				sourceStatus: "modelled",
				value: 10,
				grade: "REF-A",
			}),
		);
		expect(msg).toMatch(
			/ref_value_grade_a_official_check|ref_value_modelled_grade_check/,
		);
	});

	it("rejects a modelled value graded REF-B", async () => {
		const msg = await pgError(
			insertValue({
				countryAccountsId: tenant.countryAccountsId,
				releaseId: grid.releaseId,
				sourceStatus: "modelled",
				value: 10,
				grade: "REF-B",
			}),
		);
		expect(msg).toContain("ref_value_modelled_grade_check");
	});

	it("rejects REF-A on an international official source", async () => {
		const msg = await pgError(
			insertValue({
				countryAccountsId: tenant.countryAccountsId,
				releaseId: wpp.releaseId,
				sourceStatus: "international_official",
				value: 10,
				grade: "REF-A",
			}),
		);
		expect(msg).toContain("ref_value_grade_a_official_check");
	});

	it("rejects a value whose source status disagrees with its release", async () => {
		// Claiming official_national on a modelled release, to slip past the
		// grade checks, fails the composite foreign key.
		const msg = await pgError(
			insertValue({
				countryAccountsId: tenant.countryAccountsId,
				releaseId: grid.releaseId,
				sourceStatus: "official_national",
				value: 10,
				grade: "REF-A",
			}),
		);
		expect(msg).toContain("ref_value_release_fk");
	});

	it("rejects unknown method, grade and value_state values", async () => {
		const base = {
			countryAccountsId: tenant.countryAccountsId,
			releaseId: wpp.releaseId,
			sourceStatus: "international_official",
			value: 10,
		};
		expect(await pgError(insertValue({ ...base, method: "guess" }))).toContain(
			"ref_value_method_check",
		);
		expect(await pgError(insertValue({ ...base, grade: "REF-E" }))).toContain(
			"ref_value_grade_check",
		);
		expect(
			await pgError(
				insertValue({ ...base, value: null, valueState: "estimated" }),
			),
		).toContain("ref_value_value_state_check");
	});

	it("rejects an unknown redistribution rule on a source", async () => {
		const msg = await pgError(
			dr.execute(sql`
				INSERT INTO ref.source (name, licence, redistribution_rule, source_status)
				VALUES (${`Bad ${tag}`}, 'CC BY 4.0', 'free_for_all', 'modelled')
			`),
		);
		expect(msg).toContain("ref_source_redistribution_rule_check");
	});

	it("accepts a valid row and rejects a second national row on the same key", async () => {
		const row = {
			countryAccountsId: tenant.countryAccountsId,
			releaseId: wpp.releaseId,
			sourceStatus: "international_official",
			value: 1000,
		};
		await insertValue(row);
		const msg = await pgError(insertValue({ ...row, value: 2000 }));
		expect(msg).toContain("ref_value_natural_key_idx");
	});
});
