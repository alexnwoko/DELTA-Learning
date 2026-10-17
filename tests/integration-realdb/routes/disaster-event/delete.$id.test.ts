import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
	createTestIds,
	setupSessionMocks,
	createTestUser,
	cleanupTestUser,
	mockSessionValues,
	TEST_BASE_URL,
	createOtherTenant,
	cleanupOtherTenant,
} from "../../test-helpers";
import { createTestDisasterEventWithOptions } from "./test-helpers";
import { dr } from "~/db.server";
import { disasterEventTable } from "~/drizzle/schema/disasterEventTable";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { getCountryAccountsIdFromSession } from "~/utils/session";
import {
	loader as deleteLoader,
	action as deleteAction,
} from "~/routes/$lang+/disaster-event+/delete.$id";

const testIds = createTestIds();
testIds.userEmail = testIds.userEmail.replace("@", "-de-delete@");

setupSessionMocks();

function args(id: string, method: "GET" | "POST") {
	const url = `${TEST_BASE_URL}/en/disaster-event/delete/${id}`;
	return {
		request: new Request(url, { method }),
		params: { lang: "en", id },
		context: {},
	} as any;
}

async function eventExists(id: string) {
	const rows = await dr
		.select({ id: disasterEventTable.id })
		.from(disasterEventTable)
		.where(eq(disasterEventTable.id, id));
	return rows.length === 1;
}

describe("disaster-event delete.$id.tsx", () => {
	let testData: Awaited<ReturnType<typeof createTestDisasterEventWithOptions>>;

	beforeEach(async () => {
		vi.clearAllMocks();
		await mockSessionValues(testIds);
		await createTestUser(testIds);

		testData = await createTestDisasterEventWithOptions(
			testIds.countryAccountId,
		);
	});

	afterEach(async () => {
		await cleanupTestUser(testIds);
	});

	describe("loader", () => {
		it("should return the event name", async () => {
			const data = await deleteLoader(args(testData.disasterEventId, "GET"));

			expect(data.item.id).toBe(testData.disasterEventId);
			expect(data.item.name).toBe("Test Disaster Event");
		});

		it("should return 401 for missing country accounts id", async () => {
			vi.mocked(getCountryAccountsIdFromSession).mockResolvedValueOnce(
				null as any,
			);

			await expect(
				deleteLoader(args(testData.disasterEventId, "GET")),
			).rejects.toMatchObject({ status: 401 });
		});

		it("should return 404 for non-existent event", async () => {
			await expect(
				deleteLoader(args(randomUUID(), "GET")),
			).rejects.toMatchObject({ status: 404 });
		});

		it("should return 404 for event from different tenant", async () => {
			const otherTenantId = await createOtherTenant();
			const otherData = await createTestDisasterEventWithOptions(otherTenantId);

			await expect(
				deleteLoader(args(otherData.disasterEventId, "GET")),
			).rejects.toMatchObject({ status: 404 });

			await cleanupOtherTenant();
		});
	});

	describe("action", () => {
		it("should delete the event and redirect", async () => {
			const response = await deleteAction(
				args(testData.disasterEventId, "POST"),
			);

			expect((response as Response).status).toBe(302);
			expect((response as Response).headers.get("Location")).toBe(
				"/disaster-event",
			);
			expect(await eventExists(testData.disasterEventId)).toBe(false);
		});

		it("should return 401 for missing country accounts id", async () => {
			vi.mocked(getCountryAccountsIdFromSession).mockResolvedValueOnce(
				null as any,
			);

			await expect(
				deleteAction(args(testData.disasterEventId, "POST")),
			).rejects.toMatchObject({ status: 401 });
			expect(await eventExists(testData.disasterEventId)).toBe(true);
		});

		it("should return 404 for non-existent event", async () => {
			await expect(
				deleteAction(args(randomUUID(), "POST")),
			).rejects.toMatchObject({ status: 404 });
		});

		it("should return 404 and keep an event from a different tenant", async () => {
			const otherTenantId = await createOtherTenant();
			const otherData = await createTestDisasterEventWithOptions(otherTenantId);

			await expect(
				deleteAction(args(otherData.disasterEventId, "POST")),
			).rejects.toMatchObject({ status: 404 });
			expect(await eventExists(otherData.disasterEventId)).toBe(true);

			await cleanupOtherTenant();
		});
	});
});
