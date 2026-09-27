import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { dr } from "~/db.server";
import {
	createTestIds,
	createTestUser,
	cleanupTestUser,
	createOtherTenant,
	cleanupOtherTenant,
} from "../test-helpers";
import { refreshGeoReadModel } from "~/backend.server/models/geo/refresh";
import {
	getBoundaries,
	getChoropleth,
	getDivisionTile,
	getHazardTree,
	getPlaceDossier,
	GeoRefusalError,
	parseGeoQuery,
	type GeoQuery,
} from "~/backend.server/models/geo/queries";

// Geoportal read model and G1, T1, G2, G3, G6 (build spec s9, increment G1).
// Fixture, tenant A:
//   R1 (level 1, 0..10 x 0..10) > D1 (level 2, national id) and D2 (level 2,
//   import id only); R2 (level 1, 20..30), with no children.
// Tenant B: RB (level 1, 40..50), one record. Nothing of B may reach A.

const ids = createTestIds();
ids.userEmail = ids.userEmail.replace("@", "-georeadmodel@");
let tenantB = "";

const div = {
	r1: randomUUID(),
	d1: randomUUID(),
	d2: randomUUID(),
	r2: randomUUID(),
	rb: randomUUID(),
};
const rec = {
	r1: randomUUID(), // D1, deaths 5, 2020
	r2: randomUUID(), // D1, deaths not reported, injured confirmed 0, 2020
	r3: randomUUID(), // D2, deaths confirmed 0, injured explicit No, 2021
	r4: randomUUID(), // D2, deaths not reported, 2021
	r5: randomUUID(), // no link, point in D2 (ATT-A, GEO-P), deaths 3, 2019
	r6: randomUUID(), // no link, no geometry, deaths 2, 2020
	r7: randomUUID(), // D1, undated, deaths 1
	r8: randomUUID(), // D1, draft, deaths 100: excluded by the approval basis
	r9: randomUUID(), // R2 only (level 1), not reported, 2018
	r10: randomUUID(), // D1 and D2, deaths 4, 2020
	r11: randomUUID(), // D1, deaths 2, affected_direct 10 flagged on damnificados, 2020
	rb: randomUUID(), // tenant B, RB, deaths 50
};

async function insertDivision(
	id: string,
	tenant: string,
	parent: string | null,
	level: number,
	env: string,
	nationalId: string | null,
	importId: string,
) {
	await dr.execute(sql`
		INSERT INTO division (id, parent_id, country_accounts_id, name, level, national_id, import_id, geom, bbox)
		VALUES (${id}, ${parent}, ${tenant}, ${JSON.stringify({ en: `Div ${importId}` })}::jsonb, ${level},
			${nationalId}, ${importId},
			${sql.raw(`ST_MakeEnvelope(${env}, 4326)`)}, ${sql.raw(`ST_MakeEnvelope(${env}, 4326)`)})
	`);
}

async function insertRecord(
	id: string,
	tenant: string,
	opts: {
		status?: string;
		start?: string;
		hipTypeId?: string | null;
		legacy?: unknown;
	} = {},
) {
	await dr.execute(sql`
		INSERT INTO disaster_records (id, country_accounts_id, "approvalStatus", start_date, hip_type_id, legacy_data)
		VALUES (${id}, ${tenant}, ${opts.status ?? "published"}, ${opts.start ?? ""},
			${opts.hipTypeId ?? null}, ${opts.legacy ? JSON.stringify(opts.legacy) : null}::jsonb)
	`);
}

async function presence(
	recordId: string,
	values: {
		deaths?: [boolean | null, number | null];
		injured?: [boolean | null, number | null];
		affected_direct?: [boolean | null, number | null];
	},
) {
	const [df, dt] = values.deaths ?? [null, null];
	const [inf, int] = values.injured ?? [null, null];
	const [af, at] = values.affected_direct ?? [null, null];
	await dr.execute(sql`
		INSERT INTO human_category_presence (record_id, deaths, deaths_total, injured, injured_total, affected_direct, affected_direct_total)
		VALUES (${recordId}, ${df}, ${dt}, ${inf}, ${int}, ${af}, ${at})
	`);
}

async function link(recordId: string, divisionId: string) {
	await dr.execute(sql`
		INSERT INTO disaster_records_division (disaster_record_id, division_id)
		VALUES (${recordId}, ${divisionId})
	`);
}

async function cleanupTenant(tenant: string) {
	await dr.execute(sql`DELETE FROM geo.impact_atom WHERE country_accounts_id = ${tenant}`);
	await dr.execute(sql`DELETE FROM geo.division_ancestor WHERE country_accounts_id = ${tenant}`);
	await dr.execute(sql`DELETE FROM geo.division_geom_cache WHERE country_accounts_id = ${tenant}`);
	await dr.execute(sql`DELETE FROM geo.refresh_log WHERE country_accounts_id = ${tenant}`);
	await dr.execute(sql`
		DELETE FROM human_category_presence WHERE record_id IN (
			SELECT id FROM disaster_records WHERE country_accounts_id = ${tenant})
	`);
	await dr.execute(sql`DELETE FROM disaster_records WHERE country_accounts_id = ${tenant}`);
	await dr.execute(sql`DELETE FROM division WHERE country_accounts_id = ${tenant} AND level = 2`);
	await dr.execute(sql`DELETE FROM division WHERE country_accounts_id = ${tenant}`);
}

const q = (params: Record<string, string>): GeoQuery =>
	parseGeoQuery(new URLSearchParams(params), {
		requireMeasure: true,
		requireLevel: true,
	});

function cellOf<T extends { divisionId: string }>(cells: T[], id: string) {
	const c = cells.find((x) => x.divisionId === id);
	if (!c) throw new Error(`no cell for ${id}`);
	return c;
}

let hipTypeId = "";

describe("geoportal read model (G1)", () => {
	beforeAll(async () => {
		await createTestUser(ids);
		tenantB = await createOtherTenant();
		const a = ids.countryAccountId;
		await cleanupTenant(a);

		hipTypeId = String(
			((await dr.execute(sql`SELECT id FROM hip_class ORDER BY id LIMIT 1`)).rows[0] as { id: string }).id,
		);

		await insertDivision(div.r1, a, null, 1, "0, 0, 10, 10", "R1", "r1");
		await insertDivision(div.r2, a, null, 1, "20, 0, 30, 10", "R2", "r2");
		await insertDivision(div.d1, a, div.r1, 2, "0, 0, 5, 5", "D1", "d1");
		await insertDivision(div.d2, a, div.r1, 2, "5, 0, 10, 5", null, "d2");
		await insertDivision(div.rb, tenantB, null, 1, "40, 0, 50, 10", "RB", "rb");

		await insertRecord(rec.r1, a, { start: "2020-03-01", hipTypeId });
		await insertRecord(rec.r2, a, { start: "2020" });
		await insertRecord(rec.r3, a, { start: "2021-06" });
		await insertRecord(rec.r4, a, { start: "2021" });
		await insertRecord(rec.r5, a, { start: "2019" });
		await insertRecord(rec.r6, a, { start: "2020" });
		await insertRecord(rec.r7, a, { start: "" });
		await insertRecord(rec.r8, a, { start: "2020", status: "draft" });
		await insertRecord(rec.r9, a, { start: "2018" });
		await insertRecord(rec.r10, a, { start: "2020" });
		await insertRecord(rec.r11, a, {
			start: "2020",
			legacy: {
				migration: {
					run_id: "run-test-1",
					plausibility_flags: [
						{ code: "IMPLAUSIBLE_MAGNITUDE", fields: ["damnificados"], rule_version: "1", note: "" },
					],
				},
			},
		});
		await insertRecord(rec.rb, tenantB, { start: "2020" });

		await presence(rec.r1, { deaths: [true, 5] });
		await presence(rec.r2, { injured: [true, 0] });
		await presence(rec.r3, { deaths: [true, 0], injured: [false, null] });
		await presence(rec.r5, { deaths: [true, 3] });
		await presence(rec.r6, { deaths: [true, 2] });
		await presence(rec.r7, { deaths: [true, 1] });
		await presence(rec.r8, { deaths: [true, 100] });
		await presence(rec.r10, { deaths: [true, 4] });
		await presence(rec.r11, { deaths: [true, 2], affected_direct: [true, 10] });
		await presence(rec.rb, { deaths: [true, 50] });

		for (const [r, d] of [
			[rec.r1, div.d1],
			[rec.r2, div.d1],
			[rec.r3, div.d2],
			[rec.r4, div.d2],
			[rec.r7, div.d1],
			[rec.r8, div.d1],
			[rec.r9, div.r2],
			[rec.r10, div.d1],
			[rec.r10, div.d2],
			[rec.r11, div.d1],
			[rec.rb, div.rb],
		]) {
			await link(r, d);
		}
		await dr.execute(sql`
			INSERT INTO disaster_records_geom (disaster_record_id, geom)
			VALUES (${rec.r5}, ST_SetSRID(ST_MakePoint(7, 2), 4326))
		`);

		await refreshGeoReadModel(a);
		await refreshGeoReadModel(tenantB);
	});

	afterAll(async () => {
		await cleanupTenant(ids.countryAccountId);
		await cleanupTenant(tenantB);
		await cleanupOtherTenant();
		await cleanupTestUser(ids);
	});

	describe("schema", () => {
		it("has every hand-written index", async () => {
			const res = await dr.execute(sql`
				SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'geo'
			`);
			const byName = new Map(
				(res.rows as { indexname: string; indexdef: string }[]).map((r) => [
					r.indexname,
					r.indexdef,
				]),
			);
			for (const gist of [
				"geo_dgc_bbox_idx",
				"geo_dgc_z4_idx",
				"geo_dgc_z8_idx",
				"geo_dgc_z12_idx",
			]) {
				expect(byName.get(gist)).toMatch(/USING gist/i);
			}
			for (const btree of [
				"geo_dgc_tenant_level_idx",
				"geo_da_ancestor_idx",
				"geo_da_level_idx",
				"geo_atom_tenant_measure_idx",
				"geo_atom_tenant_start_idx",
				"geo_atom_tenant_hip_idx",
				"geo_atom_record_idx",
			]) {
				expect(byName.has(btree)).toBe(true);
			}
		});

		it("rejects a not-reported atom that carries a value", async () => {
			await expect(
				dr.execute(sql`
					INSERT INTO geo.impact_atom (country_accounts_id, disaster_record_id, division_id, att_grade,
						measure, value, value_state, record_status, method_version)
					VALUES (${ids.countryAccountId}, ${rec.r1}, ${div.d1}, 'B', 'deaths', 0, 'not_reported', 'published', 'test')
				`),
			).rejects.toThrow();
		});

		it("normalises date text to a floor and a ceiling", async () => {
			const res = await dr.execute(sql`
				SELECT geo.date_floor('2015') AS f, geo.date_ceil('2015') AS c,
					geo.date_ceil('2016-02') AS m, geo.date_floor('n/a') AS bad
			`);
			const r = res.rows[0] as Record<string, string | Date | null>;
			expect(new Date(r.f as string).toISOString().slice(0, 10)).toBe("2015-01-01");
			expect(new Date(r.c as string).toISOString().slice(0, 10)).toBe("2015-12-31");
			expect(new Date(r.m as string).toISOString().slice(0, 10)).toBe("2016-02-29");
			expect(r.bad).toBeNull();
		});
	});

	describe("G2 choropleth", () => {
		it("places records by ancestor and keeps null apart from zero", async () => {
			const body = await getChoropleth(
				ids.countryAccountId,
				q({ measure: "deaths", level: "1" }),
			);
			const r1 = cellOf(body.cells, div.r1);
			// r1 5, r5 3, r7 1, r10 4 (once), r11 2; r2 r3 r4 in scope.
			expect(r1.value).toBe(15);
			expect(r1.valueState).toBe("reported");
			expect(r1.recordsTotal).toBe(8);
			expect(r1.recordsReported).toBe(5);
			expect(r1.recordsZeroConfirmed).toBe(1);
			expect(r1.recordsNotReported).toBe(2);

			const r2 = cellOf(body.cells, div.r2);
			expect(r2.value).toBeNull();
			expect(r2.valueState).toBe("not_reported");
		});

		it("excludes draft records and never shows another tenant", async () => {
			const body = await getChoropleth(
				ids.countryAccountId,
				q({ measure: "deaths", level: "1" }),
			);
			expect(body.cells.map((c) => c.divisionId)).not.toContain(div.rb);
			expect(body.meta.approvalBasis).toEqual(["published"]);
			const total = body.cells.reduce((s, c) => s + (c.value ?? 0), 0);
			expect(total).toBe(15); // r8 (draft, 100) and rb (tenant B, 50) absent
		});

		it("counts unplaced records with their reason, never dropping them", async () => {
			const lvl2 = await getChoropleth(
				ids.countryAccountId,
				q({ measure: "deaths", level: "2" }),
			);
			expect(lvl2.unattributed.reasons).toEqual({
				no_division_row: 1, // r6
				coarser_than_level: 1, // r9 is linked to R2 only
			});
			const d1 = cellOf(lvl2.cells, div.d1);
			const d2 = cellOf(lvl2.cells, div.d2);
			expect(d1.recordsTotal).toBe(5); // r1 r2 r7 r10 r11
			expect(d2.recordsTotal).toBe(4); // r3 r4 r5 r10
			// 10 published records: each counted once, r10 in two cells, two unattributed.
			expect(d1.recordsTotal + d2.recordsTotal - lvl2.multiDivisionRecords + lvl2.unattributed.records).toBe(10);
			expect(lvl2.multiDivisionRecords).toBe(1);
			expect(lvl2.caption).toMatch(/more than one area/);
		});

		it("grades attribution: B by national id, C by import id, A by geometry", async () => {
			const lvl2 = await getChoropleth(
				ids.countryAccountId,
				q({ measure: "records", level: "2" }),
			);
			expect(cellOf(lvl2.cells, div.d1).gradeDistribution).toEqual({ A: 0, B: 5, C: 0, D: 0 });
			// D2: r3 r4 r10 through the import-id link (C), r5 by its point (A).
			expect(cellOf(lvl2.cells, div.d2).gradeDistribution).toEqual({ A: 1, B: 0, C: 3, D: 0 });
			expect(cellOf(lvl2.cells, div.d2).geoPrecision).toEqual({ L2: 3, P: 1 });

			const onlyB = await getChoropleth(
				ids.countryAccountId,
				q({ measure: "records", level: "2", minAttGrade: "B" }),
			);
			expect(cellOf(onlyB.cells, div.d2).recordsTotal).toBe(1); // r5 (A) only
			expect(onlyB.excludedByGrade).toBe(3);
		});

		it("reports undated records as unattributed when a range is set", async () => {
			const body = await getChoropleth(
				ids.countryAccountId,
				q({ measure: "deaths", level: "2", from: "2020", to: "2020" }),
			);
			expect(body.unattributed.reasons).toEqual({ no_division_row: 1, undated: 1 });
			expect(cellOf(body.cells, div.d1).value).toBe(11); // r1 5, r10 4, r11 2
			expect(cellOf(body.cells, div.d2).value).toBe(4); // r10
		});

		it("earns a confirmed zero only with enough coverage (V-5)", async () => {
			const body = await getChoropleth(
				ids.countryAccountId,
				q({ measure: "injured", level: "2" }),
			);
			// D2: r3's explicit No is 1 of 4 records (25%): confirmed zero.
			const d2 = cellOf(body.cells, div.d2);
			expect(d2.valueState).toBe("zero_confirmed");
			expect(d2.value).toBe(0);
			// D1: r2's stored 0 is 1 of 5 records (20%): not enough.
			const d1 = cellOf(body.cells, div.d1);
			expect(d1.valueState).toBe("insufficient_reporting");
			expect(d1.value).toBeNull();
		});

		it("flags only the measures a plausibility flag concerns (C30)", async () => {
			const affected = await getChoropleth(
				ids.countryAccountId,
				q({ measure: "affected_direct", level: "2" }),
			);
			expect(cellOf(affected.cells, div.d1).plausibilityFlaggedRecords).toBe(1);
			const deaths = await getChoropleth(
				ids.countryAccountId,
				q({ measure: "deaths", level: "2" }),
			);
			expect(cellOf(deaths.cells, div.d1).plausibilityFlaggedRecords).toBe(0);
			expect(affected.meta.migrationRunIds).toEqual(["run-test-1"]);
		});

		it("refuses a level finer than the instance holds", async () => {
			await expect(
				getChoropleth(ids.countryAccountId, q({ measure: "deaths", level: "3" })),
			).rejects.toMatchObject({ code: "PRECISION_BELOW_CEILING", status: 200 });
		});
	});

	describe("request refusals", () => {
		const refusal = (params: Record<string, string>) => {
			try {
				q(params);
			} catch (e) {
				return e as GeoRefusalError;
			}
			throw new Error("expected a refusal");
		};

		it("refuses money, several measures, ATT-D and other modes", () => {
			expect(refusal({ measure: "losses", level: "1" }).code).toBe("MONETARY_CONVENTIONS_PENDING");
			expect(refusal({ measure: "deaths,injured", level: "1" }).code).toBe("MULTI_SERIES_CHOROPLETH");
			expect(refusal({ measure: "deaths", level: "1", minAttGrade: "D" }).code).toBe("ATT_D_EXCLUDED_FROM_OFFICIAL");
			expect(refusal({ measure: "deaths", level: "1", mode: "restated" }).code).toBe("CROSS_VERSION_AGGREGATION_REFUSED");
			expect(refusal({ measure: "losses", level: "1" }).status).toBe(200);
		});

		it("returns 400 for malformed input", () => {
			const e = refusal({ measure: "deaths", level: "x" });
			expect(e.code).toBe("MALFORMED_REQUEST");
			expect(e.status).toBe(400);
			expect(refusal({ measure: "unknown", level: "1" }).status).toBe(400);
			expect(refusal({ measure: "deaths", level: "1", from: "2020/01" }).status).toBe(400);
		});
	});

	describe("G1 boundaries and T1 tiles", () => {
		it("returns only the tenant's divisions at the level", async () => {
			const fc = (await getBoundaries(ids.countryAccountId, { level: 1, lang: "en" })) as {
				features: { properties: { divisionId: string } }[];
				boundaryVersion: string;
			};
			expect(fc.features.map((f) => f.properties.divisionId).sort()).toEqual([div.r1, div.r2].sort());
			expect(fc.boundaryVersion).toBe("unknown");
		});

		it("filters by bbox", async () => {
			const fc = (await getBoundaries(ids.countryAccountId, {
				level: 1,
				bbox: [19, -1, 31, 11],
				lang: "en",
			})) as { features: { properties: { divisionId: string } }[] };
			expect(fc.features.map((f) => f.properties.divisionId)).toEqual([div.r2]);
		});

		it("serves a tile with the tenant's divisions and nothing of another tenant", async () => {
			// z5 x19 y15 covers lon 33.75 to 45, lat 0 to 11.2: only tenant B's RB.
			const forA = await getDivisionTile(ids.countryAccountId, 1, 5, 19, 15, "en");
			const forB = await getDivisionTile(tenantB, 1, 5, 19, 15, "en");
			expect(forA.length).toBe(0);
			expect(forB.length).toBeGreaterThan(0);
			// z3 x4 y3 covers lon 0 to 45, lat 0 to 41: tenant A's R1.
			expect((await getDivisionTile(ids.countryAccountId, 1, 3, 4, 3, "en")).length).toBeGreaterThan(0);
		});
	});

	describe("G3 place dossier", () => {
		it("summarises a division and its descendants", async () => {
			const d = await getPlaceDossier(
				ids.countryAccountId,
				div.r1,
				parseGeoQuery(new URLSearchParams(), { requireMeasure: false, requireLevel: false }),
				"en",
			);
			expect(d).not.toBeNull();
			expect(d!.recurrence.recordCount).toBe(8);
			expect(d!.recurrence.undatedRecordCount).toBe(1); // r7
			expect(d!.byYear).toEqual([
				{ year: 2019, recordCount: 1 },
				{ year: 2020, recordCount: 4 },
				{ year: 2021, recordCount: 2 },
			]);
			expect(d!.cumulative.deaths.value).toBe(15);
			expect(d!.cumulative.deaths.valueState).toBe("reported");
			expect(d!.hazardMix).toContainEqual({ hipTypeId, recordCount: 1 });
		});

		it("shows a measure no record reported as null, not zero", async () => {
			const d = await getPlaceDossier(
				ids.countryAccountId,
				div.r2,
				parseGeoQuery(new URLSearchParams(), { requireMeasure: false, requireLevel: false }),
				"en",
			);
			expect(d!.recurrence.recordCount).toBe(1);
			expect(d!.cumulative.deaths.valueState).toBe("not_reported");
			expect(d!.cumulative.deaths.value).toBeNull();
		});

		it("does not reveal another tenant's division", async () => {
			const d = await getPlaceDossier(
				ids.countryAccountId,
				div.rb,
				parseGeoQuery(new URLSearchParams(), { requireMeasure: false, requireLevel: false }),
				"en",
			);
			expect(d).toBeNull();
		});
	});

	describe("G6 hazard tree", () => {
		it("counts the tenant's published records under their type", async () => {
			const tree = await getHazardTree(ids.countryAccountId, "en");
			const t = tree.types.find((x) => x.id === hipTypeId)!;
			expect(t.recordCountSubtree).toBe(1);
			expect(t.recordCountSelf).toBe(1);
			expect(tree.unclassifiedRecordCount).toBe(9);
			expect(tree.types.length).toBe(8);
		});
	});
});
