import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHash, randomBytes, randomUUID } from "crypto";
import { sql } from "drizzle-orm";
import { dr } from "~/db.server";
import { apiAuth } from "~/backend.server/models/api_key";
import { ApiKeyRepository } from "~/db/queries/apiKeyRepository";
import {
	createTestIds,
	createTestUser,
	cleanupTestUser,
} from "../test-helpers";

// Platform security item 1: API key secrets were stored and compared in
// plaintext, and the settings list sent every full secret to the browser.

const ids = createTestIds();
ids.userEmail = ids.userEmail.replace("@", "-hashkey@");
let created: { id: string; secret: string };
const legacyId = randomUUID();
const legacySecret = randomBytes(32).toString("hex");

function req(key: string) {
	return new Request("http://localhost/en/api/test", {
		headers: { "X-Auth": key },
	});
}

async function statusOf(p: Promise<unknown>) {
	try {
		return { resolved: await p };
	} catch (e) {
		return { status: e instanceof Response ? e.status : String(e) };
	}
}

describe("hashed API keys", () => {
	beforeAll(async () => {
		await createTestUser(ids);
		[created] = await ApiKeyRepository.create({
			name: "hash-test",
			managedByUserId: ids.userId,
			countryAccountsId: ids.countryAccountId,
		});
		// A key as the backfill migration leaves it: plaintext kept, hash and
		// prefix computed in SQL with the same expression as the migration.
		await dr.execute(sql`
			INSERT INTO api_key (id, name, user_id, country_accounts_id, secret, secret_hash, key_prefix)
			VALUES (${legacyId}, 'legacy', ${ids.userId}, ${ids.countryAccountId}, ${legacySecret},
				encode(sha256(convert_to(${legacySecret}, 'UTF8')), 'hex'), left(${legacySecret}, 8))
		`);
	});

	afterAll(async () => {
		await dr.execute(
			sql`DELETE FROM api_key WHERE country_accounts_id = ${ids.countryAccountId}`,
		);
		await cleanupTestUser(ids);
	});

	it("returns the raw secret once and stores only its SHA-256 hash and prefix", async () => {
		expect(created.secret).toMatch(/^[0-9a-f]{64}$/);
		const res = await dr.execute(
			sql`SELECT secret, secret_hash, key_prefix FROM api_key WHERE id = ${created.id}`,
		);
		const row = res.rows[0] as any;
		expect(row.secret).toBeNull();
		expect(row.secret_hash).toBe(
			createHash("sha256").update(created.secret).digest("hex"),
		);
		expect(row.key_prefix).toBe(created.secret.slice(0, 8));
	});

	it("authenticates a new key by its raw secret and returns no secret material", async () => {
		const key: any = await apiAuth(req(created.secret));
		expect(key.id).toBe(created.id);
		expect(key.countryAccountsId).toBe(ids.countryAccountId);
		expect(key).not.toHaveProperty("secret");
		expect(key).not.toHaveProperty("secretHash");
	});

	it("keeps a backfilled legacy key valid", async () => {
		const key: any = await apiAuth(req(legacySecret));
		expect(key.id).toBe(legacyId);
	});

	it("rejects the stored hash presented as a key", async () => {
		const res = await dr.execute(
			sql`SELECT secret_hash FROM api_key WHERE id = ${created.id}`,
		);
		const hash = (res.rows[0] as any).secret_hash as string;
		expect(await statusOf(apiAuth(req(hash)))).toEqual({ status: 401 });
	});

	it("rejects a wrong key with 401", async () => {
		expect(
			await statusOf(apiAuth(req(randomBytes(32).toString("hex")))),
		).toEqual({ status: 401 });
	});

	it("never returns secret material to the settings list", async () => {
		const items = await ApiKeyRepository.getByCountryAccountsIdWithUser(
			ids.countryAccountId,
		);
		expect(items.length).toBe(2);
		for (const item of items as any[]) {
			expect(item).not.toHaveProperty("secret");
			expect(item).not.toHaveProperty("secretHash");
			expect(item.keyPrefix).toMatch(/^[0-9a-f]{8}$/);
		}
	});
});
