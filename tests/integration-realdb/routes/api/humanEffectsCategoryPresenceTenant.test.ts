import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { dr } from "~/db.server";
import {
	createTestIds,
	createTestUser,
	cleanupTestUser,
} from "../../test-helpers";

// The API key's tenant is whatever the test sets here; apiAuth is mocked so
// the route's own ownership check is what is under test.
let keyTenant = "";
vi.mock("~/backend.server/models/api_key", async (importOriginal) => {
	const original = await importOriginal<any>();
	return {
		...original,
		apiAuth: vi.fn(async () => ({ countryAccountsId: keyTenant })),
	};
});

import { action } from "~/routes/$lang+/api+/human-effects+/category-presence-save";

const ids = createTestIds();
ids.userEmail = ids.userEmail.replace("@", "-presence@");
const recordId = randomUUID();

async function callAction(tenant: string, record: string) {
	keyTenant = tenant;
	const request = new Request(
		`http://localhost/en/api/human-effects/category-presence-save?recordId=${record}`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json", "X-Auth": "test" },
			body: JSON.stringify({ table: "Deaths", data: { deaths: true } }),
		},
	);
	return (action as any)({ request, params: { lang: "en" }, context: {} });
}

async function deathsFlag(): Promise<boolean | null> {
	const res = await dr.execute(
		sql`SELECT deaths FROM human_category_presence WHERE record_id = ${recordId}`,
	);
	return res.rows.length ? (res.rows[0].deaths as boolean | null) : null;
}

describe("api human-effects/category-presence-save tenant isolation", () => {
	beforeAll(async () => {
		await createTestUser(ids);
		await dr.execute(sql`
			INSERT INTO disaster_records (id, country_accounts_id, "approvalStatus")
			VALUES (${recordId}, ${ids.countryAccountId}, 'draft')
		`);
	});

	afterAll(async () => {
		await dr.execute(
			sql`DELETE FROM human_category_presence WHERE record_id = ${recordId}`,
		);
		await dr.execute(sql`DELETE FROM disaster_records WHERE id = ${recordId}`);
		await cleanupTestUser(ids);
	});

	it("rejects a record that belongs to another tenant and leaves it unchanged", async () => {
		const outcome = await callAction(randomUUID(), recordId).catch(
			(e: unknown) => e,
		);
		expect(outcome).toBeInstanceOf(Response);
		expect((outcome as Response).status).toBe(404);
		expect(await deathsFlag()).toBeNull();
	});

	it("rejects a missing recordId", async () => {
		const outcome = await callAction(ids.countryAccountId, "").catch(
			(e: unknown) => e,
		);
		expect(outcome).toBeInstanceOf(Response);
		expect((outcome as Response).status).toBe(400);
	});

	it("saves presence for the key's own record", async () => {
		const res = await callAction(ids.countryAccountId, recordId);
		expect(res).toEqual({ ok: true });
		expect(await deathsFlag()).toBe(true);
	});
});
