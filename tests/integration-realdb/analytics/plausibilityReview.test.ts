import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { dr } from "~/db.server";
import {
	createTestIds,
	createTestUser,
	cleanupTestUser,
} from "../test-helpers";
import { getPlausibilityReviewQueue } from "~/backend.server/models/analytics/plausibilityReview";

const ids = createTestIds();
ids.userEmail = ids.userEmail.replace("@", "-plausq@");
const flagged = randomUUID();
const clean = randomUUID();

describe("getPlausibilityReviewQueue", () => {
	beforeAll(async () => {
		await createTestUser(ids);
		const flags = JSON.stringify({
			migration: {
				plausibility_flags: [
					{
						code: "HAZARD_EFFECT_MISMATCH",
						fields: ["desaparece", "heridos"],
						rule_version: "c30-v1",
					},
					{
						code: "SENTINEL_MAGNITUDE",
						fields: ["kmvias"],
						rule_version: "c30-v1",
					},
				],
			},
		});
		await dr.execute(sql`
			INSERT INTO disaster_records (id, country_accounts_id, "approvalStatus", api_import_id, legacy_data)
			VALUES (${flagged}, ${ids.countryAccountId}, 'draft', 'DIX:test:945', ${flags}::jsonb),
			       (${clean}, ${ids.countryAccountId}, 'draft', 'DIX:test:1', '{}'::jsonb)
		`);
	});

	afterAll(async () => {
		await dr.execute(
			sql`DELETE FROM disaster_records WHERE country_accounts_id = ${ids.countryAccountId}`,
		);
		await cleanupTestUser(ids);
	});

	it("lists only flagged records of the tenant, with the measures concerned", async () => {
		const q = await getPlausibilityReviewQueue(ids.countryAccountId);
		expect(q).toHaveLength(1);
		expect(q[0].apiImportId).toBe("DIX:test:945");
		expect(q[0].flags.map((f) => f.code)).toEqual([
			"HAZARD_EFFECT_MISMATCH",
			"SENTINEL_MAGNITUDE",
		]);
		expect(q[0].measures.sort()).toEqual(["injured", "missing"]);
	});

	it("returns nothing for another tenant", async () => {
		expect(await getPlausibilityReviewQueue(randomUUID())).toEqual([]);
	});
});
