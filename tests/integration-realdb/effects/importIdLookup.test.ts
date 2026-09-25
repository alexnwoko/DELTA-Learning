import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { dr } from "~/db.server";
import {
	createTestIds,
	createTestUser,
	cleanupTestUser,
} from "../test-helpers";
import { damagesIdByImportIdAndCountryAccountsId } from "~/backend.server/models/damages";
import { lossesIdByImportIdAndCountryAccountsId } from "~/backend.server/models/losses";
import { disruptionIdByImportIdAndCountryAccountsId } from "~/backend.server/models/disruption";

// The import-id lookups behind damage, loss and disruption upserts joined the
// effect's sector_id to disaster_records.id, so they never found an existing
// row: every upsert inserted a duplicate (Angola pilot damage 319 -> 638).

const ids = createTestIds();
ids.userEmail = ids.userEmail.replace("@", "-importid@");
const recordId = randomUUID();
const importId = `test-import-${randomUUID()}`;
const rowIds = {
	damage: randomUUID(),
	loss: randomUUID(),
	disruption: randomUUID(),
};

describe("effect import-id lookups", () => {
	beforeAll(async () => {
		await createTestUser(ids);
		const sector = await dr.execute(sql`SELECT id FROM sector LIMIT 1`);
		const sectorId = String(sector.rows[0].id);
		const asset = await dr.execute(sql`
			INSERT INTO asset (country_accounts_id, sector_ids, is_built_in, custom_name)
			VALUES (${ids.countryAccountId}, ${sectorId}, false, 'Test asset')
			RETURNING id
		`);
		const assetId = String(asset.rows[0].id);
		await dr.execute(sql`
			INSERT INTO disaster_records (id, country_accounts_id, "approvalStatus")
			VALUES (${recordId}, ${ids.countryAccountId}, 'draft')
		`);
		await dr.execute(sql`
			INSERT INTO damages (id, record_id, sector_id, asset_id, api_import_id)
			VALUES (${rowIds.damage}, ${recordId}, ${sectorId}, ${assetId}, ${importId})
		`);
		await dr.execute(sql`
			INSERT INTO losses (id, record_id, sector_id, sector_is_agriculture, api_import_id)
			VALUES (${rowIds.loss}, ${recordId}, ${sectorId}, false, ${importId})
		`);
		await dr.execute(sql`
			INSERT INTO disruption (id, record_id, sector_id, api_import_id)
			VALUES (${rowIds.disruption}, ${recordId}, ${sectorId}, ${importId})
		`);
	});

	afterAll(async () => {
		await dr.execute(sql`DELETE FROM damages WHERE record_id = ${recordId}`);
		await dr.execute(sql`DELETE FROM losses WHERE record_id = ${recordId}`);
		await dr.execute(sql`DELETE FROM disruption WHERE record_id = ${recordId}`);
		await dr.execute(sql`DELETE FROM disaster_records WHERE id = ${recordId}`);
		await dr.execute(
			sql`DELETE FROM asset WHERE country_accounts_id = ${ids.countryAccountId}`,
		);
		await cleanupTestUser(ids);
	});

	it.each([
		["damage", damagesIdByImportIdAndCountryAccountsId],
		["loss", lossesIdByImportIdAndCountryAccountsId],
		["disruption", disruptionIdByImportIdAndCountryAccountsId],
	] as const)("%s: finds the row for its own tenant only", async (kind, fn) => {
		expect(await fn(dr as any, importId, ids.countryAccountId)).toBe(
			rowIds[kind],
		);
		expect(await fn(dr as any, importId, randomUUID())).toBeNull();
	});
});
