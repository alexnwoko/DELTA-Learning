import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { dr } from "~/db.server";
import {
	createTestIds,
	createTestUser,
	cleanupTestUser,
	createOtherTenant,
	cleanupOtherTenant,
} from "../../test-helpers";
import { refreshGeoReadModel } from "~/backend.server/models/geo/refresh";

// HTTP contract of the geo routes (build spec s5.3): the X-Auth key's tenant
// scopes every response; semantic refusals are 200 with the envelope,
// malformed requests 400, and another tenant's division is a 404.
let keyTenant = "";
vi.mock("~/backend.server/models/api_key", async (importOriginal) => {
	const original = await importOriginal<any>();
	return {
		...original,
		apiAuth: vi.fn(async () => ({ countryAccountsId: keyTenant })),
	};
});

import { loader as choropleth } from "~/routes/$lang+/api+/geo+/choropleth";
import { loader as dossier } from "~/routes/$lang+/api+/geo+/place.$divisionId.dossier";
import { loader as boundaries } from "~/routes/$lang+/api+/geo+/boundaries";
import { loader as tile } from "~/routes/$lang+/api+/geo+/tiles.divisions.$level.$z.$x.$y";
import { loader as extent } from "~/routes/$lang+/api+/geo+/extent";
import { loader as mapContext } from "~/routes/$lang+/api+/geo+/map-context";
import { loader as world } from "~/routes/$lang+/api+/geo+/world";
import { mapDataVersion } from "~/backend.server/models/geo/tenantExtent";

const ids = createTestIds();
ids.userEmail = ids.userEmail.replace("@", "-georoutes@");
let tenantB = "";
const divA = randomUUID();
const divB = randomUUID();
const recA = randomUUID();

async function call(
	loader: any,
	tenant: string,
	path: string,
	params: Record<string, string> = {},
	headers: Record<string, string> = {},
) {
	keyTenant = tenant;
	const request = new Request(`http://localhost/en/api/geo/${path}`, {
		headers: { "X-Auth": "test", ...headers },
	});
	return (await loader({
		request,
		params: { lang: "en", ...params },
		context: {},
	})) as Response;
}

describe("api geo routes", () => {
	beforeAll(async () => {
		await createTestUser(ids);
		tenantB = await createOtherTenant();
		for (const [id, tenant, env] of [
			[divA, ids.countryAccountId, "0, 0, 10, 10"],
			[divB, tenantB, "40, 0, 50, 10"],
		] as const) {
			await dr.execute(sql`
				INSERT INTO division (id, country_accounts_id, name, level, national_id, import_id, geom, bbox)
				VALUES (${id}, ${tenant}, '{"en":"Area"}'::jsonb, 1, ${id.slice(0, 8)}, ${id.slice(0, 8)},
					${sql.raw(`ST_MakeEnvelope(${env}, 4326)`)}, ${sql.raw(`ST_MakeEnvelope(${env}, 4326)`)})
			`);
		}
		await dr.execute(sql`
			INSERT INTO disaster_records (id, country_accounts_id, "approvalStatus", start_date)
			VALUES (${recA}, ${ids.countryAccountId}, 'published', '2020')
		`);
		await dr.execute(sql`
			INSERT INTO disaster_records_division (disaster_record_id, division_id) VALUES (${recA}, ${divA})
		`);
		await refreshGeoReadModel(ids.countryAccountId);
		await refreshGeoReadModel(tenantB);
	});

	afterAll(async () => {
		for (const t of [ids.countryAccountId, tenantB]) {
			await dr.execute(
				sql`DELETE FROM geo.impact_atom WHERE country_accounts_id = ${t}`,
			);
			await dr.execute(
				sql`DELETE FROM geo.division_ancestor WHERE country_accounts_id = ${t}`,
			);
			await dr.execute(
				sql`DELETE FROM geo.division_geom_cache WHERE country_accounts_id = ${t}`,
			);
			await dr.execute(
				sql`DELETE FROM geo.refresh_log WHERE country_accounts_id = ${t}`,
			);
			await dr.execute(
				sql`DELETE FROM disaster_records WHERE country_accounts_id = ${t}`,
			);
			await dr.execute(
				sql`DELETE FROM division WHERE country_accounts_id = ${t}`,
			);
		}
		await cleanupOtherTenant();
		await cleanupTestUser(ids);
	});

	it("returns a choropleth with the envelope and an ETag", async () => {
		const res = await call(
			choropleth,
			ids.countryAccountId,
			"choropleth?measure=records&level=1",
		);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.meta.hazardVocabularyVersion).toBe("HIPs 2025");
		expect(body.meta.readModelRefreshedAt).not.toBeNull();
		expect(body.cells).toHaveLength(1);
		expect(body.cells[0]).toMatchObject({
			division_id: divA,
			value: 1,
			value_state: "reported",
		});

		const etag = res.headers.get("ETag") as string;
		const again = await call(
			choropleth,
			ids.countryAccountId,
			"choropleth?measure=records&level=1",
			{},
			{
				"If-None-Match": etag,
			},
		);
		expect(again.status).toBe(304);
	});

	it("returns a semantic refusal as 200 with the envelope", async () => {
		const res = await call(
			choropleth,
			ids.countryAccountId,
			"choropleth?measure=losses&level=1",
		);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.error.code).toBe("MONETARY_CONVENTIONS_PENDING");
		expect(body.rows).toEqual([]);
		expect(body.meta.methodVersion).toBe("geo.v1");
		expect(body.meta.query.measure).toBe("losses");
	});

	it("returns a malformed request as 400 with the envelope", async () => {
		const res = await call(
			choropleth,
			ids.countryAccountId,
			"choropleth?measure=deaths",
		);
		expect(res.status).toBe(400);
		expect((await res.json()).error.code).toBe("MALFORMED_REQUEST");
	});

	it("returns 404 for another tenant's division, and 200 for the owner", async () => {
		const other = await call(
			dossier,
			ids.countryAccountId,
			`place/${divB}/dossier`,
			{ divisionId: divB },
		);
		expect(other.status).toBe(404);
		const own = await call(dossier, tenantB, `place/${divB}/dossier`, {
			divisionId: divB,
		});
		expect(own.status).toBe(200);
	});

	it("returns each tenant's own map extent (I-3), never another's", async () => {
		const a = await (await call(extent, ids.countryAccountId, "extent")).json();
		expect(a.source).toBe("division_geom_cache");
		expect(a.adminLevel).toBe(1);
		a.bbox.forEach((v: number, i: number) =>
			expect(v).toBeCloseTo([0, 0, 10, 10][i], 3),
		);
		expect(a.center[0]).toBeCloseTo(5, 3);
		expect(a.center[1]).toBeCloseTo(5, 3);
		const b = await (await call(extent, tenantB, "extent")).json();
		expect(b.bbox[0]).toBeCloseTo(40, 3);
	});

	it("scopes boundaries to the key's tenant", async () => {
		const res = await call(boundaries, tenantB, "boundaries?level=1");
		expect(res.headers.get("Content-Type")).toContain("application/geo+json");
		const fc = await res.json();
		expect(fc.features.map((f: any) => f.properties.divisionId)).toEqual([
			divB,
		]);
	});

	it("versions map geometry per tenant and caches only the current version for a year", async () => {
		const vA = await mapDataVersion(ids.countryAccountId);
		const vB = await mapDataVersion(tenantB);
		expect(vA).toMatch(/^[0-9a-f]{16}$/);
		expect(vB).not.toBe(vA);
		const current = await call(boundaries, tenantB, `boundaries?level=1&v=${vB}`);
		expect(current.headers.get("Cache-Control")).toBe(
			"private, max-age=31536000, immutable",
		);
		// Another tenant's version, or none, never earns the long cache.
		for (const q of [`boundaries?level=1&v=${vA}`, "boundaries?level=1"]) {
			const res = await call(boundaries, tenantB, q);
			expect(res.headers.get("Cache-Control")).toBe("private, no-cache");
		}
		const etag = current.headers.get("ETag") as string;
		const again = await call(boundaries, tenantB, `boundaries?level=1&v=${vB}`, {}, {
			"If-None-Match": etag,
		});
		expect(again.status).toBe(304);
	});

	it("serves each tenant's own outline in the map context, never another's", async () => {
		const vB = await mapDataVersion(tenantB);
		const res = await call(mapContext, tenantB, `map-context?v=${vB}`);
		expect(res.status).toBe(200);
		expect(res.headers.get("Cache-Control")).toContain("immutable");
		const body = await res.json();
		expect(Array.isArray(body.neighbours)).toBe(true);
		// Polygon or MultiPolygon: every other number is a longitude.
		const flat = (body.outline.geojson.coordinates as unknown[]).flat(
			Infinity,
		) as number[];
		const minLon = Math.min(...flat.filter((_, i) => i % 2 === 0));
		expect(minLon).toBeCloseTo(40, 3);
	});

	it("serves the world admin-0 layer as shared lines and ranked names", async () => {
		const res = await call(world, ids.countryAccountId, "world");
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(Array.isArray(body.labels)).toBe(true);
		if (body.lines) {
			expect(body.lines.type).toMatch(/LineString/);
			for (const l of body.labels) expect(l.minZoom).toBeGreaterThanOrEqual(0);
		}
	});

	it("serves MVT, 204 for an empty tile and 400 out of range", async () => {
		const full = await call(
			tile,
			ids.countryAccountId,
			"tiles/divisions/1/3/4/3",
			{
				level: "1",
				z: "3",
				x: "4",
				y: "3",
			},
		);
		expect(full.status).toBe(200);
		expect(full.headers.get("Content-Type")).toBe(
			"application/vnd.mapbox-vector-tile",
		);
		expect((await full.arrayBuffer()).byteLength).toBeGreaterThan(0);

		const empty = await call(
			tile,
			ids.countryAccountId,
			"tiles/divisions/1/5/19/15",
			{
				level: "1",
				z: "5",
				x: "19",
				y: "15",
			},
		);
		expect(empty.status).toBe(204);

		const bad = await call(
			tile,
			ids.countryAccountId,
			"tiles/divisions/1/3/9/0",
			{
				level: "1",
				z: "3",
				x: "9",
				y: "0",
			},
		);
		expect(bad.status).toBe(400);
	});
});
