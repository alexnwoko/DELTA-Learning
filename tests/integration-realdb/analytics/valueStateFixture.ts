import { sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { dr } from "~/db.server";
import {
	createTestIds,
	createTestUser,
	cleanupTestUser,
} from "../test-helpers";

// Shared fixture for the value-state suites (TR-076, E17, MVP exit AC4: no
// endpoint returns 0 for not_reported). Two tenants:
//
// Tenant A
// - division divReported holds recReported (event evReported) and
//   recEmpty (event evEmpty); division divEmpty holds no record.
// - recReported: sector costs damage 100 and losses 40, a loss row with a
//   public cost of 40, deaths 5.
// - recEmpty: a sector relation with damage and losses flagged but no cost,
//   a loss row with no cost, no human-effects row. Its figures are
//   not reported and must never read 0.
// - evEmpty's hazardous event has a second hazard type, so the hazard
//   breakdown holds one reported and one not-reported row.
//
// Tenant B: recB (event evB, division divB) with damage 999, losses 555,
// deaths 9. Tenant A's figures must never include it.

export const A = createTestIds();
A.userEmail = A.userEmail.replace("@", "-vstate-a@");
export const B = createTestIds();
B.userEmail = B.userEmail.replace("@", "-vstate-b@");
B.countryId = randomUUID();

export const div = {
	reported: randomUUID(),
	empty: randomUUID(),
	b: randomUUID(),
};
export const ev = {
	reported: randomUUID(),
	empty: randomUUID(),
	b: randomUUID(),
};
const hz = { reported: randomUUID(), empty: randomUUID(), b: randomUUID() };
export const rec = {
	reported: randomUUID(),
	empty: randomUUID(),
	b: randomUUID(),
};
export const fx = { sectorId: "", hipTypeA: "", hipTypeB: "" };

const allEvents = () => [...Object.values(ev), ...Object.values(hz)];
const allRecords = () => Object.values(rec);

async function insertDivision(id: string, tenant: string) {
	await dr.execute(sql`
		INSERT INTO division (id, country_accounts_id, name, level)
		VALUES (${id}, ${tenant},
			${JSON.stringify({ en: `Division ${id.slice(0, 8)}` })}::jsonb, 1)
	`);
}

async function insertEvent(
	eventId: string,
	hazardousId: string,
	tenant: string,
	hipTypeId: string,
) {
	await dr.execute(
		sql`INSERT INTO event (id) VALUES (${hazardousId}), (${eventId})`,
	);
	await dr.execute(sql`
		INSERT INTO hazardous_event (id, country_accounts_id, "approvalStatus", hip_type_id)
		VALUES (${hazardousId}, ${tenant}, 'published', ${hipTypeId})
	`);
	await dr.execute(sql`
		INSERT INTO disaster_event (id, country_accounts_id, "approvalStatus", name_national, hazardous_event_id)
		VALUES (${eventId}, ${tenant}, 'published', ${`Value state ${eventId.slice(0, 8)}`}, ${hazardousId})
	`);
}

async function insertRecord(
	id: string,
	tenant: string,
	eventId: string,
	divisionId: string,
	hipTypeId: string,
	damageCost: number | null,
	lossesCost: number | null,
) {
	await dr.execute(sql`
		INSERT INTO disaster_records (id, country_accounts_id, "approvalStatus", disaster_event_id, hip_type_id, start_date, end_date)
		VALUES (${id}, ${tenant}, 'published', ${eventId}, ${hipTypeId}, '2020-05-01', '2020-05-10')
	`);
	await dr.execute(sql`
		INSERT INTO disaster_records_division (disaster_record_id, division_id)
		VALUES (${id}, ${divisionId})
	`);
	await dr.execute(sql`
		INSERT INTO sector_disaster_records_relation (sector_id, disaster_record_id, with_damage, damage_cost, with_losses, losses_cost)
		VALUES (${fx.sectorId}, ${id}, true, ${damageCost}, true, ${lossesCost})
	`);
}

async function cleanup() {
	const records = allRecords();
	const r = sql.join(records, sql`, `);
	await dr.execute(
		sql`DELETE FROM human_category_presence WHERE record_id IN (${r})`,
	);
	await dr.execute(sql`DELETE FROM losses WHERE record_id IN (${r})`);
	await dr.execute(
		sql`DELETE FROM sector_disaster_records_relation WHERE disaster_record_id IN (${r})`,
	);
	await dr.execute(
		sql`DELETE FROM disaster_records_division WHERE disaster_record_id IN (${r})`,
	);
	await dr.execute(sql`DELETE FROM disaster_records WHERE id IN (${r})`);
	const e = sql.join(allEvents(), sql`, `);
	await dr.execute(sql`DELETE FROM disaster_event WHERE id IN (${e})`);
	await dr.execute(sql`DELETE FROM hazardous_event WHERE id IN (${e})`);
	await dr.execute(sql`DELETE FROM event WHERE id IN (${e})`);
	await dr.execute(
		sql`DELETE FROM division WHERE id IN (${sql.join(Object.values(div), sql`, `)})`,
	);
}

export async function setupValueStateFixture() {
	await createTestUser(A);
	await createTestUser(B);
	const hips = await dr.execute(
		sql`SELECT id FROM hip_class ORDER BY id LIMIT 2`,
	);
	fx.hipTypeA = String(hips.rows[0].id);
	fx.hipTypeB = String(hips.rows[1].id);
	const sectors = await dr.execute(sql`SELECT id FROM sector LIMIT 1`);
	fx.sectorId = String(sectors.rows[0].id);

	await cleanup();
	await insertDivision(div.reported, A.countryAccountId);
	await insertDivision(div.empty, A.countryAccountId);
	await insertDivision(div.b, B.countryAccountId);

	await insertEvent(ev.reported, hz.reported, A.countryAccountId, fx.hipTypeA);
	await insertEvent(ev.empty, hz.empty, A.countryAccountId, fx.hipTypeB);
	await insertEvent(ev.b, hz.b, B.countryAccountId, fx.hipTypeA);

	await insertRecord(
		rec.reported,
		A.countryAccountId,
		ev.reported,
		div.reported,
		fx.hipTypeA,
		100,
		40,
	);
	await insertRecord(
		rec.empty,
		A.countryAccountId,
		ev.empty,
		div.reported,
		fx.hipTypeB,
		null,
		null,
	);
	await insertRecord(
		rec.b,
		B.countryAccountId,
		ev.b,
		div.b,
		fx.hipTypeA,
		999,
		555,
	);

	// Loss rows: one with a cost, one with none (never read as 0).
	await dr.execute(sql`
		INSERT INTO losses (record_id, sector_id, sector_is_agriculture, public_cost_total, public_cost_total_override)
		VALUES (${rec.reported}, ${fx.sectorId}, false, 40, true),
			(${rec.empty}, ${fx.sectorId}, false, NULL, false)
	`);

	await dr.execute(sql`
		INSERT INTO human_category_presence (record_id, deaths, deaths_total)
		VALUES (${rec.reported}, true, 5), (${rec.b}, true, 9)
	`);
}

export async function teardownValueStateFixture() {
	await cleanup();
	await cleanupTestUser(A);
	await cleanupTestUser(B);
}
