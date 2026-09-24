import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { dr } from "~/db.server";
import { divisionTable } from "~/drizzle/schema/divisionTable";
import {
	createTestIds,
	createTestUser,
	cleanupTestUser,
} from "../test-helpers";
import { getTotalRecords } from "~/components/ContentPicker/DataSource";

// The analytics content picker is served on a public route. Without a
// session tenant, the query builder skipped the tenant filter and returned
// every tenant's rows. Tenant-scoped tables must now return nothing.

const ids = createTestIds();
ids.userEmail = ids.userEmail.replace("@", "-picker@");
const divisionId = randomUUID();

const config = {
	dataSourceDrizzle: {
		table: divisionTable,
		selects: [{ alias: "id", column: divisionTable.id }],
		where: [eq(divisionTable.id, divisionId)],
	},
};

describe("content picker tenant isolation", () => {
	beforeAll(async () => {
		await createTestUser(ids);
		await dr.execute(sql`
			INSERT INTO division (id, country_accounts_id, name, level)
			VALUES (${divisionId}, ${ids.countryAccountId}, '{"en":"D"}'::jsonb, 1)
		`);
	});

	afterAll(async () => {
		await dr.execute(sql`DELETE FROM division WHERE id = ${divisionId}`);
		await cleanupTestUser(ids);
	});

	it("returns the row to its own tenant", async () => {
		expect(
			Number(await getTotalRecords(config, "", ids.countryAccountId)),
		).toBe(1);
	});

	it("returns nothing to another tenant", async () => {
		expect(Number(await getTotalRecords(config, "", randomUUID()))).toBe(0);
	});

	it("returns nothing when no tenant is resolved", async () => {
		expect(Number(await getTotalRecords(config, "", undefined))).toBe(0);
	});
});
