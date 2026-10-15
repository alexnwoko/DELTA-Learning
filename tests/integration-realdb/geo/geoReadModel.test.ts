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
	type GeoCell,
	type GeoRequest,
} from "~/backend.server/models/geo/queries";
import {
	GeoRefusalWithMeta,
	resolveGeoRequest,
	type GeoRequestContext,
} from "~/backend.server/handlers/geo";
import type { ApprovalAudience } from "~/utils/approvalBasis";
import { parseDeltaQuery } from "~/utils/deltaQuery";
import { HOUSING_SECTOR_ID } from "~/utils/geoMeasures";

// Geoportal read model and G1, T1, G2, G3, G6 (build spec s9, increment G1;
// PD v1.0 reflection fixes G-01 to G-17).
// Fixture, tenant A:
//   R1 (level 1, 0..10 x 0..10) > D1 (level 2, national id, 0..5) and D2
//   (level 2, import id only, 5..10); R2 (level 1, 20..30), no children.
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
	r1: randomUUID(), // D1, deaths 5, 2020-03-01, hazard type set
	r2: randomUUID(), // D1, deaths not reported, injured confirmed 0, 2020
	r3: randomUUID(), // D2, deaths confirmed 0, injured explicit No, 2021-06
	r4: randomUUID(), // D2, deaths not reported, 2021
	r5: randomUUID(), // no link, point inside D2 (ATT-A, GEO-P), deaths 3, 2019
	r6: randomUUID(), // no link, no geometry, deaths 2, 2020
	r7: randomUUID(), // D1, undated, deaths 1
	r8: randomUUID(), // D1, draft, deaths 100: reviewer basis only
	r9: randomUUID(), // R2 only (level 1), not reported, 2018
	r10: randomUUID(), // D1 and D2, deaths 4, 2020
	r11: randomUUID(), // D1, deaths 2, affected_direct 10 flagged on damnificados, 2020
	r12: randomUUID(), // D1, impossible start date 2020-02-30, deaths 6
	r13: randomUUID(), // D2, start 2020, end "unknown", deaths 7, injured explicit No
	r14: randomUUID(), // D1, published but retired (DEC-012), deaths 11
	r15: randomUUID(), // no link, point on the D1/D2 border, 2020
	rb: randomUUID(), // tenant B, RB, deaths 50
};
const ev = {
	e1: randomUUID(), // published, linked to D1; member r1
	e2: randomUUID(), // published, no link; members r10 (D1, D2) and r3 (D2)
	e3: randomUUID(), // published, no link, no members
	e4: randomUUID(), // draft, no link; member r4 (D2)
};
const assetId = randomUUID();
// Housing's parent sector: outside the Housing subtree, never counted.
const OTHER_SECTOR = "fa1b8e2c-8c43-4a18-9d24-5dbd1e4a6e9c";

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
		end?: string;
		hipTypeId?: string | null;
		legacy?: unknown;
	} = {},
) {
	await dr.execute(sql`
		INSERT INTO disaster_records (id, country_accounts_id, "approvalStatus", start_date, end_date, hip_type_id, legacy_data)
		VALUES (${id}, ${tenant}, ${opts.status ?? "published"}, ${opts.start ?? ""}, ${opts.end ?? ""},
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

async function point(recordId: string, x: number, y: number) {
	await dr.execute(sql`
		INSERT INTO disaster_records_geom (disaster_record_id, geom)
		VALUES (${recordId}, ST_SetSRID(ST_MakePoint(${x}, ${y}), 4326))
	`);
}

async function cleanupTenant(tenant: string) {
	await dr.execute(
		sql`DELETE FROM geo.event_atom WHERE country_accounts_id = ${tenant}`,
	);
	await dr.execute(sql`
		DELETE FROM damages WHERE record_id IN (
			SELECT id FROM disaster_records WHERE country_accounts_id = ${tenant})
	`);
	await dr.execute(
		sql`DELETE FROM asset WHERE country_accounts_id = ${tenant}`,
	);
	await dr.execute(
		sql`DELETE FROM geo.impact_atom WHERE country_accounts_id = ${tenant}`,
	);
	await dr.execute(
		sql`DELETE FROM geo.division_ancestor WHERE country_accounts_id = ${tenant}`,
	);
	await dr.execute(
		sql`DELETE FROM geo.division_geom_cache WHERE country_accounts_id = ${tenant}`,
	);
	await dr.execute(
		sql`DELETE FROM geo.refresh_log WHERE country_accounts_id = ${tenant}`,
	);
	await dr.execute(sql`
		DELETE FROM human_category_presence WHERE record_id IN (
			SELECT id FROM disaster_records WHERE country_accounts_id = ${tenant})
	`);
	await dr.execute(
		sql`DELETE FROM disaster_records WHERE country_accounts_id = ${tenant}`,
	);
	const events = await dr.execute(
		sql`SELECT id FROM disaster_event WHERE country_accounts_id = ${tenant}`,
	);
	await dr.execute(
		sql`DELETE FROM disaster_event WHERE country_accounts_id = ${tenant}`,
	);
	for (const e of events.rows as { id: string }[]) {
		await dr.execute(sql`DELETE FROM event WHERE id = ${e.id}`);
	}
	await dr.execute(
		sql`DELETE FROM division WHERE country_accounts_id = ${tenant} AND level = 2`,
	);
	await dr.execute(
		sql`DELETE FROM division WHERE country_accounts_id = ${tenant}`,
	);
}

/** A resolved request built from URL parameters, as the routes build it. */
function req(
	params: Record<string, string | string[]>,
	audience: ApprovalAudience = "signed-in",
): GeoRequest {
	const sp = new URLSearchParams();
	for (const [k, v] of Object.entries(params)) {
		for (const x of Array.isArray(v) ? v : [v]) sp.append(k, x);
	}
	const { query, issues } = parseDeltaQuery(sp);
	expect(issues).toEqual([]);
	const level = sp.get("level");
	return {
		query,
		level: level === null ? undefined : Number(level),
		audience,
		notApplied: [],
	};
}

/** The routes' request resolution, through the API key path (no session). */
function resolve(tenant: string, query: string) {
	const url = new URL(`http://localhost/en/api/geo/choropleth?${query}`);
	const ctx: GeoRequestContext = {
		countryAccountsId: tenant,
		lang: "en",
		url,
		request: new Request(url),
		viaApiKey: true,
	};
	return resolveGeoRequest(ctx, {
		requireMeasure: true,
		requireLevel: true,
		eventDimensions: true,
	});
}

/** The refusal a request raised: a GeoRefusalError (unwrapped) or a Response. */
async function refusalOf(p: Promise<unknown>) {
	try {
		await p;
	} catch (e) {
		if (e instanceof GeoRefusalWithMeta) {
			expect(e.meta.methodVersion).toBe("geo.v1");
			return e.refusal;
		}
		return e;
	}
	throw new Error("expected a refusal");
}

function cellOf(cells: GeoCell[], id: string): GeoCell {
	const c = cells.find((x) => x.division_id === id);
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
			(
				(await dr.execute(sql`SELECT id FROM hip_class ORDER BY id LIMIT 1`))
					.rows[0] as { id: string }
			).id,
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
						{
							code: "IMPLAUSIBLE_MAGNITUDE",
							fields: ["damnificados"],
							rule_version: "1",
							note: "",
						},
					],
				},
			},
		});
		await insertRecord(rec.r12, a, { start: "2020-02-30" });
		await insertRecord(rec.r13, a, { start: "2020", end: "unknown" });
		await insertRecord(rec.r14, a, {
			start: "2020",
			legacy: { migration: { run_id: "run-old", retired: true } },
		});
		await insertRecord(rec.r15, a, { start: "2020" });
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
		await presence(rec.r12, { deaths: [true, 6] });
		await presence(rec.r13, { deaths: [true, 7], injured: [false, null] });
		await presence(rec.r14, { deaths: [true, 11] });
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
			[rec.r12, div.d1],
			[rec.r13, div.d2],
			[rec.r14, div.d1],
			[rec.rb, div.rb],
		]) {
			await link(r, d);
		}
		await point(rec.r5, 7, 2);
		await point(rec.r15, 5, 2);

		// Disaster events (I-1).
		for (const [id, status] of [
			[ev.e1, "published"],
			[ev.e2, "published"],
			[ev.e3, "published"],
			[ev.e4, "draft"],
		] as const) {
			await dr.execute(sql`INSERT INTO event (id) VALUES (${id})`);
			await dr.execute(sql`
				INSERT INTO disaster_event (id, country_accounts_id, "approvalStatus", start_date)
				VALUES (${id}, ${a}, ${status}, '2020')
			`);
		}
		await dr.execute(sql`
			INSERT INTO disaster_event_division (disaster_event_id, division_id)
			VALUES (${ev.e1}, ${div.d1})
		`);
		for (const [r, e] of [
			[rec.r1, ev.e1],
			[rec.r10, ev.e2],
			[rec.r3, ev.e2],
			[rec.r4, ev.e4],
		]) {
			await dr.execute(
				sql`UPDATE disaster_records SET disaster_event_id = ${e} WHERE id = ${r}`,
			);
		}

		// Houses (I-1): one Housing asset, destroyed in td, damaged in pd.
		await dr.execute(sql`
			INSERT INTO asset (id, sector_ids, is_built_in, custom_name, country_accounts_id)
			VALUES (${assetId}, ${HOUSING_SECTOR_ID}, false, 'Dwellings (test)', ${a})
		`);
		for (const [r, sector, td, pd] of [
			[rec.r1, HOUSING_SECTOR_ID, 3, 10],
			[rec.r2, HOUSING_SECTOR_ID, 0, null],
			[rec.r3, HOUSING_SECTOR_ID, null, 0],
			[rec.r5, HOUSING_SECTOR_ID, 4, null],
			[rec.r1, OTHER_SECTOR, 99, 99],
		] as const) {
			await dr.execute(sql`
				INSERT INTO damages (record_id, sector_id, asset_id, unit, td_damage_amount, pd_damage_amount)
				VALUES (${r}, ${sector}, ${assetId}, 'number_count', ${td}, ${pd})
			`);
		}

		await refreshGeoReadModel(a);
		await refreshGeoReadModel(tenantB);
	});

	afterAll(async () => {
		await cleanupTenant(ids.countryAccountId);
		await cleanupTenant(tenantB);
		await cleanupOtherTenant();
		await cleanupTestUser(ids);
	});

	describe("schema and refresh", () => {
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
				"geo_event_tenant_dim_idx",
				"geo_event_tenant_start_idx",
				"geo_event_event_idx",
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

		it("reads impossible dates as undated instead of failing", async () => {
			const res = await dr.execute(sql`
				SELECT geo.date_floor('2015') AS f, geo.date_ceil('2015') AS c,
					geo.date_ceil('2016-02') AS m,
					geo.date_floor('2015-02-30') AS feb30,
					geo.date_floor('2015-13') AS month13,
					geo.date_floor('2015-00-00') AS zero,
					geo.date_precision('2015-02-30') AS bad_precision
			`);
			const r = res.rows[0] as Record<string, string | Date | null>;
			expect(new Date(r.f as string).toISOString().slice(0, 10)).toBe(
				"2015-01-01",
			);
			expect(new Date(r.c as string).toISOString().slice(0, 10)).toBe(
				"2015-12-31",
			);
			expect(new Date(r.m as string).toISOString().slice(0, 10)).toBe(
				"2016-02-29",
			);
			expect(r.feb30).toBeNull();
			expect(r.month13).toBeNull();
			expect(r.zero).toBeNull();
			expect(r.bad_precision).toBe("none");
		});

		it("falls back to the start period for an unreadable end date", async () => {
			const res = await dr.execute(sql`
				SELECT end_instant, end_from_start FROM geo.impact_atom
				WHERE disaster_record_id = ${rec.r13} AND measure = 'records'
			`);
			const r = res.rows[0] as {
				end_instant: string | Date;
				end_from_start: boolean;
			};
			expect(new Date(r.end_instant).toISOString().slice(0, 10)).toBe(
				"2020-12-31",
			);
			expect(r.end_from_start).toBe(true);
		});

		it("lets two refreshes of one tenant run at once", async () => {
			const [x, y] = await Promise.all([
				refreshGeoReadModel(ids.countryAccountId),
				refreshGeoReadModel(ids.countryAccountId),
			]);
			expect(x.atomCount).toBe(y.atomCount);
		});
	});

	describe("G2 choropleth", () => {
		it("places records by ancestor and keeps null apart from zero", async () => {
			const body = await getChoropleth(
				ids.countryAccountId,
				req({ measure: "deaths", level: "1" }),
			);
			const r1 = cellOf(body.cells, div.r1);
			// r1 5, r5 3, r7 1, r10 4 (once), r11 2, r12 6, r13 7; r2 r3 r4 in scope.
			expect(r1.value).toBe(28);
			expect(r1.value_state).toBe("reported");
			expect(r1.records_total).toBe(10);
			expect(r1.records_reported).toBe(8); // seven values and one confirmed zero
			expect(r1.records_zero_confirmed).toBe(1);
			expect(r1.records_not_reported).toBe(2);
			expect(r1.records_not_applicable).toBe(0);
			expect(r1.coverage).toBeCloseTo(0.8);

			const r2 = cellOf(body.cells, div.r2);
			expect(r2.value).toBeNull();
			expect(r2.value_state).toBe("not_reported");
		});

		it("applies the approval basis: drafts, retired records and other tenants stay out", async () => {
			const body = await getChoropleth(
				ids.countryAccountId,
				req({ measure: "deaths", level: "1" }),
			);
			expect(body.cells.map((c) => c.division_id)).not.toContain(div.rb);
			expect(body.meta.approvalBasis).toEqual(["published"]);
			expect(body.meta.provisional).toBe(false);
			const total = body.cells.reduce((s, c) => s + (c.value ?? 0), 0);
			expect(total).toBe(28); // r8 (draft, 100), r14 (retired, 11), rb (50) absent
		});

		it("adds drafts on the reviewer basis and labels the figure provisional", async () => {
			const body = await getChoropleth(
				ids.countryAccountId,
				req({ measure: "deaths", level: "1" }, "reviewer-provisional"),
			);
			expect(cellOf(body.cells, div.r1).value).toBe(128);
			expect(body.meta.provisional).toBe(true);
			expect(body.meta.approvalBasis).toContain("draft");
			expect(body.caption).toMatch(/Provisional/);
		});

		it("counts unplaced records with their reason, never dropping them", async () => {
			const lvl2 = await getChoropleth(
				ids.countryAccountId,
				req({ measure: "deaths", level: "2" }),
			);
			expect(lvl2.unattributed.reasons).toEqual({
				no_division_row: 1, // r6
				coarser_than_level: 1, // r9 is linked to R2 only
				geometry_spans_divisions: 1, // r15 on the D1/D2 border
			});
			const d1 = cellOf(lvl2.cells, div.d1);
			const d2 = cellOf(lvl2.cells, div.d2);
			expect(d1.records_total).toBe(6); // r1 r2 r7 r10 r11 r12
			expect(d2.records_total).toBe(5); // r3 r4 r5 r10 r13
			// 13 published, live records: each counted once, r10 in two cells.
			expect(
				d1.records_total +
					d2.records_total -
					lvl2.multiDivisionRecords +
					lvl2.unattributed.records,
			).toBe(13);
			expect(lvl2.multiDivisionRecords).toBe(1);
			expect(lvl2.caption).toMatch(/more than one area/);
		});

		it("grades attribution: B by national id, C by import id, A when covered by one division", async () => {
			const lvl2 = await getChoropleth(
				ids.countryAccountId,
				req({ measure: "records", level: "2" }),
			);
			expect(cellOf(lvl2.cells, div.d1).gradeDistribution).toEqual({
				A: 0,
				B: 6,
				C: 0,
				D: 0,
			});
			expect(cellOf(lvl2.cells, div.d2).gradeDistribution).toEqual({
				A: 1,
				B: 0,
				C: 4,
				D: 0,
			});
			expect(cellOf(lvl2.cells, div.d2).geo_precision).toEqual({ L2: 4, P: 1 });
			expect(lvl2.excluded_by_grade_floor).toBeUndefined();
		});

		it("reports the records a grade floor excludes, each once", async () => {
			const onlyB = await getChoropleth(
				ids.countryAccountId,
				req({ measure: "records", level: "2", minAttGrade: "B" }),
			);
			expect(cellOf(onlyB.cells, div.d2).records_total).toBe(1); // r5 (A) only
			expect(cellOf(onlyB.cells, div.d1).records_total).toBe(6);
			// r3, r4 and r13 have only C links. r10 passes through D1, so it is not excluded.
			expect(onlyB.excluded_by_grade_floor).toEqual({
				records: 3,
				by_grade: { C: 3 },
			});
		});

		it("reports undated records as unattributed when a range is set", async () => {
			const body = await getChoropleth(
				ids.countryAccountId,
				req({ measure: "deaths", level: "2", from: "2020", to: "2020" }),
			);
			expect(body.unattributed.reasons).toEqual({
				no_division_row: 1, // r6
				undated: 2, // r7, and r12 with its impossible date
				geometry_spans_divisions: 1, // r15
			});
			expect(cellOf(body.cells, div.d1).value).toBe(11); // r1 5, r10 4, r11 2
			expect(cellOf(body.cells, div.d2).value).toBe(11); // r10 4, r13 7 (end from start)
		});

		it("keeps a record with an unreadable end date inside its start year only", async () => {
			const body = await getChoropleth(
				ids.countryAccountId,
				req({ measure: "deaths", level: "2", from: "2021" }),
			);
			const d2 = cellOf(body.cells, div.d2);
			expect(d2.records_total).toBe(2); // r3 and r4; r13 ended in 2020
		});

		it("restricts to a division and its descendants", async () => {
			const body = await getChoropleth(
				ids.countryAccountId,
				req({ measure: "deaths", level: "2", division: div.d2 }),
			);
			expect(body.cells.map((c) => c.division_id)).toEqual([div.d2]);
			expect(cellOf(body.cells, div.d2).value).toBe(14); // r5 3, r10 4, r13 7
		});

		it("filters on a numeric HIP type id", async () => {
			const body = await getChoropleth(
				ids.countryAccountId,
				req({ measure: "deaths", level: "1", hipType: hipTypeId }),
			);
			expect(cellOf(body.cells, div.r1).value).toBe(5); // r1 only
		});

		it("earns a confirmed zero only with enough coverage (V-5)", async () => {
			const body = await getChoropleth(
				ids.countryAccountId,
				req({ measure: "injured", level: "2" }),
			);
			// D2: explicit No on r3 and r13, 2 of 5 records (40%): confirmed zero.
			const d2 = cellOf(body.cells, div.d2);
			expect(d2.value_state).toBe("zero_confirmed");
			expect(d2.value).toBe(0);
			// D1: r2's stored 0 is 1 of 6 records (17%): not enough.
			const d1 = cellOf(body.cells, div.d1);
			expect(d1.value_state).toBe("insufficient_reporting");
			expect(d1.value).toBeNull();
		});

		it("flags only the measures a plausibility flag concerns (C30)", async () => {
			const affected = await getChoropleth(
				ids.countryAccountId,
				req({ measure: "affected_direct", level: "2" }),
			);
			expect(cellOf(affected.cells, div.d1).plausibility_flagged_records).toBe(
				1,
			);
			const deaths = await getChoropleth(
				ids.countryAccountId,
				req({ measure: "deaths", level: "2" }),
			);
			expect(cellOf(deaths.cells, div.d1).plausibility_flagged_records).toBe(0);
			expect(affected.meta.migrationRunIds).toEqual(["run-test-1"]);
		});

		it("refuses a level finer than the instance holds", async () => {
			await expect(
				getChoropleth(
					ids.countryAccountId,
					req({ measure: "deaths", level: "3" }),
				),
			).rejects.toMatchObject({ code: "PRECISION_BELOW_CEILING", status: 200 });
		});
	});

	describe("request resolution", () => {
		const a = () => ids.countryAccountId;

		it("refuses money, several measures, ATT-D and measures not yet built", async () => {
			for (const [q, code] of [
				["measure=losses&level=1", "MONETARY_CONVENTIONS_PENDING"],
				["measure=deaths&measure=injured&level=1", "MULTI_SERIES_CHOROPLETH"],
				[
					"measure=deaths&level=1&minAttGrade=D",
					"ATT_D_EXCLUDED_FROM_OFFICIAL",
				],
				["measure=relocated&level=1", "MEASURE_NOT_AVAILABLE"],
			] as const) {
				const e = (await refusalOf(resolve(a(), q))) as GeoRefusalError;
				expect(e.code).toBe(code);
				expect(e.status).toBe(200);
			}
		});

		it("refuses rather than widens on a bad division, date, basis or level", async () => {
			for (const q of [
				"measure=deaths&level=1&division=not-an-id",
				"measure=deaths&level=1&from=2020-02-30",
				"measure=deaths&level=1&to=2020-13",
				"measure=deaths&level=1&basis=everything",
				"measure=deaths&level=x",
				"level=1",
			]) {
				const e = (await refusalOf(resolve(a(), q))) as GeoRefusalError;
				expect(e.code).toBe("MALFORMED_REQUEST");
				expect(e.status).toBe(400);
			}
		});

		it("does not reveal another tenant's division", async () => {
			const e = (await refusalOf(
				resolve(a(), `measure=deaths&level=1&division=${div.rb}`),
			)) as Response;
			expect(e.status).toBe(404);
		});

		it("refuses the provisional basis to an API key", async () => {
			const e = (await refusalOf(
				resolve(a(), "measure=deaths&level=1&basis=provisional"),
			)) as Response;
			expect(e.status).toBe(403);
		});

		it("names the filters it cannot apply", async () => {
			const r = await resolve(
				a(),
				`measure=deaths&level=1&effect=deaths&sector=${randomUUID()}&asOf=2026-01-01`,
			);
			expect(r.notApplied.map((s) => s.split(":")[0]).sort()).toEqual([
				"asOf",
				"effect",
				"sector",
			]);
		});
	});

	describe("I-1 houses", () => {
		it("counts houses from Housing damages only, keeping null apart from zero", async () => {
			const destroyed = await getChoropleth(
				ids.countryAccountId,
				req({ measure: "houses_destroyed", level: "2" }),
			);
			const d1 = cellOf(destroyed.cells, div.d1);
			expect(d1.value).toBe(3); // r1; the 99 in another sector is never counted
			expect(d1.records_reported).toBe(2); // r1, and r2's confirmed 0
			expect(d1.records_zero_confirmed).toBe(1);
			expect(cellOf(destroyed.cells, div.d2).value).toBe(4); // r5

			const damaged = await getChoropleth(
				ids.countryAccountId,
				req({ measure: "houses_damaged", level: "2" }),
			);
			expect(cellOf(damaged.cells, div.d1).value).toBe(10);
			// D2: r3's stored 0 is 1 of 5 records (20%): not enough for a confirmed zero.
			const d2 = cellOf(damaged.cells, div.d2);
			expect(d2.value_state).toBe("insufficient_reporting");
			expect(d2.value).toBeNull();
			expect(damaged.caption).toMatch(/House counts/);
		});
	});

	describe("I-1 event dimensions", () => {
		it("counts each disaster event once per area, by link or by its records", async () => {
			const body = await getChoropleth(
				ids.countryAccountId,
				req({ dim: "disaster_event", measure: "events", level: "2" }),
			);
			expect(body.entity).toBe("disaster_event");
			expect(cellOf(body.cells, div.d1).value).toBe(2); // e1 (link), e2 (via r10)
			expect(cellOf(body.cells, div.d2).value).toBe(1); // e2 (via r10, r3)
			expect(body.multiDivisionRecords).toBe(1); // e2 in both areas
			expect(body.unattributed.reasons).toEqual({ no_division_row: 1 }); // e3
			expect(body.derivation).toEqual({ as_recorded: 1, from_records: 1 });
			expect(body.caption).toMatch(/placed where their records are/);
		});

		it("grades an event placed through its records by its best record grade", async () => {
			const body = await getChoropleth(
				ids.countryAccountId,
				req({ dim: "disaster_event", measure: "events", level: "2" }),
			);
			expect(cellOf(body.cells, div.d1).gradeDistribution).toEqual({
				A: 0,
				B: 2,
				C: 0,
				D: 0,
			});
			expect(cellOf(body.cells, div.d2).gradeDistribution).toEqual({
				A: 0,
				B: 0,
				C: 1,
				D: 0,
			});
		});

		it("counts an event once at a coarser level", async () => {
			const body = await getChoropleth(
				ids.countryAccountId,
				req({ dim: "disaster_event", measure: "events", level: "1" }),
			);
			expect(cellOf(body.cells, div.r1).value).toBe(2);
			expect(body.multiDivisionRecords).toBe(0);
		});

		it("adds draft events on the reviewer basis only", async () => {
			const body = await getChoropleth(
				ids.countryAccountId,
				req(
					{ dim: "disaster_event", measure: "events", level: "2" },
					"reviewer-provisional",
				),
			);
			expect(cellOf(body.cells, div.d2).value).toBe(2); // e2 and the draft e4
			expect(body.meta.provisional).toBe(true);
		});

		it("shows no hazardous events where none exist, never zeros", async () => {
			const body = await getChoropleth(
				ids.countryAccountId,
				req({ dim: "hazardous_event", measure: "events", level: "1" }),
			);
			expect(body.cells).toEqual([]);
			expect(body.unattributed.records).toBe(0);
		});

		it("refuses a measure that does not belong to the dimension", async () => {
			for (const q of [
				"dim=disaster_event&measure=deaths&level=1",
				"measure=events&level=1",
				"measure=evacuated&level=1",
			]) {
				const e = (await refusalOf(
					resolve(ids.countryAccountId, q),
				)) as GeoRefusalError;
				expect(e.code).toBe("MEASURE_NOT_AVAILABLE");
			}
			const r = await resolve(
				ids.countryAccountId,
				"dim=disaster_event&level=1",
			);
			expect(r.query.measure).toBe("events");
		});
	});

	describe("G1 boundaries and T1 tiles", () => {
		it("returns only the tenant's divisions at the level", async () => {
			const fc = (await getBoundaries(ids.countryAccountId, {
				level: 1,
				lang: "en",
			})) as {
				features: { properties: { divisionId: string } }[];
				boundaryVersion: string;
			};
			expect(fc.features.map((f) => f.properties.divisionId).sort()).toEqual(
				[div.r1, div.r2].sort(),
			);
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
			const forA = await getDivisionTile(
				ids.countryAccountId,
				1,
				5,
				19,
				15,
				"en",
			);
			const forB = await getDivisionTile(tenantB, 1, 5, 19, 15, "en");
			expect(forA.length).toBe(0);
			expect(forB.length).toBeGreaterThan(0);
			// z3 x4 y3 covers lon 0 to 45, lat 0 to 41: tenant A's R1.
			expect(
				(await getDivisionTile(ids.countryAccountId, 1, 3, 4, 3, "en")).length,
			).toBeGreaterThan(0);
		});
	});

	describe("G3 place dossier", () => {
		it("summarises a division and its descendants, with grades", async () => {
			const d = await getPlaceDossier(
				ids.countryAccountId,
				div.r1,
				req({}),
				"en",
			);
			expect(d).not.toBeNull();
			expect(d!.recurrence.recordCount).toBe(10);
			expect(d!.recurrence.undatedRecordCount).toBe(2); // r7, r12
			expect(d!.byYear).toEqual([
				{ year: 2019, recordCount: 1 },
				{ year: 2020, recordCount: 5 },
				{ year: 2021, recordCount: 2 },
			]);
			expect(d!.recurrence.gradeDistribution).toEqual({
				A: 1,
				B: 6,
				C: 3,
				D: 0,
			});
			expect(d!.cumulative.deaths.value).toBe(28);
			expect(d!.cumulative.deaths.value_state).toBe("reported");
			expect(d!.hazardMix).toContainEqual({ hipTypeId, recordCount: 1 });
			expect(d!.meta.migrationRunIds).toEqual(["run-test-1"]);
		});

		it("describes only its own place: no run ids from elsewhere", async () => {
			const d = await getPlaceDossier(
				ids.countryAccountId,
				div.r2,
				req({}),
				"en",
			);
			expect(d!.recurrence.recordCount).toBe(1);
			expect(d!.cumulative.deaths.value_state).toBe("not_reported");
			expect(d!.cumulative.deaths.value).toBeNull();
			expect(d!.meta.migrationRunIds).toEqual([]);
		});

		it("does not reveal another tenant's division", async () => {
			const d = await getPlaceDossier(
				ids.countryAccountId,
				div.rb,
				req({}),
				"en",
			);
			expect(d).toBeNull();
		});
	});

	describe("G6 hazard tree", () => {
		it("counts the tenant's records on the approval basis", async () => {
			const tree = await getHazardTree(ids.countryAccountId, req({}), "en");
			const t = tree.types.find((x) => x.id === hipTypeId)!;
			expect(t.recordCountSubtree).toBe(1);
			expect(t.recordCountSelf).toBe(1);
			expect(tree.unclassifiedRecordCount).toBe(12); // 13 live published minus r1

			const reviewer = await getHazardTree(
				ids.countryAccountId,
				req({}, "reviewer-provisional"),
				"en",
			);
			expect(reviewer.unclassifiedRecordCount).toBe(13); // adds the draft r8
		});

		it("names the filters the tree does not apply", async () => {
			const tree = await getHazardTree(
				ids.countryAccountId,
				req({ from: "2020", minAttGrade: "B" }),
				"en",
			);
			expect(tree.meta.notApplied.map((s) => s.split(":")[0]).sort()).toEqual([
				"from/to",
				"minAttGrade",
			]);
		});
	});
});
