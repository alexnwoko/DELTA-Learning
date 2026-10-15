import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { SQL, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import path from "path";
import { dr } from "~/db.server";
import {
	createTestIds,
	createTestUser,
	cleanupTestUser,
} from "../test-helpers";
import { createTestBackendContext } from "~/backend.server/context";
import { jsonUpsert } from "~/backend.server/handlers/form/form_api";
import {
	clear as clearHumanEffects,
	saveHumanEffectsData,
} from "~/backend.server/handlers/human_effects";
import {
	categoryPresenceSet,
	defsForTable,
} from "~/backend.server/models/human_effects";
import { HumanEffectsTableFromString } from "~/frontend/human_effects/defs";
import {
	disasterRecordsCreate,
	disasterRecordsUpdate,
	disasterRecordsIdByImportIdAndCountryAccountsId,
} from "~/backend.server/models/disaster_record";
import { fieldsDefApi } from "~/frontend/disaster-record/form";
import {
	getAffectedPeopleByHazardFilters,
	getTotalDeathsByDivision,
} from "~/backend.server/models/analytics/hazard-analysis";
import {
	RECONCILIATION_MEASURES,
	reconciliationBasis,
	reconciliationReadBack,
	reconciliationRecordBasis,
} from "~/backend.server/models/reconciliationBasis.server";

// C29 (solution pack): the migrated-record fixture, loaded through the same
// handlers the loader's API calls reach (record upsert, human-effects clear
// and save, category presence), never by SQL inserts. The analytics outputs
// are then checked against the expected ledger, which
// scripts/c29/build_migrated_fixture.py computed with the loader's own
// he_measure_state and compute_plausibility_flags. Every figure is read
// through the C23 reconciliation basis, so the draft records count.
//
// Only the tenant's division tree is inserted by SQL: it is reference data
// that the loader expects to exist (the runbook imports it first), with a
// small synthetic square per division in place of real boundaries.

const FIXTURE_DIR = path.resolve(__dirname, "../../fixtures/migrated");
const load = JSON.parse(
	readFileSync(path.join(FIXTURE_DIR, "ago_fixture_load.json"), "utf8"),
);
const ledger = JSON.parse(
	readFileSync(path.join(FIXTURE_DIR, "ago_fixture_ledger.json"), "utf8"),
);

type LedgerMeasure = {
	sum: number | null;
	reported: number;
	zero_confirmed: number;
	not_reported: number;
	records_total: number;
	flagged: number;
	value_state: string;
};

const ids = createTestIds();
ids.userEmail = ids.userEmail.replace("@", "-c29fixture@");
const divisionIds = new Map<string, string>();
const recordIds = new Map<string, string>();

const filters = (geographicLevelId: string | null = null) =>
	({
		countryAccountsId: ids.countryAccountId,
		audience: "public",
		hazardTypeId: null,
		hazardClusterId: null,
		specificHazardId: null,
		geographicLevelId,
		fromDate: null,
		toDate: null,
	}) as any;

const scope = () => ({
	countryAccountsId: ids.countryAccountId,
	runId: load.runId as string,
});

function expectedMeasure(m: LedgerMeasure) {
	return {
		value: m.value_state === "zero_confirmed" ? 0 : m.sum,
		valueState: m.value_state,
		recordsReported: m.reported,
		recordsZeroConfirmed: m.zero_confirmed,
		recordsNotReported: m.not_reported,
		recordsTotal: m.records_total,
		recordsFlagged: m.flagged,
	};
}

function square(i: number) {
	const x = 12 + (i % 10) * 0.5;
	const y = -18 + Math.floor(i / 10) * 0.5;
	return {
		type: "Polygon",
		coordinates: [
			[
				[x, y],
				[x + 0.4, y],
				[x + 0.4, y + 0.4],
				[x, y + 0.4],
				[x, y],
			],
		],
	};
}

async function hipIds(code: string) {
	const res = await dr.execute(sql`
		SELECT h.id AS hazard, c.id AS cluster, c.type_id AS type
		FROM hip_hazard h JOIN hip_cluster c ON c.id = h.cluster_id
		WHERE h.code = ${code}
	`);
	const row = res.rows[0] as Record<string, string> | undefined;
	if (!row) throw new Error(`HIPs code ${code} not in hip_hazard`);
	return row;
}

describe("C29 migrated-record fixture through the real handlers", () => {
	beforeAll(async () => {
		await createTestUser(ids);

		// Division tree (reference data), parents first.
		const divisions = [...load.divisions].sort(
			(a: any, b: any) => a.level - b.level,
		);
		divisions.forEach((d: any, i: number) => {
			divisionIds.set(d.importId, randomUUID());
			d._geo = square(i);
		});
		for (const d of divisions) {
			await dr.execute(sql`
				INSERT INTO division (id, country_accounts_id, import_id, parent_id, level, name, geojson)
				VALUES (${divisionIds.get(d.importId)}, ${ids.countryAccountId}, ${d.importId},
					${d.parentImportId ? divisionIds.get(d.parentImportId) : null}, ${d.level},
					${JSON.stringify({ en: d.name })}::jsonb, ${JSON.stringify(d._geo)}::jsonb)
			`);
		}

		// Records: the loader's payloads, with division and HIPs ids resolved
		// against this database as the loader does against its target.
		const data = [];
		for (const r of load.records) {
			const p = JSON.parse(JSON.stringify(r.payload));
			p.countryAccountsId = ids.countryAccountId;
			if (r.divisionImportId) {
				p.spatialFootprint[0].division_id = divisionIds.get(r.divisionImportId);
			}
			if (r.hipCode) {
				const h = await hipIds(r.hipCode);
				p.hipHazardId = h.hazard;
				p.hipClusterId = h.cluster;
				p.hipTypeId = h.type;
			} else if (r.hipClusterOfCode) {
				// A cluster-only record must name the hazard as null: the
				// validator rejects HIPs fields without hipHazardId.
				const h = await hipIds(r.hipClusterOfCode);
				p.hipHazardId = null;
				p.hipClusterId = h.cluster;
				p.hipTypeId = h.type;
			}
			data.push(p);
		}
		const ctx = createTestBackendContext();
		const upsert = await jsonUpsert({
			ctx,
			data,
			fieldsDef: [
				...fieldsDefApi(ctx),
				{ key: "countryAccountsId", label: "", type: "text" },
			] as any,
			create: disasterRecordsCreate,
			update: (c: any, tx: any, id: string, fields: any) =>
				disasterRecordsUpdate(c, tx, id, fields, ids.countryAccountId),
			idByImportIdAndCountryAccountsId:
				disasterRecordsIdByImportIdAndCountryAccountsId,
			countryAccountsId: ids.countryAccountId,
		});
		expect(
			upsert.ok,
			JSON.stringify({
				error: upsert.error,
				failed: upsert.res
					.map((x: any, i: number) =>
						x.ok ? null : [load.records[i].apiImportId, x],
					)
					.filter(Boolean),
			}).slice(0, 3000),
		).toBe(true);
		upsert.res.forEach((res: any, i: number) => {
			recordIds.set(load.records[i].apiImportId, res.id);
		});

		// Human effects in the loader's order per table: clear, save when a
		// value row exists, then category presence last.
		for (const r of load.records) {
			const rid = recordIds.get(r.apiImportId)!;
			for (const job of r.humanEffects) {
				const cleared = await clearHumanEffects(
					job.table,
					rid,
					ids.countryAccountId,
				);
				expect((await cleared.json()).ok).toBe(true);
				if (job.hasData) {
					const req = new Request(
						`http://localhost/api/human-effects/save?recordId=${rid}`,
						{ method: "POST", body: JSON.stringify(job.body) },
					);
					const saved = await saveHumanEffectsData(
						ctx,
						req,
						rid,
						ids.countryAccountId,
					);
					const body = await saved.json();
					expect(body.ok, JSON.stringify(body)).toBe(true);
				}
				// category-presence-save: the same key check, then the setter.
				const tbl = HumanEffectsTableFromString(job.table);
				const defs = await defsForTable(ctx, dr, tbl, ids.countryAccountId);
				const valid = new Set(
					defs
						.filter((d) => d.role === "metric" && !d.custom)
						.map((d) => d.jsName),
				);
				for (const k of Object.keys(job.presence)) {
					expect(valid.has(k), `${job.table}.${k}`).toBe(true);
				}
				await categoryPresenceSet(dr, rid, tbl, defs, job.presence);
			}
		}
	}, 240_000);

	afterAll(async () => {
		const recs = sql`SELECT id FROM disaster_records WHERE country_accounts_id = ${ids.countryAccountId}`;
		for (const t of ["deaths", "injured", "missing", "affected", "displaced"]) {
			await dr.execute(
				sql`DELETE FROM ${sql.identifier(t)} WHERE dsg_id IN (SELECT id FROM human_dsg WHERE record_id IN (${recs}))`,
			);
		}
		await dr.execute(sql`DELETE FROM human_dsg WHERE record_id IN (${recs})`);
		await dr.execute(
			sql`DELETE FROM human_category_presence WHERE record_id IN (${recs})`,
		);
		await dr.execute(
			sql`DELETE FROM disaster_records_division WHERE disaster_record_id IN (${recs})`,
		);
		await dr.execute(
			sql`DELETE FROM disaster_records WHERE country_accounts_id = ${ids.countryAccountId}`,
		);
		const levels = [...load.divisions]
			.map((d: any) => d.level)
			.sort((a: number, b: number) => b - a);
		for (const level of [...new Set(levels)]) {
			await dr.execute(
				sql`DELETE FROM division WHERE country_accounts_id = ${ids.countryAccountId} AND level = ${level}`,
			);
		}
		await cleanupTestUser(ids);
	}, 120_000);

	it("loads every record as draft under the fixture run id", async () => {
		const rb = await reconciliationReadBack(scope());
		expect(rb.records).toBe(ledger.records);
		expect(rb.byApprovalStatus).toEqual({ draft: ledger.records });
	});

	it("reads back each measure as the ledger states (flag and total)", async () => {
		const rb = await reconciliationReadBack(scope());
		for (const m of RECONCILIATION_MEASURES) {
			const e: LedgerMeasure = ledger.national[m];
			// The native explicit No stores flag false with no total.
			const native = m === "deaths" ? 1 : 0;
			expect(rb.measures[m].valuePositive, m).toBe(e.reported);
			expect(rb.measures[m].sum, m).toBe(e.sum ?? 0);
			expect(rb.measures[m].totalZero, m).toBe(e.zero_confirmed - native);
			expect(rb.measures[m].totalNull, m).toBe(
				e.records_total - e.reported - (e.zero_confirmed - native),
			);
			expect(rb.measures[m].flagFalse, m).toBe(native);
		}
	});

	it("keeps drafts out of the public basis (C23)", async () => {
		const res = await getAffectedPeopleByHazardFilters(filters());
		expect(res.measures.deaths.recordsTotal).toBe(0);
		expect(res.totalDeaths).toBeNull();
	});

	it("national headline matches the ledger on the reconciliation basis", async () => {
		const res = await getAffectedPeopleByHazardFilters(
			filters(),
			reconciliationRecordBasis(scope()),
		);
		for (const m of RECONCILIATION_MEASURES) {
			expect(res.measures[m], m).toEqual(expectedMeasure(ledger.national[m]));
		}
		expect(res.totalDeaths).toBe(ledger.national.deaths.sum);
	});

	it("deaths division map matches the ledger per province", async () => {
		const rows = await getTotalDeathsByDivision(
			filters(),
			reconciliationRecordBasis(scope()),
		);
		const byImport = new Map(
			[...divisionIds.entries()].map(([imp, id]) => [id, imp]),
		);
		const got = Object.fromEntries(
			rows
				.filter((r) => byImport.has(r.divisionId))
				.map((r) => [byImport.get(r.divisionId), r.measure]),
		);
		expect(Object.keys(got).sort()).toEqual(
			Object.keys(ledger.deaths_by_level1).sort(),
		);
		for (const [imp, e] of Object.entries<any>(ledger.deaths_by_level1)) {
			expect(got[imp].valueState, imp).toBe(e.value_state);
			expect(got[imp].value, imp).toBe(
				e.value_state === "zero_confirmed" ? 0 : e.sum,
			);
			expect(got[imp].recordsReported, imp).toBe(e.reported);
			expect(got[imp].recordsZeroConfirmed, imp).toBe(e.zero_confirmed);
			expect(got[imp].recordsTotal, imp).toBe(e.records_total);
			expect(got[imp].recordsFlagged, imp).toBe(e.flagged);
		}
	});

	it("province headline matches the ledger for Benguela", async () => {
		const benguela = divisionIds.get(
			ledger.benguela_province.level1_import_id,
		)!;
		const res = await getAffectedPeopleByHazardFilters(
			filters(benguela),
			reconciliationRecordBasis(scope()),
		);
		for (const m of RECONCILIATION_MEASURES) {
			expect(res.measures[m], m).toEqual(
				expectedMeasure(ledger.benguela_province.measures[m]),
			);
		}
	});

	it("applies the coverage rule to Lobito: missing is 1 confirmed zero of 9", async () => {
		// Analytics aggregates to level 1 only, so the municipality is scoped
		// by narrowing the reconciliation basis to Lobito and its children.
		const lobito = divisionIds.get(ledger.benguela_lobito.level2_import_id)!;
		const inLobito = (alias: string): SQL => sql`(${reconciliationBasis(
			scope(),
			alias,
		)} AND EXISTS (
			WITH RECURSIVE t AS (
				SELECT id FROM division WHERE id = ${lobito}::uuid
				UNION ALL SELECT d.id FROM division d JOIN t ON d.parent_id = t.id
			)
			SELECT 1 FROM disaster_records_division drd
			WHERE drd.disaster_record_id = ${sql.identifier(alias)}.id
				AND drd.division_id IN (SELECT id FROM t)
		))`;
		const res = await getAffectedPeopleByHazardFilters(filters(), inLobito);
		expect(res.measures.missing).toEqual(
			expectedMeasure(ledger.benguela_lobito.measures.missing),
		);
		expect(res.measures.missing.valueState).toBe("insufficient_reporting");
		expect(res.measures.missing.value).toBeNull();
		for (const m of RECONCILIATION_MEASURES) {
			expect(res.measures[m], m).toEqual(
				expectedMeasure(ledger.benguela_lobito.measures[m]),
			);
		}
	});

	it("stores each C30 flag code and the flagged record count", async () => {
		const res = await dr.execute(sql`
			SELECT COUNT(*) FILTER (WHERE jsonb_array_length(legacy_data -> 'migration' -> 'plausibility_flags') > 0)::int AS flagged,
				ARRAY(
					SELECT DISTINCT f ->> 'code'
					FROM disaster_records d2, jsonb_array_elements(d2.legacy_data -> 'migration' -> 'plausibility_flags') f
					WHERE d2.country_accounts_id = ${ids.countryAccountId}
					ORDER BY 1
				) AS codes
			FROM disaster_records
			WHERE country_accounts_id = ${ids.countryAccountId}
		`);
		expect(res.rows[0].flagged).toBe(ledger.records_flagged);
		expect(res.rows[0].codes).toEqual(ledger.flag_codes);
	});

	it("stores hazards, dates and footprints as the loader sends them", async () => {
		const res = await dr.execute(sql`
			SELECT dr.api_import_id AS import_id, h.code, dr.hip_cluster_id AS cluster,
				dr.hip_hazard_id AS hazard, dr.start_date,
				(SELECT COUNT(*)::int FROM disaster_records_division drd WHERE drd.disaster_record_id = dr.id) AS divisions
			FROM disaster_records dr
			LEFT JOIN hip_hazard h ON h.id = dr.hip_hazard_id
			WHERE dr.country_accounts_id = ${ids.countryAccountId}
		`);
		const byId = Object.fromEntries(
			(res.rows as any[]).map((r) => [r.import_id, r]),
		);
		for (const r of load.records) {
			const row = byId[r.apiImportId];
			expect(row, r.apiImportId).toBeDefined();
			expect(row.code ?? null, r.apiImportId).toBe(r.hipCode);
			expect(row.start_date ?? null, r.apiImportId).toBe(
				r.payload.startDate ?? null,
			);
			expect(row.divisions > 0, r.apiImportId).toBe(!!r.divisionImportId);
			if (r.hipClusterOfCode) {
				expect(row.hazard).toBeNull();
				expect(row.cluster).toBe((await hipIds(r.hipClusterOfCode)).cluster);
			}
		}
		// The pre-fix GH0101 card and the ECU volcanic cards resolved to the
		// DEC-004 codes.
		const codes = load.records.map((r: any) => r.hipCode);
		expect(codes).toContain("GH0201");
		expect(codes).toContain("GH0202");
		expect(codes).toContain("GH0205");
	});
});
