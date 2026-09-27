import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { dr } from "~/db.server";

// Architecture 48h plan P0: select-instance wrote any posted tenant id into
// the session, without a signed-in user or a membership check.
// Self-contained on purpose: test-helpers.ts registers its own session mock,
// which lacks sessionCookie and would override this one.

let sessionUser: { user: { id: string } } | undefined;
vi.mock("~/utils/session", async (importOriginal) => {
	const original = await importOriginal<any>();
	return { ...original, getUserFromSession: vi.fn(async () => sessionUser) };
});

import { SelectInstanceService } from "~/services/selectInstanceService";

const userId = randomUUID();
const tenant = {
	own: randomUUID(),
	other: randomUUID(),
	inactive: randomUUID(),
};
const countryIds = [randomUUID(), randomUUID(), randomUUID()];

async function post(countryAccountsId: string) {
	const request = new Request("http://localhost/en/user/select-instance", {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({ countryAccountsId }),
	});
	return SelectInstanceService.action({
		request,
		params: { lang: "en" },
		context: {},
	} as any).catch((e: unknown) => e);
}

function setsTenant(res: unknown): boolean {
	return (
		res instanceof Response &&
		res.status >= 300 &&
		res.status < 400 &&
		(res.headers.get("Set-Cookie") || "").length > 0
	);
}

describe("select-instance membership", () => {
	beforeAll(async () => {
		await dr.execute(sql`
			INSERT INTO "user" (id, email, email_verified)
			VALUES (${userId}, ${`selinst_${userId}@example.com`}, true)
		`);
		const accounts: [string, string, number][] = [
			[tenant.own, countryIds[0], 1],
			[tenant.other, countryIds[1], 1],
			[tenant.inactive, countryIds[2], 0],
		];
		for (const [id, countryId, status] of accounts) {
			await dr.execute(sql`
				INSERT INTO countries (id, name) VALUES (${countryId}, ${`Sel ${countryId.slice(0, 8)}`})
			`);
			await dr.execute(sql`
				INSERT INTO country_accounts (id, short_description, country_id, status, type)
				VALUES (${id}, 'Select instance test', ${countryId}, ${status}, 'Training')
			`);
		}
		for (const id of [tenant.own, tenant.inactive]) {
			await dr.execute(sql`
				INSERT INTO user_country_accounts (user_id, country_accounts_id, role)
				VALUES (${userId}, ${id}, 'admin')
			`);
		}
	});

	afterAll(async () => {
		await dr.execute(
			sql`DELETE FROM user_country_accounts WHERE user_id = ${userId}`,
		);
		for (const id of Object.values(tenant)) {
			await dr.execute(
				sql`DELETE FROM instance_system_settings WHERE country_accounts_id = ${id}`,
			);
			await dr.execute(sql`DELETE FROM country_accounts WHERE id = ${id}`);
		}
		for (const id of countryIds) {
			await dr.execute(sql`DELETE FROM countries WHERE id = ${id}`);
		}
		await dr.execute(sql`DELETE FROM "user" WHERE id = ${userId}`);
	});

	it("rejects an anonymous request", async () => {
		sessionUser = undefined;
		expect(setsTenant(await post(tenant.own))).toBe(false);
	});

	it("rejects a tenant the user is not a member of", async () => {
		sessionUser = { user: { id: userId } };
		expect(setsTenant(await post(tenant.other))).toBe(false);
		expect(setsTenant(await post(randomUUID()))).toBe(false);
	});

	it("rejects an inactive tenant the user belongs to", async () => {
		sessionUser = { user: { id: userId } };
		expect(setsTenant(await post(tenant.inactive))).toBe(false);
	});

	it("accepts the user's own active tenant", async () => {
		sessionUser = { user: { id: userId } };
		expect(setsTenant(await post(tenant.own))).toBe(true);
	});
});
