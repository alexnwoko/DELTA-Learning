import {
	describe,
	it,
	expect,
	beforeAll,
	beforeEach,
	afterAll,
	vi,
} from "vitest";
import { randomUUID } from "crypto";
import { ApiKeyRepository } from "~/db/queries/apiKeyRepository";
import {
	createTestIds,
	createTestUser,
	cleanupTestUser,
} from "../../test-helpers";

// Platform security: the API key edit loader fetched any tenant's key by id
// and returned the whole row, secret included, to a user of another tenant.

let sessionTenant = "";
vi.mock("~/utils/session", async (importOriginal) => {
	const original = await importOriginal<any>();
	return {
		...original,
		getCountryAccountsIdFromSession: vi.fn(async () => sessionTenant),
	};
});
vi.mock("~/utils/auth", async (importOriginal) => {
	const original = await importOriginal<any>();
	return {
		...original,
		authLoaderWithPerm: vi.fn(
			(_perm: string, fn: Function) => async (args: any) => fn(args),
		),
	};
});

import * as session from "~/utils/session";
import * as auth from "~/utils/auth";
import { loader } from "~/routes/$lang+/settings+/api-key+/edit.$id";

const owner = createTestIds();
owner.userEmail = owner.userEmail.replace("@", "-keyowner@");
const other = createTestIds();
other.userEmail = other.userEmail.replace("@", "-keyother@");
let keyId = "";

async function callLoader(tenant: string, id: string) {
	sessionTenant = tenant;
	const request = new Request(`http://localhost/en/settings/api-key/edit/${id}`);
	try {
		return await (loader as any)({
			request,
			params: { lang: "en", id },
			context: {},
		});
	} catch (e) {
		if (e instanceof Response) return { status: e.status };
		throw e;
	}
}

describe("settings api-key edit loader tenant isolation", () => {
	// test-helpers.ts also mocks these modules (its vi.mock calls are hoisted),
	// so set the behaviour this test needs explicitly.
	beforeEach(() => {
		vi.mocked(session.getCountryAccountsIdFromSession).mockImplementation(
			async () => sessionTenant,
		);
		vi.mocked(auth.authLoaderWithPerm).mockImplementation(
			((_perm: string, fn: Function) => async (args: any) => fn(args)) as any,
		);
	});
	beforeAll(async () => {
		await createTestUser(owner);
		await createTestUser(other);
		const rows = await ApiKeyRepository.create({
			name: "edit-tenant-test",
			managedByUserId: owner.userId,
			countryAccountsId: owner.countryAccountId,
		});
		keyId = rows[0].id;
	});

	afterAll(async () => {
		await ApiKeyRepository.delete(keyId);
		await cleanupTestUser(owner);
		await cleanupTestUser(other);
	});

	it("returns 404 for a key that belongs to another tenant", async () => {
		expect(await callLoader(other.countryAccountId, keyId)).toEqual({
			status: 404,
		});
	});

	it("returns 404 for an unknown key id", async () => {
		expect(await callLoader(owner.countryAccountId, randomUUID())).toEqual({
			status: 404,
		});
	});

	it("returns the key to its own tenant without any secret material", async () => {
		const res = await callLoader(owner.countryAccountId, keyId);
		expect(res.item.id).toBe(keyId);
		expect(res.item.name).toBe("edit-tenant-test");
		expect(res.item).not.toHaveProperty("secret");
		expect(res.item).not.toHaveProperty("secretHash");
	});
});
