import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { dr } from "~/db.server";
import {
	createTestIds,
	createTestUser,
	cleanupTestUser,
} from "../test-helpers";
import { refreshGeoReadModel } from "~/backend.server/models/geo/refresh";

// Contract O-2 (Alex, 2026-10-16): displaced_total holds evacuated plus
// relocated; the geoportal's Displaced measure uses the same expression as
// the analytics headline (displacedHeadlineSql), so evacuated and relocated
// people are never added together, and nothing reported is never a zero.

const ids = createTestIds();
ids.userEmail = ids.userEmail.replace("@", "-geodisplaced@");
const rec = {
	disjoint: randomUUID(), // 109 evacuated, 2,000 relocated after the event
	identical: randomUUID(), // the same 27 evacuated, then relocated: one row
	totalOnly: randomUUID(), // a total of 50, no timing or duration
	crossTab: randomUUID(), // 30 relocated after; a sex-split row is another group
	relocatedOnly: randomUUID(), // only 80 relocated after the event reported
	zeroEvacuated: randomUUID(), // evacuated confirmed 0, plus 60 relocated after
};

async function displacedRow(
	recordId: string,
	value: number,
	timing: string | null,
	duration: string | null,
	sex: string | null = null,
) {
	const id = randomUUID();
	await dr.execute(sql`
		INSERT INTO human_dsg (id, record_id, sex) VALUES (${id}, ${recordId}, ${sex})
	`);
	await dr.execute(sql`
		INSERT INTO displaced (dsg_id, displaced, timing, duration)
		VALUES (${id}, ${value}, ${timing}, ${duration})
	`);
}

async function atom(recordId: string) {
	const res = await dr.execute(sql`
		SELECT DISTINCT value, value_state FROM geo.impact_atom
		WHERE disaster_record_id = ${recordId} AND measure = 'displaced'
	`);
	const rows = res.rows as { value: string | null; value_state: string }[];
	expect(rows).toHaveLength(1);
	return {
		value: rows[0].value === null ? null : Number(rows[0].value),
		state: rows[0].value_state,
	};
}

describe("geo read model: displaced leaves out people relocated after the event", () => {
	beforeAll(async () => {
		await createTestUser(ids);
		const totals: [string, number][] = [
			[rec.disjoint, 2109],
			[rec.identical, 27],
			[rec.totalOnly, 50],
			[rec.crossTab, 40],
			[rec.relocatedOnly, 80],
			[rec.zeroEvacuated, 60],
		];
		for (const [id, total] of totals) {
			await dr.execute(sql`
				INSERT INTO disaster_records (id, country_accounts_id, "approvalStatus", start_date)
				VALUES (${id}, ${ids.countryAccountId}, 'published', '2020')
			`);
			await dr.execute(sql`
				INSERT INTO human_category_presence (record_id, displaced, displaced_total)
				VALUES (${id}, true, ${total})
			`);
		}
		await displacedRow(rec.disjoint, 2109, null, null);
		await displacedRow(rec.disjoint, 109, "pre-emptive", null);
		await displacedRow(rec.disjoint, 2000, "reactive", "permanent");
		await displacedRow(rec.identical, 27, null, null);
		await displacedRow(rec.identical, 27, "pre-emptive", "permanent");
		await displacedRow(rec.totalOnly, 50, null, null);
		await displacedRow(rec.crossTab, 40, null, null);
		await displacedRow(rec.crossTab, 30, "reactive", "permanent");
		await displacedRow(rec.crossTab, 12, "reactive", "permanent", "m");
		await displacedRow(rec.relocatedOnly, 80, null, null);
		await displacedRow(rec.relocatedOnly, 80, "reactive", "permanent");
		await displacedRow(rec.zeroEvacuated, 60, null, null);
		await displacedRow(rec.zeroEvacuated, 0, "pre-emptive", null);
		await displacedRow(rec.zeroEvacuated, 60, "reactive", "permanent");
		await refreshGeoReadModel(ids.countryAccountId);
	});

	afterAll(async () => {
		const all = sql.join(Object.values(rec), sql`, `);
		await dr.execute(
			sql`DELETE FROM geo.impact_atom WHERE country_accounts_id = ${ids.countryAccountId}`,
		);
		await dr.execute(
			sql`DELETE FROM geo.refresh_log WHERE country_accounts_id = ${ids.countryAccountId}`,
		);
		await dr.execute(sql`
			DELETE FROM displaced WHERE dsg_id IN (
				SELECT id FROM human_dsg WHERE record_id IN (${all}))
		`);
		await dr.execute(sql`DELETE FROM human_dsg WHERE record_id IN (${all})`);
		await dr.execute(
			sql`DELETE FROM human_category_presence WHERE record_id IN (${all})`,
		);
		await dr.execute(
			sql`DELETE FROM disaster_records WHERE country_accounts_id = ${ids.countryAccountId}`,
		);
		await cleanupTestUser(ids);
	});

	it("subtracts only the relocated-after-the-event rows of the record", async () => {
		expect(await atom(rec.disjoint)).toEqual({ value: 109, state: "reported" });
		expect(await atom(rec.identical)).toEqual({ value: 27, state: "reported" });
		expect(await atom(rec.totalOnly)).toEqual({ value: 50, state: "reported" });
		expect(await atom(rec.crossTab)).toEqual({ value: 10, state: "reported" });
	});

	it("never turns a record that reports only relocated people into a confirmed zero", async () => {
		const a = await atom(rec.relocatedOnly);
		expect(a.state).not.toBe("zero_confirmed");
		expect(a.value).toBeNull();
	});

	it("keeps a confirmed zero of evacuated people as a confirmed zero", async () => {
		expect(await atom(rec.zeroEvacuated)).toEqual({
			value: 0,
			state: "zero_confirmed",
		});
	});
});
