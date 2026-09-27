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
import { sql } from "drizzle-orm";
import { dr } from "~/db.server";
import {
	createTestIds,
	createTestUser,
	cleanupTestUser,
} from "../test-helpers";

// Platform security item 2: the view loaders fetched an item by id first and
// compared tenants afterwards, in each route. A mismatch returned 403 on the
// hazardous event page and 401 on the disaster event page, which confirms
// that the id exists in another tenant. Every miss must be 404.
// The events are published so that the draft-privacy rule, which also
// answers 404, cannot mask the tenant check.

let sessionTenant = "";
vi.mock("~/utils/session", async (importOriginal) => {
	const original = await importOriginal<any>();
	return {
		...original,
		getCountryAccountsIdFromSession: vi.fn(async () => sessionTenant),
		getCountrySettingsFromSession: vi.fn(async () => ({
			approvedRecordsArePublic: false,
		})),
		getUserIdFromSession: vi.fn(async () => null),
	};
});
vi.mock("~/utils/auth", async (importOriginal) => {
	const original = await importOriginal<any>();
	return {
		...original,
		optionalUser: vi.fn(async () => null),
		authLoaderWithPerm: vi.fn(
			(_perm: string, fn: Function) => async (args: any) =>
				fn({ ...args, userSession: { user: { id: "u" } } }),
		),
		authLoaderPublicOrWithPerm: vi.fn(
			(_perm: string, fn: Function) => async (args: any) =>
				fn({ ...args, userSession: { user: { id: "u" } } }),
		),
	};
});

import * as session from "~/utils/session";
import * as auth from "~/utils/auth";
import { loader as hazardousEventLoader } from "~/routes/$lang+/hazardous-event+/$id";
import { loader as disasterEventLoader } from "~/routes/$lang+/disaster-event+/$id";
import { createViewLoaderPublicApproved } from "~/backend.server/handlers/form/form";

const owner = createTestIds();
owner.userEmail = owner.userEmail.replace("@", "-viewowner@");
const other = createTestIds();
other.userEmail = other.userEmail.replace("@", "-viewother@");
const hazardousEventId = randomUUID();
const disasterEventId = randomUUID();

async function statusOf(fn: () => Promise<any>) {
	try {
		return { resolved: await fn() };
	} catch (e) {
		if (e instanceof Response) return { status: e.status };
		throw e;
	}
}

function args(tenant: string, path: string, id: string) {
	sessionTenant = tenant;
	return {
		request: new Request(`http://localhost/en/${path}/${id}`),
		params: { lang: "en", id },
		context: {},
	} as any;
}

// test-helpers.ts also mocks these modules (its vi.mock calls are hoisted),
// so set the behaviour this test needs explicitly.
function useSignedInSession() {
	vi.mocked(session.getCountryAccountsIdFromSession).mockImplementation(
		async () => sessionTenant,
	);
	vi.mocked(session.getCountrySettingsFromSession).mockResolvedValue({
		approvedRecordsArePublic: false,
	} as any);
	vi.mocked(session.getUserIdFromSession).mockResolvedValue(null as any);
	vi.mocked(auth.optionalUser).mockResolvedValue(null as any);
	const signedIn = (_perm: string, fn: Function) => async (a: any) =>
		fn({ ...a, userSession: { user: { id: "u" } } });
	vi.mocked(auth.authLoaderWithPerm).mockImplementation(signedIn as any);
	vi.mocked(auth.authLoaderPublicOrWithPerm).mockImplementation(signedIn as any);
}

describe("view loaders read through a tenant-scoped getter", () => {
	beforeEach(() => {
		useSignedInSession();
	});
	beforeAll(async () => {
		await createTestUser(owner);
		await createTestUser(other);
		const hipType = await dr.execute(sql`SELECT id FROM hip_class LIMIT 1`);
		const hipTypeId = (hipType.rows[0] as any).id;
		await dr.execute(sql`
			INSERT INTO event (id) VALUES (${hazardousEventId}), (${disasterEventId})
		`);
		await dr.execute(sql`
			INSERT INTO hazardous_event (id, country_accounts_id, hip_type_id, "approvalStatus")
			VALUES (${hazardousEventId}, ${owner.countryAccountId}, ${hipTypeId}, 'published')
		`);
		await dr.execute(sql`
			INSERT INTO disaster_event (id, country_accounts_id, "approvalStatus")
			VALUES (${disasterEventId}, ${owner.countryAccountId}, 'published')
		`);
	});

	afterAll(async () => {
		await dr.execute(sql`DELETE FROM disaster_event WHERE id = ${disasterEventId}`);
		await dr.execute(sql`DELETE FROM hazardous_event WHERE id = ${hazardousEventId}`);
		await dr.execute(
			sql`DELETE FROM event WHERE id IN (${hazardousEventId}, ${disasterEventId})`,
		);
		await cleanupTestUser(owner);
		await cleanupTestUser(other);
	});

	it("hazardous event page returns 404 for another tenant's event", async () => {
		expect(
			await statusOf(() =>
				hazardousEventLoader(
					args(other.countryAccountId, "hazardous-event", hazardousEventId),
				),
			),
		).toEqual({ status: 404 });
	});

	it("disaster event page returns 404 for another tenant's event", async () => {
		expect(
			await statusOf(() =>
				disasterEventLoader(
					args(other.countryAccountId, "disaster-event", disasterEventId),
				),
			),
		).toEqual({ status: 404 });
	});

	it("hazardous event page returns 404, not 500, for an unknown id", async () => {
		expect(
			await statusOf(() =>
				hazardousEventLoader(
					args(owner.countryAccountId, "hazardous-event", randomUUID()),
				),
			),
		).toEqual({ status: 404 });
	});

	it("disaster event page returns 404, not 500, for an unknown id", async () => {
		expect(
			await statusOf(() =>
				disasterEventLoader(
					args(owner.countryAccountId, "disaster-event", randomUUID()),
				),
			),
		).toEqual({ status: 404 });
	});

	it("the factory returns 404 even when a getter ignores the tenant", async () => {
		const leakyGetter = async () => ({
			id: hazardousEventId,
			countryAccountsId: owner.countryAccountId,
			approvalStatus: "draft",
		});
		const loader = createViewLoaderPublicApproved({
			getByIdForTenant: leakyGetter,
		} as any);
		expect(
			await statusOf(() =>
				loader(args(other.countryAccountId, "x", hazardousEventId)),
			),
		).toEqual({ status: 404 });
	});

	it("the factory returns the item to its own tenant", async () => {
		const getter = vi.fn(async (_ctx: any, id: string, tenant: string) =>
			tenant === owner.countryAccountId
				? { id, countryAccountsId: tenant, approvalStatus: "draft" }
				: null,
		);
		const loader = createViewLoaderPublicApproved({
			getByIdForTenant: getter,
		} as any);
		const res: any = await loader(
			args(owner.countryAccountId, "x", hazardousEventId),
		);
		expect(res.item.id).toBe(hazardousEventId);
		expect(getter).toHaveBeenCalledWith(
			expect.anything(),
			hazardousEventId,
			owner.countryAccountId,
		);
	});
});
