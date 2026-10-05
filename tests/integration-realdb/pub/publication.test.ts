import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { sql } from "drizzle-orm";
import { generateKeyPairSync, randomUUID } from "crypto";
import { mkdirSync, writeFileSync } from "fs";
import path from "path";
import { dr } from "~/db.server";
import {
	createTestIds,
	createTestUser,
	cleanupTestUser,
	createOtherTenant,
	cleanupOtherTenant,
} from "../test-helpers";
import { refreshGeoReadModel } from "~/backend.server/models/geo/refresh";
import { getChoropleth, parseGeoQuery } from "~/backend.server/models/geo/queries";
import { GEO_MEASURES } from "~/utils/geoMeasures";
import { logAudit } from "~/backend.server/models/auditLogs";
import {
	contentDigest,
	tenantRef,
	verifySignature,
	type PubPackage,
} from "~/backend.server/models/pub/contract";
import {
	getPackage,
	grantShareSetting,
	listPackages,
	publishPackage,
	PubRefusalError,
	revokeShareSetting,
} from "~/backend.server/models/pub/publish";

// National publication path (ADR-11, T2). Fixture, tenant A:
//   R1 (level 1) > D1, D2 (level 2); R2 (level 1).
//   Published records with deaths in 2019-2021, one not reported, one
//   confirmed zero, one undated, one draft with 100 deaths (outside the
//   official basis). Tenant B: one published record with 50 deaths.
// Acceptance (design s8 T2): no consent, no package; withdrawal on revoke;
// package equal to G2 for the same scope; tenant isolation; signed
// publications only.

const ids = createTestIds();
ids.userEmail = ids.userEmail.replace("@", "-pubpublication@");
let tenantB = "";
let userB = "";
const ISO3 = `X${String.fromCharCode(65 + Math.floor(Math.random() * 26))}${String.fromCharCode(65 + Math.floor(Math.random() * 26))}`;

const div = { r1: randomUUID(), d1: randomUUID(), d2: randomUUID(), r2: randomUUID(), rb: randomUUID() };
const rec = {
	a1: randomUUID(), // D1, deaths 5, 2020
	a2: randomUUID(), // D1, deaths 3, 2021
	a3: randomUUID(), // D2, deaths not reported, 2020
	a4: randomUUID(), // D2, deaths confirmed 0, 2020
	a5: randomUUID(), // R2, deaths 7, 2019
	a6: randomUUID(), // D1, undated, deaths 1
	a7: randomUUID(), // D1, draft, deaths 100
	b1: randomUUID(), // tenant B, deaths 50
};

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const KEY = { keyId: "test-key-1", privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString() };
const PUBLIC_PEM = publicKey.export({ type: "spki", format: "pem" }).toString();

async function insertDivision(id: string, tenant: string, parent: string | null, level: number, env: string, nationalId: string) {
	await dr.execute(sql`
		INSERT INTO division (id, parent_id, country_accounts_id, name, level, national_id, import_id, geom, bbox)
		VALUES (${id}, ${parent}, ${tenant}, ${JSON.stringify({ en: nationalId })}::jsonb, ${level}, ${nationalId}, ${nationalId.toLowerCase()},
			${sql.raw(`ST_MakeEnvelope(${env}, 4326)`)}, ${sql.raw(`ST_MakeEnvelope(${env}, 4326)`)})
	`);
}

async function insertRecord(id: string, tenant: string, start: string, deaths: [boolean | null, number | null], divisionId: string, status = "published") {
	await dr.execute(sql`
		INSERT INTO disaster_records (id, country_accounts_id, "approvalStatus", start_date)
		VALUES (${id}, ${tenant}, ${status}, ${start})
	`);
	await dr.execute(sql`
		INSERT INTO human_category_presence (record_id, deaths, deaths_total) VALUES (${id}, ${deaths[0]}, ${deaths[1]})
	`);
	await dr.execute(sql`
		INSERT INTO disaster_records_division (disaster_record_id, division_id) VALUES (${id}, ${divisionId})
	`);
}

async function cleanupTenant(tenant: string) {
	await dr.execute(sql`DELETE FROM pub.package_outbox WHERE country_accounts_id = ${tenant}`);
	await dr.execute(sql`DELETE FROM pub.share_setting WHERE country_accounts_id = ${tenant}`);
	await dr.execute(sql`DELETE FROM geo.impact_atom WHERE country_accounts_id = ${tenant}`);
	await dr.execute(sql`DELETE FROM geo.division_ancestor WHERE country_accounts_id = ${tenant}`);
	await dr.execute(sql`DELETE FROM geo.division_geom_cache WHERE country_accounts_id = ${tenant}`);
	await dr.execute(sql`DELETE FROM geo.refresh_log WHERE country_accounts_id = ${tenant}`);
	await dr.execute(sql`
		DELETE FROM human_category_presence WHERE record_id IN (
			SELECT id FROM disaster_records WHERE country_accounts_id = ${tenant})
	`);
	await dr.execute(sql`
		DELETE FROM disaster_records_division WHERE disaster_record_id IN (
			SELECT id FROM disaster_records WHERE country_accounts_id = ${tenant})
	`);
	await dr.execute(sql`DELETE FROM disaster_records WHERE country_accounts_id = ${tenant}`);
	await dr.execute(sql`DELETE FROM division WHERE country_accounts_id = ${tenant} AND level = 2`);
	await dr.execute(sql`DELETE FROM division WHERE country_accounts_id = ${tenant}`);
}

async function dump(name: string, pkg: PubPackage) {
	const dir = process.env.PUB_DUMP_DIR;
	if (!dir) return;
	mkdirSync(dir, { recursive: true });
	writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(pkg, null, 1));
}

async function refusal(p: Promise<unknown>): Promise<string> {
	try {
		await p;
	} catch (e) {
		if (e instanceof PubRefusalError) return e.code;
		throw e;
	}
	return "NO_REFUSAL";
}

async function outboxCount(tenant: string) {
	const r = await dr.execute(sql`SELECT COUNT(*)::int AS n FROM pub.package_outbox WHERE country_accounts_id = ${tenant}`);
	return Number((r.rows[0] as { n: number }).n);
}

describe("national publication path (T2)", () => {
	beforeAll(async () => {
		await createTestUser(ids);
		tenantB = await createOtherTenant();
		userB = ids.userId;
		const a = ids.countryAccountId;
		await cleanupTenant(a);
		await dr.execute(sql`
			UPDATE countries SET iso3 = ${ISO3}
			WHERE id = (SELECT country_id FROM country_accounts WHERE id = ${a})
		`);

		await insertDivision(div.r1, a, null, 1, "0, 0, 10, 10", "R1");
		await insertDivision(div.r2, a, null, 1, "20, 0, 30, 10", "R2");
		await insertDivision(div.d1, a, div.r1, 2, "0, 0, 5, 5", "D1");
		await insertDivision(div.d2, a, div.r1, 2, "5, 0, 10, 5", "D2");
		await insertDivision(div.rb, tenantB, null, 1, "40, 0, 50, 10", "RB");

		await insertRecord(rec.a1, a, "2020-03-01", [true, 5], div.d1);
		await insertRecord(rec.a2, a, "2021", [true, 3], div.d1);
		await insertRecord(rec.a3, a, "2020", [null, null], div.d2);
		await insertRecord(rec.a4, a, "2020-06", [true, 0], div.d2);
		await insertRecord(rec.a5, a, "2019", [true, 7], div.r2);
		await insertRecord(rec.a6, a, "", [true, 1], div.d1);
		await insertRecord(rec.a7, a, "2020", [true, 100], div.d1, "draft");
		await insertRecord(rec.b1, tenantB, "2020", [true, 50], div.rb);

		await refreshGeoReadModel(a);
		await refreshGeoReadModel(tenantB);
	});

	afterAll(async () => {
		await cleanupTenant(ids.countryAccountId);
		await cleanupTenant(tenantB);
		await dr.execute(sql`
			UPDATE countries SET iso3 = NULL WHERE iso3 = ${ISO3}
		`);
		await cleanupOtherTenant();
		await cleanupTestUser(ids);
	});

	it("has every hand-written index", async () => {
		const res = await dr.execute(sql`SELECT indexname FROM pg_indexes WHERE schemaname = 'pub'`);
		const names = new Set((res.rows as { indexname: string }[]).map((r) => r.indexname));
		for (const n of ["pub_share_active_uq", "pub_share_tenant_idx", "pub_outbox_slice_idx", "pub_outbox_setting_idx", "pub_outbox_pending_idx"]) {
			expect(names.has(n)).toBe(true);
		}
	});

	it("refuses an unsigned publication in the database itself", async () => {
		const a = ids.countryAccountId;
		const s = await grantShareSetting(a, ids.userId, { dataset: "human_effects", tier: "public", adminLevel: 1 });
		await expect(
			dr.execute(sql`
				INSERT INTO pub.package_outbox (package_id, country_accounts_id, share_setting_id, dataset, tier, package_type,
					purpose, content_digest, signed, observation_count, payload, created_by)
				VALUES (${randomUUID()}, ${a}, ${s.id}, 'human_effects', 'public', 'replace', 'publication',
					${"sha256:" + "0".repeat(64)}, false, 0, '{}'::jsonb, ${ids.userId})
			`),
		).rejects.toThrow();
		await revokeShareSetting(a, ids.userId, s.id, KEY);
	});

	it("produces nothing without consent", async () => {
		const a = ids.countryAccountId;
		expect(await refusal(publishPackage(a, ids.userId, randomUUID(), { key: KEY }))).toBe("NO_ACTIVE_CONSENT");
		expect(await outboxCount(a)).toBe(0);
	});

	it("allows one active consent per dataset and tier, and logs the grant", async () => {
		const a = ids.countryAccountId;
		const s = await grantShareSetting(a, ids.userId, { dataset: "human_effects", tier: "global", adminLevel: 1 });
		expect(
			await refusal(grantShareSetting(a, ids.userId, { dataset: "human_effects", tier: "global", adminLevel: 2 })),
		).toBe("CONSENT_ALREADY_ACTIVE");
		expect(await refusal(grantShareSetting(a, ids.userId, { dataset: "money", tier: "global", adminLevel: 1 }))).toBe(
			"MALFORMED_REQUEST",
		);
		// test-helpers.ts mocks logAudit for every real-DB file, so the check is
		// that the grant logs its row inside its own transaction.
		expect(vi.isMockFunction(logAudit)).toBe(true);
		expect(vi.mocked(logAudit)).toHaveBeenCalledWith(
			expect.objectContaining({
				tableName: "pub.share_setting",
				recordId: s.id,
				userId: ids.userId,
				action: "INSERT",
				tx: expect.anything(),
			}),
		);
		await revokeShareSetting(a, ids.userId, s.id, KEY);
	});

	it("refuses a publisher with no role in the country account", async () => {
		const s = await grantShareSetting(ids.countryAccountId, ids.userId, { dataset: "human_effects", tier: "public", adminLevel: 1 });
		expect(await refusal(publishPackage(ids.countryAccountId, randomUUID(), s.id, { key: KEY }))).toBe(
			"PUBLISHER_NOT_A_MEMBER",
		);
		await revokeShareSetting(ids.countryAccountId, ids.userId, s.id, KEY);
	});

	it("refuses another tenant's consent", async () => {
		const sb = await grantShareSetting(tenantB, userB, { dataset: "human_effects", tier: "regional", adminLevel: 1 });
		expect(
			await refusal(publishPackage(ids.countryAccountId, ids.userId, sb.id, { key: KEY })),
		).toBe("NO_ACTIVE_CONSENT");
		await revokeShareSetting(tenantB, userB, sb.id, KEY);
	});

	describe("a regional publication at admin level 1", () => {
		let settingId = "";
		let pkg: PubPackage;

		beforeAll(async () => {
			const s = await grantShareSetting(ids.countryAccountId, ids.userId, {
				dataset: "human_effects",
				tier: "regional",
				adminLevel: 1,
				redistribution: "regional_only",
			});
			settingId = s.id;
		});

		it("is refused without a signing key, and nothing is written", async () => {
			expect(
				await refusal(publishPackage(ids.countryAccountId, ids.userId, settingId, { key: null })),
			).toBe("SIGNING_KEY_NOT_CONFIGURED");
			expect(await outboxCount(ids.countryAccountId)).toBe(0);
		});

		it("is signed, hashed and verifiable", async () => {
			pkg = await publishPackage(ids.countryAccountId, ids.userId, settingId, {
				key: KEY,
				minCellRecords: null,
			});
			await dump("t2_publication", pkg);
			const { integrity, ...body } = pkg;
			expect(integrity.content_digest).toBe(contentDigest(body));
			expect(verifySignature(integrity.content_digest, integrity.signature!, PUBLIC_PEM)).toBe(true);
			expect(pkg.header.publisher.tenant_ref).toBe(tenantRef(ids.countryAccountId));
			expect(JSON.stringify(pkg)).not.toContain(ids.countryAccountId);
			expect(pkg.header.publisher.iso3).toBe(ISO3);
			expect(pkg.header.basis).toEqual({ record_statuses: ["published"], label: "official" });
			expect(pkg.header.purpose).toBe("publication");
			expect(pkg.header.consent.granted_by_role).toBe("admin");
			expect(pkg.header.suppression).toEqual({ applied: false, rule: null });
			expect(pkg.header.slice).toMatchObject({ admin_level: 1, period_from: "2019", period_to: "2021" });
		});

		it("round-trips through the outbox unchanged", async () => {
			const stored = await getPackage(ids.countryAccountId, pkg.header.package_id);
			const { integrity, ...body } = stored!;
			expect(contentDigest(body)).toBe(integrity.content_digest);
			const list = await listPackages(ids.countryAccountId);
			expect(list[0]).toMatchObject({ packageId: pkg.header.package_id, signed: true, status: "pending", tier: "regional" });
		});

		it("excludes drafts and other tenants, and keeps null apart from zero", () => {
			const deaths = pkg.observations.filter((o) => o.measure === "deaths");
			const total = deaths.reduce((s, o) => s + (o.value_state === "reported" ? (o.value as number) : 0), 0);
			expect(total).toBe(5 + 3 + 7);
			const r1_2020 = deaths.find((o) => o.division_key === "R1" && o.period === "2020")!;
			expect(r1_2020).toMatchObject({ value: 5, value_state: "reported", records_total: 3, records_not_reported: 1, records_zero_confirmed: 1 });
			expect(pkg.observations.some((o) => o.division_key === "RB")).toBe(false);
			for (const o of pkg.observations) {
				if (o.value_state === "not_reported" || o.value_state === "insufficient_reporting") {
					expect(o.value).toBeNull();
				}
			}
			const u = pkg.unattributed.find((x) => x.measure === "deaths")!;
			expect(u).toEqual({ measure: "deaths", records: 1, reasons: { undated: 1 } });
		});

		it("equals the G2 choropleth for every division and measure", async () => {
			for (const measure of GEO_MEASURES) {
				const g2 = await getChoropleth(
					ids.countryAccountId,
					parseGeoQuery(new URLSearchParams({ measure, level: "1", from: "2019", to: "2021" }), {
						requireMeasure: true,
						requireLevel: true,
					}),
				);
				const nationalId = new Map<string, string>([[div.r1, "R1"], [div.r2, "R2"]]);
				const mine = pkg.observations.filter((o) => o.measure === measure);
				for (const cell of g2.cells) {
					const parts = mine.filter((o) => o.division_key === nationalId.get(cell.divisionId));
					const sum = (f: (o: (typeof parts)[number]) => number) => parts.reduce((s, o) => s + f(o), 0);
					expect(sum((o) => o.records_total)).toBe(cell.recordsTotal);
					expect(sum((o) => o.records_reported)).toBe(cell.recordsReported);
					expect(sum((o) => o.records_zero_confirmed)).toBe(cell.recordsZeroConfirmed);
					expect(sum((o) => o.plausibility_flagged_records)).toBe(cell.plausibilityFlaggedRecords);
					for (const g of ["A", "B", "C", "D"] as const) {
						expect(sum((o) => o.grade_distribution[g])).toBe(cell.gradeDistribution[g]);
					}
					const reportedSum = sum((o) => (o.value_state === "reported" ? (o.value as number) : 0));
					expect(reportedSum).toBe(cell.valueState === "reported" ? cell.value : 0);
				}
				expect(new Set(mine.map((o) => o.division_key)).size).toBe(g2.cells.length);
			}
		});

		it("chains the next package to the previous one", async () => {
			const next = await publishPackage(ids.countryAccountId, ids.userId, settingId, { key: KEY, minCellRecords: null });
			expect(next.header.previous_package_id).toBe(pkg.header.package_id);
			pkg = next;
		});

		it("suppresses small cells when a threshold is set, and says so", async () => {
			const s = await publishPackage(ids.countryAccountId, ids.userId, settingId, { key: KEY, minCellRecords: 2 });
			await dump("t2_publication_suppressed", s);
			expect(s.header.suppression.applied).toBe(true);
			const suppressed = s.observations.filter((o) => o.value_state === "suppressed");
			expect(suppressed.length).toBeGreaterThan(0);
			for (const o of suppressed) {
				expect(o.value).toBeNull();
				expect(o.obs_status).toBe("Q");
			}
			pkg = s;
		});

		it("withdraws the slice in the same transaction as the revoke", async () => {
			const r = await revokeShareSetting(ids.countryAccountId, ids.userId, settingId, KEY);
			expect(r.setting.revokedAt).not.toBeNull();
			const w = await getPackage(ids.countryAccountId, r.withdrawPackageId!);
			await dump("t2_withdraw", w!);
			expect(w!.header).toMatchObject({ package_type: "withdraw", previous_package_id: pkg.header.package_id });
			expect(w!.observations).toEqual([]);
			expect(verifySignature(w!.integrity.content_digest, w!.integrity.signature!, PUBLIC_PEM)).toBe(true);
			expect(await refusal(publishPackage(ids.countryAccountId, ids.userId, settingId, { key: KEY }))).toBe(
				"NO_ACTIVE_CONSENT",
			);
		});
	});

	it("writes no withdrawal when nothing was sent under the consent", async () => {
		const s = await grantShareSetting(ids.countryAccountId, ids.userId, { dataset: "human_effects", tier: "regional", adminLevel: 1 });
		const r = await revokeShareSetting(ids.countryAccountId, ids.userId, s.id, KEY);
		// The earlier regional slice was already withdrawn, so the last package is a withdrawal.
		expect(r.withdrawPackageId).toBeNull();
	});

	it("builds an unsigned specification test on every status, labelled as a test", async () => {
		const s = await grantShareSetting(ids.countryAccountId, ids.userId, { dataset: "human_effects", tier: "global", adminLevel: 1 });
		const t = await publishPackage(ids.countryAccountId, ids.userId, s.id, {
			purpose: "specification_test",
			key: null,
			minCellRecords: null,
		});
		await dump("t2_specification_test", t);
		expect(t.header.basis.label).toBe("test_only");
		expect(t.integrity.signature).toBeNull();
		const deaths = t.observations.filter((o) => o.measure === "deaths");
		expect(deaths.reduce((x, o) => x + (o.value_state === "reported" ? (o.value as number) : 0), 0)).toBe(5 + 3 + 7 + 100);
		await revokeShareSetting(ids.countryAccountId, ids.userId, s.id, null);
	});

	it("never returns a package to another tenant", async () => {
		const list = await listPackages(ids.countryAccountId);
		expect(list.length).toBeGreaterThan(0);
		expect(await getPackage(tenantB, list[0].packageId)).toBeNull();
		expect(await listPackages(tenantB)).toEqual([]);
	});
});
