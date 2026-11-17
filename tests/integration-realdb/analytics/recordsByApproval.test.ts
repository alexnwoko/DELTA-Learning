import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { dr } from "~/db.server";
import {
	createTestIds,
	createTestUser,
	cleanupTestUser,
} from "../test-helpers";
import { getRecordsByApproval } from "~/backend.server/models/analytics/dashboard/recordsByApproval.server";
import { DEFAULT_QUERY } from "~/utils/deltaQuery";

// One published record, two drafts (one HIPs 1042), one retired draft.
const ids = createTestIds();
ids.userEmail = ids.userEmail.replace("@", "-recapproval@");

const ctx = () => ({
	countryAccountsId: ids.countryAccountId,
	audience: "public" as const,
	tenantName: "Testland",
	provisional: false,
});

describe("getRecordsByApproval", () => {
	beforeAll(async () => {
		await createTestUser(ids);
		const recs: [string, string, string | null, string | null][] = [
			["published", "2020", "1042", null],
			["draft", "2020", "1042", null],
			["draft", "2021", null, null],
			["draft", "2021", null, '{"migration":{"retired":true}}'],
		];
		for (const [status, start, type, legacy] of recs) {
			await dr.execute(sql`
				INSERT INTO disaster_records (id, country_accounts_id, "approvalStatus", start_date, hip_type_id, legacy_data)
				VALUES (${randomUUID()}, ${ids.countryAccountId}, ${status}, ${start}, ${type}, ${legacy}::jsonb)`);
		}
	});

	afterAll(async () => {
		await dr.execute(
			sql`DELETE FROM disaster_records WHERE country_accounts_id = ${ids.countryAccountId}`,
		);
		await cleanupTestUser(ids);
	});

	it("counts published and unpublished records in scope, retired left out, whatever the basis", async () => {
		expect(await getRecordsByApproval(DEFAULT_QUERY, ctx())).toEqual({
			published: 1,
			unpublished: 2,
		});
	});

	it("applies the query's filters", async () => {
		expect(
			await getRecordsByApproval(
				{ ...DEFAULT_QUERY, where: { hazard: { typeId: "1042" } } },
				ctx(),
			),
		).toEqual({ published: 1, unpublished: 1 });
	});
});
