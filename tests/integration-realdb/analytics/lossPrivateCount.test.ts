import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { dr } from "~/db.server";
import {
	createTestIds,
	createTestUser,
	cleanupTestUser,
} from "../test-helpers";
import { getGeographicImpact } from "~/backend.server/models/analytics/geographicImpact";

// The sectors map summed a loss row's private cost twice: the public part,
// when not an override, added units x unit cost and also private_cost_total,
// then the private part added the private cost again. A row with public
// 2 x 10 and a private override of 5 read 30, not 25.

const t = createTestIds();
t.userEmail = t.userEmail.replace("@", "-losspriv@");
const ids = {
	division: randomUUID(),
	event: randomUUID(),
	hazardous: randomUUID(),
	record: randomUUID(),
};
let sectorId = "";

describe("loss arithmetic on the sectors map", () => {
	beforeAll(async () => {
		await createTestUser(t);
		const hip = await dr.execute(sql`SELECT id FROM hip_class LIMIT 1`);
		const hipType = String(hip.rows[0].id);
		const sector = await dr.execute(sql`SELECT id FROM sector LIMIT 1`);
		sectorId = String(sector.rows[0].id);
		await dr.execute(sql`
			INSERT INTO division (id, country_accounts_id, name, level)
			VALUES (${ids.division}, ${t.countryAccountId}, '{"en":"D"}'::jsonb, 1)
		`);
		await dr.execute(
			sql`INSERT INTO event (id) VALUES (${ids.hazardous}), (${ids.event})`,
		);
		await dr.execute(sql`
			INSERT INTO hazardous_event (id, country_accounts_id, "approvalStatus", hip_type_id)
			VALUES (${ids.hazardous}, ${t.countryAccountId}, 'published', ${hipType})
		`);
		await dr.execute(sql`
			INSERT INTO disaster_event (id, country_accounts_id, "approvalStatus", hazardous_event_id)
			VALUES (${ids.event}, ${t.countryAccountId}, 'published', ${ids.hazardous})
		`);
		await dr.execute(sql`
			INSERT INTO disaster_records (id, country_accounts_id, "approvalStatus", disaster_event_id, hip_type_id, start_date, end_date)
			VALUES (${ids.record}, ${t.countryAccountId}, 'published', ${ids.event}, ${hipType}, '2020-05-01', '2020-05-10')
		`);
		await dr.execute(sql`
			INSERT INTO disaster_records_division (disaster_record_id, division_id)
			VALUES (${ids.record}, ${ids.division})
		`);
		// Sector flags losses but gives no sector-level cost, so the loss
		// rows are read.
		await dr.execute(sql`
			INSERT INTO sector_disaster_records_relation (sector_id, disaster_record_id, with_damage, damage_cost, with_losses, losses_cost)
			VALUES (${sectorId}, ${ids.record}, false, NULL, true, NULL)
		`);
		await dr.execute(sql`
			INSERT INTO losses (record_id, sector_id, sector_is_agriculture,
				public_units, public_cost_unit, public_cost_total_override,
				private_cost_total, private_cost_total_override)
			VALUES (${ids.record}, ${sectorId}, false, 2, 10, false, 5, true)
		`);
	});

	afterAll(async () => {
		await dr.execute(sql`DELETE FROM losses WHERE record_id = ${ids.record}`);
		await dr.execute(
			sql`DELETE FROM sector_disaster_records_relation WHERE disaster_record_id = ${ids.record}`,
		);
		await dr.execute(
			sql`DELETE FROM disaster_records_division WHERE disaster_record_id = ${ids.record}`,
		);
		await dr.execute(
			sql`DELETE FROM disaster_records WHERE id = ${ids.record}`,
		);
		await dr.execute(sql`DELETE FROM disaster_event WHERE id = ${ids.event}`);
		await dr.execute(
			sql`DELETE FROM hazardous_event WHERE id = ${ids.hazardous}`,
		);
		await dr.execute(
			sql`DELETE FROM event WHERE id IN (${ids.event}, ${ids.hazardous})`,
		);
		await dr.execute(sql`DELETE FROM division WHERE id = ${ids.division}`);
		await cleanupTestUser(t);
	});

	it("counts the private cost once: public 2 x 10 plus private 5 is 25", async () => {
		const res = await getGeographicImpact(t.countryAccountId, "public", {
			sectorId,
		});
		expect(res.success).toBe(true);
		expect(res.values[ids.division].loss).toMatchObject({
			value: 25,
			valueState: "reported",
		});
	});
});
