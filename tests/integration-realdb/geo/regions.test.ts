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
import { getTenantOutline } from "~/backend.server/models/geo/tenantExtent";
import {
	getCountryDossier,
	listPlaceOptions,
} from "~/backend.server/models/geo/queries";
import {
	getChoropleth,
	GeoRefusalError,
} from "~/backend.server/models/geo/queries";
import {
	getRegion,
	getRegionSummary,
	listRegions,
	saveRegion,
} from "~/backend.server/models/geo/regions";
import {
	GeoRefusalWithMeta,
	resolveGeoRequest,
	type GeoRequestContext,
} from "~/backend.server/handlers/geo";

// Regions within one country (RG-1, increment I-4). Fixture, tenant A:
//   P1, P2, P3 at level 1 (P1 has a level-2 child C1). Region "North" = P1+P2.
//   a: P1 deaths 5; b: P1 and P2 deaths 4; c: P2 deaths 3; d: P3 deaths 100;
//   e: C1 deaths 2. Tenant B: PB at level 1.
// Region total = a+b+c+e = 14 (b once); P1 = 11, P2 = 7, sum 18; 1 shared.

const ids = createTestIds();
ids.userEmail = ids.userEmail.replace("@", "-georegions@");
let tenantB = "";
const div = {
	p1: randomUUID(),
	p2: randomUUID(),
	p3: randomUUID(),
	c1: randomUUID(),
	pb: randomUUID(),
};
const rec = {
	a: randomUUID(),
	b: randomUUID(),
	c: randomUUID(),
	d: randomUUID(),
	e: randomUUID(),
};
let regionId = "";

async function insertDivision(
	id: string,
	tenant: string,
	parent: string | null,
	level: number,
	env: string,
	code: string,
) {
	await dr.execute(sql`
		INSERT INTO division (id, parent_id, country_accounts_id, name, level, national_id, import_id, geom, bbox)
		VALUES (${id}, ${parent}, ${tenant}, ${JSON.stringify({ en: `Div ${code}` })}::jsonb, ${level},
			${code}, ${code},
			${sql.raw(`ST_MakeEnvelope(${env}, 4326)`)}, ${sql.raw(`ST_MakeEnvelope(${env}, 4326)`)})
	`);
}

async function record(id: string, deaths: number, divisions: string[]) {
	await dr.execute(sql`
		INSERT INTO disaster_records (id, country_accounts_id, "approvalStatus", start_date)
		VALUES (${id}, ${ids.countryAccountId}, 'published', '2020')
	`);
	await dr.execute(sql`
		INSERT INTO human_category_presence (record_id, deaths, deaths_total)
		VALUES (${id}, true, ${deaths})
	`);
	for (const d of divisions) {
		await dr.execute(sql`
			INSERT INTO disaster_records_division (disaster_record_id, division_id)
			VALUES (${id}, ${d})
		`);
	}
}

async function cleanupTenant(tenant: string) {
	await dr.execute(
		sql`DELETE FROM geo.region WHERE country_accounts_id = ${tenant}`,
	);
	for (const t of [
		"geo.impact_atom",
		"geo.event_atom",
		"geo.division_ancestor",
		"geo.division_geom_cache",
		"geo.refresh_log",
	]) {
		await dr.execute(
			sql`DELETE FROM ${sql.raw(t)} WHERE country_accounts_id = ${tenant}`,
		);
	}
	await dr.execute(sql`
		DELETE FROM disaster_records_division WHERE disaster_record_id IN (
			SELECT id FROM disaster_records WHERE country_accounts_id = ${tenant})
	`);
	await dr.execute(sql`
		DELETE FROM human_category_presence WHERE record_id IN (
			SELECT id FROM disaster_records WHERE country_accounts_id = ${tenant})
	`);
	await dr.execute(
		sql`DELETE FROM disaster_records WHERE country_accounts_id = ${tenant}`,
	);
	await dr.execute(
		sql`DELETE FROM division WHERE country_accounts_id = ${tenant} AND level = 2`,
	);
	await dr.execute(
		sql`DELETE FROM division WHERE country_accounts_id = ${tenant}`,
	);
}

/** The routes' request resolution, through the API key path (no session). */
function resolve(tenant: string, query: string, region = true) {
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
		requireLevel: false,
		eventDimensions: true,
		region,
	});
}

async function caught(p: Promise<unknown>): Promise<unknown> {
	try {
		await p;
	} catch (e) {
		return e instanceof GeoRefusalWithMeta ? e.refusal : e;
	}
	throw new Error("expected a refusal");
}

describe("geoportal regions within one country (RG-1)", () => {
	beforeAll(async () => {
		await createTestUser(ids);
		tenantB = await createOtherTenant();
		const a = ids.countryAccountId;
		await cleanupTenant(a);
		await insertDivision(div.p1, a, null, 1, "0, 0, 10, 10", "P1");
		await insertDivision(div.p2, a, null, 1, "10, 0, 20, 10", "P2");
		await insertDivision(div.p3, a, null, 1, "20, 0, 30, 10", "P3");
		await insertDivision(div.c1, a, div.p1, 2, "0, 0, 5, 5", "C1");
		await insertDivision(div.pb, tenantB, null, 1, "40, 0, 50, 10", "PB");
		await record(rec.a, 5, [div.p1]);
		await record(rec.b, 4, [div.p1, div.p2]);
		await record(rec.c, 3, [div.p2]);
		await record(rec.d, 100, [div.p3]);
		await record(rec.e, 2, [div.c1]);
		await refreshGeoReadModel(a);
		regionId = await saveRegion(a, {
			name: { en: "North" },
			kind: "planning",
			divisionIds: [div.p1, div.p2],
		});
	});

	afterAll(async () => {
		await cleanupTenant(ids.countryAccountId);
		await dr.execute(sql`DELETE FROM division WHERE id = ${div.pb}`);
		await cleanupOtherTenant();
		await cleanupTestUser(ids);
	});

	it("lists the tenant's regions with members, vintages and kind", async () => {
		const regions = await listRegions(ids.countryAccountId, "en");
		expect(regions).toHaveLength(1);
		expect(regions[0]).toMatchObject({
			regionId,
			name: "North",
			kind: "planning",
			referenceCode: null,
			memberLevel: 1,
			regionVintage: "1",
		});
		expect(regions[0].members.map((m) => m.name)).toEqual(["Div P1", "Div P2"]);
		expect(await listRegions(tenantB, "en")).toEqual([]);
	});

	it("counts each record once in the region total and discloses shared records", async () => {
		const region = await getRegion(ids.countryAccountId, regionId, "en");
		const req = await resolve(ids.countryAccountId, "measure=deaths");
		const body = await getRegionSummary(ids.countryAccountId, req, region!);
		expect(body.total?.value).toBe(14);
		expect(body.total?.records_total).toBe(4);
		const byName = Object.fromEntries(
			body.members.map((m) => [m.name, m.cell?.value]),
		);
		expect(byName).toEqual({ "Div P1": 11, "Div P2": 7 });
		expect(body.sumOfMembers).toBe(18);
		expect(body.multiAreaRecords).toBe(1);
		// Reconciliation (I-4 exit test): members minus shared records = total.
		expect(body.sumOfMembers! - 4 * body.multiAreaRecords).toBe(14);
		expect(body.meta.query.where.region).toEqual({ regionId });
	});

	it("restricts the choropleth to the region's members and their descendants", async () => {
		const req = await resolve(
			ids.countryAccountId,
			`measure=deaths&level=1&region=${regionId}`,
		);
		expect(req.query.where.region).toEqual({ regionId });
		const body = await getChoropleth(ids.countryAccountId, req);
		const values = Object.fromEntries(
			body.cells.map((c) => [c.division_id, c.value]),
		);
		expect(values).toEqual({ [div.p1]: 11, [div.p2]: 7 });
		expect(body.meta.query.where.region).toEqual({ regionId });
	});

	it("refuses division and region together, a malformed region and another tenant's region", async () => {
		const both = await caught(
			resolve(
				ids.countryAccountId,
				`measure=deaths&region=${regionId}&division=${div.p1}`,
			),
		);
		expect(both).toBeInstanceOf(GeoRefusalError);
		expect((both as GeoRefusalError).code).toBe("REGION_AND_DIVISION");
		expect((both as GeoRefusalError).status).toBe(422);

		const bad = await caught(
			resolve(ids.countryAccountId, "measure=deaths&region=nope"),
		);
		expect((bad as GeoRefusalError).status).toBe(400);

		const foreign = await caught(
			resolve(tenantB, `measure=deaths&region=${regionId}`),
		);
		expect(foreign).toBeInstanceOf(Response);
		expect((foreign as Response).status).toBe(404);
		expect(await getRegion(tenantB, regionId, "en")).toBeNull();
	});

	it("names the region in notApplied on a view that cannot apply it", async () => {
		const req = await resolve(
			ids.countryAccountId,
			`measure=deaths&region=${regionId}`,
			false,
		);
		expect(req.query.where.region).toBeUndefined();
		expect(req.notApplied).toContain(
			"region: this view does not apply regions yet",
		);
	});

	it("accepts only the tenant's own divisions, at one admin level", async () => {
		const a = ids.countryAccountId;
		const foreign = await caught(
			saveRegion(a, {
				name: { en: "Mixed tenants" },
				kind: "planning",
				divisionIds: [div.p1, div.pb],
			}),
		);
		expect((foreign as GeoRefusalError).status).toBe(422);
		const levels = await caught(
			saveRegion(a, {
				name: { en: "Mixed levels" },
				kind: "planning",
				divisionIds: [div.p3, div.c1],
			}),
		);
		expect((levels as GeoRefusalError).status).toBe(422);
		// The trigger holds even when the model is bypassed.
		await expect(
			dr.execute(sql`
				INSERT INTO geo.region_member (region_id, country_accounts_id, division_id)
				VALUES (${regionId}, ${a}, ${div.pb})
			`),
		).rejects.toThrow();
		await expect(
			dr.execute(sql`
				INSERT INTO geo.region_member (region_id, country_accounts_id, division_id)
				VALUES (${regionId}, ${a}, ${div.c1})
			`),
		).rejects.toThrow();
	});

	it("raises the region vintage only when the members change", async () => {
		const a = ids.countryAccountId;
		await saveRegion(a, {
			regionId,
			name: { en: "North" },
			kind: "planning",
			divisionIds: [div.p2, div.p1],
		});
		expect((await getRegion(a, regionId, "en"))?.regionVintage).toBe("1");
		await saveRegion(a, {
			regionId,
			name: { en: "North" },
			kind: "planning",
			divisionIds: [div.p1, div.p2, div.p3],
		});
		const r = await getRegion(a, regionId, "en");
		expect(r?.regionVintage).toBe("2");
		expect(r?.members).toHaveLength(3);
	});

	it("draws the tenant's outline from its own level-1 areas, with a label point inside", async () => {
		const o = await getTenantOutline(ids.countryAccountId);
		expect(o.adminLevel).toBe(1);
		expect(["Polygon", "MultiPolygon"]).toContain(o.geojson?.type);
		const res = await dr.execute(sql`
			SELECT ST_Contains(
				ST_GeomFromGeoJSON(${JSON.stringify(o.geojson)}),
				ST_SetSRID(ST_MakePoint(${o.labelPoint![0]}, ${o.labelPoint![1]}), 4326)
			) AS inside,
			ST_Intersects(
				ST_GeomFromGeoJSON(${JSON.stringify(o.geojson)}),
				ST_MakeEnvelope(41, 1, 49, 9, 4326)
			) AS reaches_b
		`);
		const row = res.rows[0] as { inside: boolean; reaches_b: boolean };
		expect(row.inside).toBe(true);
		// Tenant B's area (40..50) is never part of A's outline (SEC-22).
		expect(row.reaches_b).toBe(false);
	});

	it("summarises the whole country with each record once, and lists the place options", async () => {
		const req = await resolve(ids.countryAccountId, "measure=deaths");
		const d = await getCountryDossier(ids.countryAccountId, req, "en");
		// a 5 + b 4 (in two provinces, counted once) + c 3 + d 100 + e 2.
		expect(d.cumulative.deaths.value).toBe(114);
		expect(d.recurrence.recordCount).toBe(5);
		expect(d.division).toMatchObject({ id: "country", level: 0 });
		const opts = await listPlaceOptions(ids.countryAccountId, "en");
		expect(opts.filter((o) => o.level === 1).map((o) => o.name)).toEqual([
			"Div P1",
			"Div P2",
			"Div P3",
		]);
		expect(opts.find((o) => o.id === div.c1)).toMatchObject({
			level: 2,
			parentId: div.p1,
		});
	});
});
