import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { dr } from "~/db.server";
import {
	createTestIds,
	setupSessionMocks,
	createTestUser,
	cleanupTestUser,
	mockSessionValues,
	createOtherTenant,
	cleanupOtherTenant,
} from "../../test-helpers";
import { loader } from "~/routes/$lang+/analytics+/plausibility-review";
import { getCountryAccountsIdFromSession } from "~/utils/session";

// C30 review-queue screen: the loader lists only the session tenant's
// flagged records and refuses a request without a tenant.

const ids = createTestIds();
ids.userEmail = ids.userEmail.replace("@", "-prscreen@");
setupSessionMocks();

const own = randomUUID();
const foreign = randomUUID();
let otherTenant = "";
const flags = JSON.stringify({
	migration: {
		plausibility_flags: [
			{
				code: "IDENTICAL_ACROSS_FIELDS",
				fields: ["damnificados", "vivafec"],
				rule_version: "c30-v1",
			},
		],
	},
});

async function callLoader() {
	return (loader as any)({
		request: new Request("http://localhost/en/analytics/plausibility-review"),
		params: { lang: "en" },
		context: {},
	});
}

describe("plausibility-review loader", () => {
	beforeAll(async () => {
		await createTestUser(ids);
		otherTenant = await createOtherTenant();
		await dr.execute(sql`
			INSERT INTO disaster_records (id, country_accounts_id, "approvalStatus", api_import_id, legacy_data)
			VALUES (${own}, ${ids.countryAccountId}, 'draft', 'DIX:own:1', ${flags}::jsonb),
			       (${foreign}, ${otherTenant}, 'draft', 'DIX:other:1', ${flags}::jsonb)
		`);
	});

	afterAll(async () => {
		await dr.execute(
			sql`DELETE FROM disaster_records WHERE id IN (${own}, ${foreign})`,
		);
		await cleanupOtherTenant();
		await cleanupTestUser(ids);
	});

	it("lists only the session tenant's flagged records", async () => {
		await mockSessionValues(ids);
		const res = await callLoader();
		expect(res.items.map((i: any) => i.apiImportId)).toEqual(["DIX:own:1"]);
		expect(res.items[0].measures.sort()).toEqual([
			"affected_direct",
			"houses_damaged",
		]);
	});

	it("refuses a request without a tenant", async () => {
		vi.mocked(getCountryAccountsIdFromSession).mockResolvedValue(null as any);
		const outcome = await callLoader().catch((e: unknown) => e);
		expect(outcome).toBeInstanceOf(Response);
		expect((outcome as Response).status).toBe(401);
	});
});
