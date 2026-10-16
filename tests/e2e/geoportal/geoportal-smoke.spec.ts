// Geoportal smoke test (I-2 exit, review gap 7). A fresh tenant with no
// geo data: the page must load, show the question bar, the honest empty
// state and the "Disaster impact" vocabulary, and fit a phone screen.
import { test, expect } from "@playwright/test";
import { userCountryAccountsTable } from "~/drizzle/schema/userCountryAccountsTable";
import { countryAccountsTable } from "~/drizzle/schema/countryAccountsTable";
import { instanceSystemSettingsTable } from "~/drizzle/schema/instanceSystemSettingsTable";
import { userTable } from "~/drizzle/schema";
import { dr, initDB } from "~/db.server";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

const testEmail = `e2e_geo_${Date.now()}@test.com`;
const userId = randomUUID();
const countryAccountId = randomUUID();

test.beforeAll(async () => {
	initDB();
	const passwordHash = bcrypt.hashSync("Password123!", 10);
	await dr.transaction(async (tx) => {
		await tx.insert(userTable).values({
			id: userId,
			email: testEmail,
			password: passwordHash,
			emailVerified: true,
		});
		await tx.insert(countryAccountsTable).values({
			id: countryAccountId,
			shortDescription: "description",
			countryId: "e34ef71f-0a72-40c4-a6e0-dd19fb26f391",
			status: 1,
			type: "Training",
		});
		await tx.insert(userCountryAccountsTable).values({
			userId,
			countryAccountsId: countryAccountId,
			role: "admin",
			isPrimaryAdmin: true,
		});
		await tx.insert(instanceSystemSettingsTable).values({
			countryAccountsId: countryAccountId,
			approvedRecordsArePublic: true,
		});
	});
});

test.afterAll(async () => {
	await dr.transaction(async (tx) => {
		await tx
			.delete(instanceSystemSettingsTable)
			.where(
				eq(instanceSystemSettingsTable.countryAccountsId, countryAccountId),
			);
		await tx
			.delete(userCountryAccountsTable)
			.where(eq(userCountryAccountsTable.countryAccountsId, countryAccountId));
		await tx
			.delete(countryAccountsTable)
			.where(eq(countryAccountsTable.id, countryAccountId));
		await tx.delete(userTable).where(eq(userTable.id, userId));
	});
});

async function signIn(page: import("@playwright/test").Page) {
	await page.goto("/en/user/login");
	await page.fill('input[name="email"]', testEmail);
	await page.fill('input[name="password"]', "Password123!");
	await Promise.all([
		page.waitForURL("**/hazardous-event"),
		page.click("#login-button"),
	]);
}

test.describe("Geoportal", () => {
	test("loads with the question bar, an honest empty state and one vocabulary", async ({
		page,
	}) => {
		await signIn(page);
		await page.goto("/en/geoportal");
		await expect(page).toHaveTitle(/Geoportal/);
		await expect(
			page.getByRole("heading", { name: "Geoportal" }),
		).toBeVisible();
		await expect(page.getByRole("button", { name: "Copy link" })).toBeVisible();
		await expect(
			page.getByText("Disaster impact", { exact: true }),
		).toBeVisible();
		await expect(
			page.getByText("Nothing is published for this view yet"),
		).toBeVisible();
		await expect(page.locator("body")).not.toContainText(
			/disaster records?\b/i,
		);
	});

	test("reaches the dimension buttons by keyboard", async ({ page }) => {
		await signIn(page);
		await page.goto("/en/geoportal");
		const dim = page.getByRole("radio", { name: "Disaster events" });
		await dim.focus();
		await page.keyboard.press("Enter");
		await expect(page).toHaveURL(/dim=disaster_event/);
	});

	test("fits a phone screen without sideways scrolling", async ({ page }) => {
		await page.setViewportSize({ width: 375, height: 812 });
		await signIn(page);
		await page.goto("/en/geoportal");
		await expect(page.getByRole("button", { name: /Filters/ })).toBeVisible();
		const widths = await page.evaluate(() => ({
			scroll: document.documentElement.scrollWidth,
			client: document.documentElement.clientWidth,
		}));
		expect(widths.scroll).toBeLessThanOrEqual(widths.client);
	});
});
