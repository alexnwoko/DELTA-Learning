import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { dr } from "~/db.server";
import { createTestBackendContext } from "~/backend.server/context";
import {
	createTestIds,
	createTestUser,
	cleanupTestUser,
} from "../test-helpers";
import {
	defsForTable,
	getTotalDsgTable,
	setTotalPresenceTable,
} from "~/backend.server/models/human_effects";

// R-1 (Angola read-side reconciliation): an unreported affected sub-measure
// was copied into human_category_presence as 0, which reads as a confirmed
// zero. It must stay NULL.

const ids = createTestIds();
ids.userEmail = ids.userEmail.replace("@", "-totals@");
const recordId = randomUUID();
const dsgId = randomUUID();
// Displaced split only by timing and duration, beside its total row.
const splitRecordId = randomUUID();
const splitDsgIds = [randomUUID(), randomUUID(), randomUUID()];

describe("human-effect presence totals keep NULL", () => {
	beforeAll(async () => {
		await createTestUser(ids);
		await dr.execute(sql`
			INSERT INTO disaster_records (id, country_accounts_id, "approvalStatus")
			VALUES (${recordId}, ${ids.countryAccountId}, 'draft')
		`);
		await dr.execute(sql`
			INSERT INTO human_dsg (id, record_id) VALUES (${dsgId}, ${recordId})
		`);
		await dr.execute(sql`
			INSERT INTO affected (dsg_id, direct, indirect) VALUES (${dsgId}, NULL, 5)
		`);
		await dr.execute(sql`
			INSERT INTO disaster_records (id, country_accounts_id, "approvalStatus")
			VALUES (${splitRecordId}, ${ids.countryAccountId}, 'draft')
		`);
		const [totalId, evacId, relocId] = splitDsgIds;
		for (const id of splitDsgIds) {
			await dr.execute(sql`
				INSERT INTO human_dsg (id, record_id) VALUES (${id}, ${splitRecordId})
			`);
		}
		await dr.execute(sql`
			INSERT INTO displaced (dsg_id, displaced) VALUES (${totalId}, 27)
		`);
		await dr.execute(sql`
			INSERT INTO displaced (dsg_id, displaced, timing)
			VALUES (${evacId}, 27, 'pre-emptive')
		`);
		await dr.execute(sql`
			INSERT INTO displaced (dsg_id, displaced, timing, duration)
			VALUES (${relocId}, 27, 'reactive', 'permanent')
		`);
	});

	afterAll(async () => {
		await dr.execute(sql`DELETE FROM affected WHERE dsg_id = ${dsgId}`);
		await dr.execute(sql`
			DELETE FROM displaced WHERE dsg_id IN (
				SELECT id FROM human_dsg WHERE record_id = ${splitRecordId})
		`);
		await dr.execute(
			sql`DELETE FROM human_dsg WHERE record_id = ${splitRecordId}`,
		);
		await dr.execute(
			sql`DELETE FROM human_category_presence WHERE record_id = ${splitRecordId}`,
		);
		await dr.execute(
			sql`DELETE FROM disaster_records WHERE id = ${splitRecordId}`,
		);
		await dr.execute(sql`DELETE FROM human_dsg WHERE id = ${dsgId}`);
		await dr.execute(
			sql`DELETE FROM human_category_presence WHERE record_id = ${recordId}`,
		);
		await dr.execute(sql`DELETE FROM disaster_records WHERE id = ${recordId}`);
		await cleanupTestUser(ids);
	});

	it("returns null, not 0, for an unreported sub-measure", async () => {
		const defs = await defsForTable(
			createTestBackendContext(),
			dr,
			"Affected",
			ids.countryAccountId,
		);
		const totals = await getTotalDsgTable(
			dr as any,
			"Affected",
			recordId,
			defs,
		);
		expect(totals).toEqual({ direct: null, indirect: 5 });

		await setTotalPresenceTable(dr as any, "Affected", recordId, defs, totals);
		const res = await dr.execute(sql`
			SELECT affected_direct_total, affected_indirect_total
			FROM human_category_presence WHERE record_id = ${recordId}
		`);
		expect(res.rows[0].affected_direct_total).toBeNull();
		expect(Number(res.rows[0].affected_indirect_total)).toBe(5);
	});

	it("reads the total row of a record split only by timing and duration", async () => {
		const defs = await defsForTable(
			createTestBackendContext(),
			dr,
			"Displaced",
			ids.countryAccountId,
		);
		// 27 evacuated and 27 relocated: the total is the all-empty row, 27,
		// never the 54 of adding the typed rows.
		const totals = await getTotalDsgTable(
			dr as any,
			"Displaced",
			splitRecordId,
			defs,
		);
		expect(totals).toEqual({ displaced: 27 });
	});
});
