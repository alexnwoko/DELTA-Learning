// National publication path (ADR-11, T2): consent, package build, outbox and
// withdrawal. Every write happens in one transaction with its audit row, so a
// package exists if and only if the action that produced it committed.

import { randomUUID } from "crypto";
import { sql, type SQL } from "drizzle-orm";
import { dr, type Tx } from "~/db.server";
import { logAudit } from "~/backend.server/models/auditLogs";
import { refreshGeoReadModel } from "~/backend.server/models/geo/refresh";
import { GEO_MEASURES, GEO_METHOD_VERSION, type GeoMeasure } from "~/utils/geoMeasures";
import { measureValue, PROVISIONAL_ZERO_COVERAGE } from "~/utils/valueState";
import {
	applySuppression,
	contentDigest,
	OBS_STATUS,
	PUB_DATASETS,
	PUB_HIP_LEVELS,
	PUB_REDISTRIBUTION,
	PUB_SCHEMA,
	PUB_TIERS,
	signDigest,
	signingKeyFromEnv,
	suppressionThresholdFromEnv,
	tenantRef,
	type PubDataset,
	type PubHeader,
	type PubHipLevel,
	type PubObservation,
	type PubPackage,
	type PubPurpose,
	type PubRedistribution,
	type PubSigningKey,
	type PubTier,
	type PubUnattributed,
} from "./contract";

/** The same minimum attribution grade as the G2 default (queries.ts). */
const PUB_MIN_ATT_GRADE = "C";
const OFFICIAL_BASIS = ["published"];
const TEST_BASIS = ["published", "validated", "waiting-for-validation", "needs-revision", "draft"];
const APPLICATION_VERSION = "delta.pub/1 builder (v2/federation)";

export type PubRefusalCode =
	| "MALFORMED_REQUEST"
	| "NO_ACTIVE_CONSENT"
	| "CONSENT_ALREADY_ACTIVE"
	| "SIGNING_KEY_NOT_CONFIGURED"
	| "NO_RECORDS_IN_BASIS"
	| "COUNTRY_ISO3_MISSING"
	| "PUBLISHER_NOT_A_MEMBER";

export class PubRefusalError extends Error {
	constructor(
		public code: PubRefusalCode,
		message: string,
		public status = 422,
	) {
		super(message);
	}
}

export interface ShareSetting {
	id: string;
	countryAccountsId: string;
	dataset: PubDataset;
	tier: PubTier;
	adminLevel: number;
	hipLevel: PubHipLevel;
	redistribution: PubRedistribution;
	grantedBy: string;
	grantedAt: string;
	revokedAt: string | null;
}

interface ShareSettingRow {
	id: string;
	country_accounts_id: string;
	dataset: PubDataset;
	tier: PubTier;
	admin_level: number;
	hip_level: PubHipLevel;
	redistribution: PubRedistribution;
	granted_by: string;
	granted_at: string | Date;
	revoked_at: string | Date | null;
}

const iso = (v: string | Date | null) => (v === null ? null : new Date(v).toISOString());

function toSetting(r: ShareSettingRow): ShareSetting {
	return {
		id: r.id,
		countryAccountsId: r.country_accounts_id,
		dataset: r.dataset,
		tier: r.tier,
		adminLevel: Number(r.admin_level),
		hipLevel: r.hip_level,
		redistribution: r.redistribution,
		grantedBy: r.granted_by,
		grantedAt: iso(r.granted_at)!,
		revokedAt: iso(r.revoked_at),
	};
}

export interface GrantInput {
	dataset: string;
	tier: string;
	adminLevel: number;
	hipLevel?: string;
	redistribution?: string;
}

function parseGrant(input: GrantInput) {
	const dataset = input.dataset as PubDataset;
	const tier = input.tier as PubTier;
	const hipLevel = (input.hipLevel ?? "type") as PubHipLevel;
	const redistribution = (input.redistribution ?? "none") as PubRedistribution;
	if (
		!PUB_DATASETS.includes(dataset) ||
		!PUB_TIERS.includes(tier) ||
		!PUB_HIP_LEVELS.includes(hipLevel) ||
		!PUB_REDISTRIBUTION.includes(redistribution) ||
		!Number.isInteger(input.adminLevel) ||
		input.adminLevel < 0
	) {
		throw new PubRefusalError("MALFORMED_REQUEST", "Invalid share setting.", 400);
	}
	return { dataset, tier, hipLevel, redistribution, adminLevel: input.adminLevel };
}

export async function listShareSettings(countryAccountsId: string): Promise<ShareSetting[]> {
	const res = await dr.execute(sql`
		SELECT * FROM pub.share_setting WHERE country_accounts_id = ${countryAccountsId}
		ORDER BY granted_at DESC, id
	`);
	return (res.rows as unknown as ShareSettingRow[]).map(toSetting);
}

/** Grants consent for one dataset and tier. One active consent per pair. */
export async function grantShareSetting(
	countryAccountsId: string,
	userId: string,
	input: GrantInput,
): Promise<ShareSetting> {
	const g = parseGrant(input);
	return dr.transaction(async (tx) => {
		const active = await tx.execute(sql`
			SELECT id FROM pub.share_setting
			WHERE country_accounts_id = ${countryAccountsId} AND dataset = ${g.dataset}
				AND tier = ${g.tier} AND revoked_at IS NULL
			FOR UPDATE
		`);
		if (active.rows.length > 0) {
			throw new PubRefusalError(
				"CONSENT_ALREADY_ACTIVE",
				"An active consent exists for this dataset and tier. Revoke it first.",
				409,
			);
		}
		const res = await tx.execute(sql`
			INSERT INTO pub.share_setting (country_accounts_id, dataset, tier, admin_level, hip_level, redistribution, granted_by)
			VALUES (${countryAccountsId}, ${g.dataset}, ${g.tier}, ${g.adminLevel}, ${g.hipLevel}, ${g.redistribution}, ${userId})
			RETURNING *
		`);
		const setting = toSetting(res.rows[0] as unknown as ShareSettingRow);
		await logAudit({
			tableName: "pub.share_setting",
			recordId: setting.id,
			userId,
			action: "INSERT",
			newValues: setting,
			tx,
		});
		return setting;
	});
}

async function lockActiveSetting(tx: Tx, countryAccountsId: string, settingId: string) {
	const res = await tx.execute(sql`
		SELECT * FROM pub.share_setting
		WHERE id = ${settingId} AND country_accounts_id = ${countryAccountsId} AND revoked_at IS NULL
		FOR UPDATE
	`);
	if (res.rows.length === 0) {
		throw new PubRefusalError(
			"NO_ACTIVE_CONSENT",
			"No active consent with this id for this country. Nothing is published without consent.",
			404,
		);
	}
	return toSetting(res.rows[0] as unknown as ShareSettingRow);
}

interface OutboxRow {
	package_id: string;
	package_type: "replace" | "withdraw";
	purpose: PubPurpose;
	payload: PubPackage;
}

async function lastPackage(tx: Tx, countryAccountsId: string, dataset: string, tier: string) {
	const res = await tx.execute(sql`
		SELECT package_id, package_type, purpose, payload FROM pub.package_outbox
		WHERE country_accounts_id = ${countryAccountsId} AND dataset = ${dataset} AND tier = ${tier}
		ORDER BY created_at DESC, package_id DESC LIMIT 1
	`);
	return (res.rows[0] as unknown as OutboxRow | undefined) ?? null;
}

async function insertPackage(
	tx: Tx,
	countryAccountsId: string,
	setting: ShareSetting,
	pkg: PubPackage,
	userId: string,
) {
	await tx.execute(sql`
		INSERT INTO pub.package_outbox (package_id, country_accounts_id, share_setting_id, dataset, tier,
			package_type, purpose, previous_package_id, content_digest, signed, observation_count, payload, created_by)
		VALUES (${pkg.header.package_id}, ${countryAccountsId}, ${setting.id}, ${setting.dataset}, ${setting.tier},
			${pkg.header.package_type}, ${pkg.header.purpose}, ${pkg.header.previous_package_id},
			${pkg.integrity.content_digest}, ${pkg.integrity.signature !== null}, ${pkg.observations.length},
			${JSON.stringify(pkg)}::jsonb, ${userId})
	`);
	await logAudit({
		tableName: "pub.package_outbox",
		recordId: pkg.header.package_id,
		userId,
		action: "INSERT",
		newValues: {
			package_type: pkg.header.package_type,
			purpose: pkg.header.purpose,
			share_setting_id: setting.id,
			content_digest: pkg.integrity.content_digest,
			observations: pkg.observations.length,
		},
		tx,
	});
}

function seal(
	body: Omit<PubPackage, "integrity">,
	purpose: PubPurpose,
	key: PubSigningKey | null,
): PubPackage {
	const digest = contentDigest(body);
	if (purpose === "publication" && !key) {
		throw new PubRefusalError(
			"SIGNING_KEY_NOT_CONFIGURED",
			"A publication must be signed. No signing key is configured for this instance (TBD-decision: key custody).",
		);
	}
	return {
		...body,
		integrity: { content_digest: digest, signature: key ? signDigest(digest, key) : null },
	};
}

/** Revokes a consent and, if anything was sent under it, withdraws the slice. */
export async function revokeShareSetting(
	countryAccountsId: string,
	userId: string,
	settingId: string,
	key: PubSigningKey | null = signingKeyFromEnv(),
): Promise<{ setting: ShareSetting; withdrawPackageId: string | null }> {
	return dr.transaction(async (tx) => {
		const setting = await lockActiveSetting(tx, countryAccountsId, settingId);
		const last = await lastPackage(tx, countryAccountsId, setting.dataset, setting.tier);
		let withdrawPackageId: string | null = null;
		if (last && last.package_type === "replace") {
			const prev = last.payload.header;
			const header: PubHeader = {
				...prev,
				package_id: randomUUID(),
				package_type: "withdraw",
				created_at: new Date().toISOString(),
				previous_package_id: last.package_id,
			};
			const pkg = seal(
				{ schema: PUB_SCHEMA, header, observations: [], unattributed: [] },
				last.purpose,
				key,
			);
			await insertPackage(tx, countryAccountsId, setting, pkg, userId);
			withdrawPackageId = header.package_id;
		}
		const res = await tx.execute(sql`
			UPDATE pub.share_setting SET revoked_at = now(), revoked_by = ${userId}
			WHERE id = ${setting.id} RETURNING *
		`);
		const revoked = toSetting(res.rows[0] as unknown as ShareSettingRow);
		await logAudit({
			tableName: "pub.share_setting",
			recordId: setting.id,
			userId,
			action: "UPDATE",
			oldValues: setting,
			newValues: revoked,
			tx,
		});
		return { setting: revoked, withdrawPackageId };
	});
}

const HIP_COLUMN: Record<PubHipLevel, SQL> = {
	type: sql.raw("hip_type_id"),
	cluster: sql.raw("hip_cluster_id"),
	hazard: sql.raw("hip_hazard_id"),
};

interface CellRow {
	division_id: string;
	national_id: string | null;
	period: string;
	hip_code: string;
	sum_reported: string | null;
	reported: string;
	zero_confirmed: string;
	total: string;
	flagged: string;
	grade_a: string;
	grade_b: string;
	grade_c: string;
	grade_d: string;
}

/**
 * The G2 placement (`aggregateAtLevel` in models/geo/queries.ts) with two
 * extra group keys, the start year and the hazard node. A record is placed
 * once per target division, by its best attribution grade. The real-DB test
 * holds the package equal to getChoropleth for every division and measure.
 */
function placedCte(
	t: string,
	measure: GeoMeasure,
	statuses: string[],
	level: number,
	hipLevel: PubHipLevel,
	from: string,
	to: string,
) {
	const hip = HIP_COLUMN[hipLevel];
	return sql`
		scope AS (
			SELECT a.* FROM geo.impact_atom a
			WHERE a.country_accounts_id = ${t}
				AND a.record_status IN (${sql.join(statuses.map((s) => sql`${s}`), sql`, `)})
				AND a.measure = ${measure}
		),
		ranged AS (
			SELECT * FROM scope a WHERE a.start_instant IS NOT NULL
				AND a.end_instant >= geo.date_floor(${from}) AND a.start_instant <= geo.date_ceil(${to})
		),
		graded AS (
			SELECT * FROM ranged a WHERE a.att_grade IS NULL OR a.att_grade <= ${PUB_MIN_ATT_GRADE}
		),
		placed AS (
			SELECT DISTINCT ON (da.ancestor_id, g.disaster_record_id)
				da.ancestor_id AS division_id, g.disaster_record_id, g.value, g.value_state,
				g.att_grade, g.plausibility_flags, g.start_instant, g.${hip} AS hip_code
			FROM graded g
			JOIN geo.division_ancestor da
				ON da.division_id = g.division_id
				AND da.country_accounts_id = ${t}
				AND da.ancestor_level = ${level}
			ORDER BY da.ancestor_id, g.disaster_record_id, g.att_grade
		)`;
}

async function buildCells(
	tx: Tx,
	t: string,
	measure: GeoMeasure,
	statuses: string[],
	level: number,
	hipLevel: PubHipLevel,
	from: string,
	to: string,
): Promise<{ observations: PubObservation[]; unattributed: PubUnattributed }> {
	const res = await tx.execute(sql`
		WITH ${placedCte(t, measure, statuses, level, hipLevel, from, to)},
		agg AS (
			SELECT p.division_id, d.national_id,
				to_char(p.start_instant, 'YYYY') AS period,
				COALESCE(p.hip_code, 'unclassified') AS hip_code,
				SUM(p.value) FILTER (WHERE p.value_state = 'reported') AS sum_reported,
				COUNT(*) FILTER (WHERE p.value_state = 'reported') AS reported,
				COUNT(*) FILTER (WHERE p.value_state = 'zero_confirmed') AS zero_confirmed,
				COUNT(*) AS total,
				COUNT(*) FILTER (WHERE cardinality(p.plausibility_flags) > 0) AS flagged,
				COUNT(*) FILTER (WHERE p.att_grade = 'A') AS grade_a,
				COUNT(*) FILTER (WHERE p.att_grade = 'B') AS grade_b,
				COUNT(*) FILTER (WHERE p.att_grade = 'C') AS grade_c,
				COUNT(*) FILTER (WHERE p.att_grade = 'D') AS grade_d
			FROM placed p
			JOIN geo.division_geom_cache d ON d.division_id = p.division_id
			GROUP BY 1, 2, 3, 4
		),
		unplaced AS (
			SELECT DISTINCT ON (s.disaster_record_id) s.disaster_record_id,
				CASE WHEN s.start_instant IS NULL THEN 'undated'
					WHEN s.unattributed_reason IS NOT NULL THEN s.unattributed_reason
					ELSE 'coarser_than_level' END AS reason
			FROM scope s
			WHERE s.start_instant IS NULL
				OR (s.disaster_record_id IN (SELECT disaster_record_id FROM graded)
					AND s.disaster_record_id NOT IN (SELECT disaster_record_id FROM placed))
			ORDER BY s.disaster_record_id, s.unattributed_reason NULLS LAST
		)
		SELECT
			(SELECT COALESCE(jsonb_agg(to_jsonb(agg) ORDER BY agg.national_id, agg.division_id, agg.period, agg.hip_code), '[]'::jsonb) FROM agg) AS cells,
			(SELECT COUNT(*) FROM unplaced) AS unattributed,
			(SELECT COALESCE(jsonb_object_agg(reason, n), '{}'::jsonb)
				FROM (SELECT reason, COUNT(*) AS n FROM unplaced GROUP BY reason) u) AS reasons
	`);
	const row = res.rows[0] as {
		cells: CellRow[];
		unattributed: string | number;
		reasons: Record<string, number | string>;
	};
	const observations = row.cells.map((c): PubObservation => {
		const mv = measureValue(
			{
				sum: c.sum_reported,
				reported: c.reported,
				zeroConfirmed: c.zero_confirmed,
				total: c.total,
				flagged: c.flagged,
			},
			PROVISIONAL_ZERO_COVERAGE,
		);
		return {
			division_key: c.national_id ?? `division:${c.division_id}`,
			measure,
			hip_code: c.hip_code,
			period: c.period,
			value: mv.value === null ? null : Number(mv.value),
			value_state: mv.valueState,
			records_reported: mv.recordsReported,
			records_zero_confirmed: mv.recordsZeroConfirmed,
			records_not_reported: mv.recordsNotReported,
			records_total: mv.recordsTotal,
			coverage:
				mv.recordsTotal > 0
					? Math.round(((mv.recordsReported + mv.recordsZeroConfirmed) / mv.recordsTotal) * 1e6) / 1e6
					: 0,
			grade_distribution: {
				A: Number(c.grade_a),
				B: Number(c.grade_b),
				C: Number(c.grade_c),
				D: Number(c.grade_d),
			},
			plausibility_flagged_records: mv.recordsFlagged,
			obs_status: OBS_STATUS[mv.valueState],
			conf_status: "F",
		};
	});
	return {
		observations,
		unattributed: {
			measure,
			records: Number(row.unattributed),
			reasons: Object.fromEntries(Object.entries(row.reasons).map(([k, v]) => [k, Number(v)])),
		},
	};
}

interface SliceFacts {
	iso3: string;
	year_from: string | null;
	year_to: string | null;
	run_ids: string[];
	provisional: boolean | null;
	vintages: string[] | null;
	refreshed_at: string | null;
	boundary_hash: string | null;
}

async function sliceFacts(tx: Tx, t: string, statuses: string[]): Promise<SliceFacts> {
	const inBasis = sql`country_accounts_id = ${t} AND record_status IN (${sql.join(statuses.map((s) => sql`${s}`), sql`, `)})`;
	const res = await tx.execute(sql`
		SELECT
			(SELECT c.iso3 FROM country_accounts ca JOIN countries c ON c.id = ca.country_id WHERE ca.id = ${t}) AS iso3,
			(SELECT to_char(min(start_instant), 'YYYY') FROM geo.impact_atom WHERE ${inBasis}) AS year_from,
			(SELECT to_char(max(start_instant), 'YYYY') FROM geo.impact_atom WHERE ${inBasis}) AS year_to,
			COALESCE((SELECT jsonb_agg(DISTINCT migration_run_id ORDER BY migration_run_id) FROM geo.impact_atom
				WHERE ${inBasis} AND migration_run_id IS NOT NULL), '[]'::jsonb) AS run_ids,
			(SELECT bool_or(provisional) FROM geo.impact_atom WHERE ${inBasis}) AS provisional,
			(SELECT jsonb_agg(DISTINCT boundary_vintage) FROM geo.division_geom_cache WHERE country_accounts_id = ${t}) AS vintages,
			(SELECT max(refreshed_at) FROM geo.refresh_log WHERE country_accounts_id = ${t}) AS refreshed_at,
			(SELECT encode(sha256(convert_to(string_agg(
				division_id::text || '|' || COALESCE(national_id, '') || '|' || admin_level || '|' ||
				md5(COALESCE(ST_AsBinary(geom_z12), ''::bytea)), ';' ORDER BY division_id), 'UTF8')), 'hex')
				FROM geo.division_geom_cache WHERE country_accounts_id = ${t}) AS boundary_hash
	`);
	return res.rows[0] as unknown as SliceFacts;
}

export interface PublishOptions {
	purpose?: PubPurpose;
	/** Rebuild the geo read model first, so the package reflects current records. */
	refresh?: boolean;
	instanceType?: "shared_saas" | "self_hosted";
	key?: PubSigningKey | null;
	minCellRecords?: number | null;
}

/**
 * Builds a package for one active consent and writes it to the outbox. A
 * publication uses the official basis (published records only, D-04) and must
 * be signed. A specification test uses every status and is never delivered.
 */
export async function publishPackage(
	countryAccountsId: string,
	userId: string,
	settingId: string,
	opts: PublishOptions = {},
): Promise<PubPackage> {
	const purpose = opts.purpose ?? "publication";
	const key = opts.key === undefined ? signingKeyFromEnv() : opts.key;
	const minCellRecords =
		opts.minCellRecords === undefined ? suppressionThresholdFromEnv() : opts.minCellRecords;
	if (purpose === "publication" && !key) {
		throw new PubRefusalError(
			"SIGNING_KEY_NOT_CONFIGURED",
			"A publication must be signed. No signing key is configured for this instance (TBD-decision: key custody).",
		);
	}
	if (opts.refresh) {
		await refreshGeoReadModel(countryAccountsId);
	}
	const statuses = purpose === "publication" ? OFFICIAL_BASIS : TEST_BASIS;

	return dr.transaction(async (tx) => {
		const setting = await lockActiveSetting(tx, countryAccountsId, settingId);
		// The role comes from the membership table, never from the caller.
		const member = await tx.execute(sql`
			SELECT role FROM user_country_accounts
			WHERE user_id = ${userId} AND country_accounts_id = ${countryAccountsId}
		`);
		const publisherRole = (member.rows[0] as { role: string } | undefined)?.role ?? null;
		if (purpose === "publication" && !publisherRole) {
			throw new PubRefusalError(
				"PUBLISHER_NOT_A_MEMBER",
				"The publishing user holds no role in this country account.",
				403,
			);
		}
		const facts = await sliceFacts(tx, countryAccountsId, statuses);
		if (!facts.iso3 || !/^[A-Z]{3}$/.test(facts.iso3)) {
			throw new PubRefusalError(
				"COUNTRY_ISO3_MISSING",
				"The country account has no ISO3 code. A package must name its country.",
			);
		}
		if (!facts.year_from || !facts.year_to) {
			throw new PubRefusalError(
				"NO_RECORDS_IN_BASIS",
				`No dated records in the ${purpose === "publication" ? "published" : "test"} basis. Nothing to publish.`,
			);
		}
		const from = `${facts.year_from}-01-01`;
		const to = `${facts.year_to}-12-31`;

		let observations: PubObservation[] = [];
		const unattributed: PubUnattributed[] = [];
		for (const m of GEO_MEASURES) {
			const built = await buildCells(tx, countryAccountsId, m, statuses, setting.adminLevel, setting.hipLevel, from, to);
			observations.push(...built.observations);
			unattributed.push(built.unattributed);
		}
		const suppression = applySuppression(observations, minCellRecords ?? null);
		observations = suppression.observations;

		const last = await lastPackage(tx, countryAccountsId, setting.dataset, setting.tier);
		const header: PubHeader = {
			package_id: randomUUID(),
			package_type: "replace",
			created_at: new Date().toISOString(),
			publisher: {
				iso3: facts.iso3,
				tenant_ref: tenantRef(countryAccountsId),
				instance_type: opts.instanceType ?? "shared_saas",
				application_version: APPLICATION_VERSION,
			},
			slice: {
				dataset: setting.dataset,
				admin_level: setting.adminLevel,
				period_from: facts.year_from,
				period_to: facts.year_to,
				measures: [...GEO_MEASURES],
				hip_level: setting.hipLevel,
			},
			basis: {
				record_statuses: statuses,
				label: purpose === "publication" ? "official" : "test_only",
			},
			consent: {
				consent_id: setting.id,
				tier: setting.tier,
				aggregation_level: setting.adminLevel,
				granted_by_role: publisherRole,
				granted_at: setting.grantedAt,
				redistribution: setting.redistribution,
			},
			method: {
				read_model_version: GEO_METHOD_VERSION,
				period_assignment: "start_year",
				min_att_grade: PUB_MIN_ATT_GRADE,
				zero_coverage_rule: {
					min_coverage: PROVISIONAL_ZERO_COVERAGE.minCoverage,
					min_records: PROVISIONAL_ZERO_COVERAGE.minRecords,
					ruling: "provisional",
				},
				read_model_refreshed_at: facts.refreshed_at ? new Date(facts.refreshed_at).toISOString() : null,
			},
			boundary: {
				key_scheme: "national_id",
				vintage: (facts.vintages ?? ["unknown"]).join(","),
				boundary_set_hash: `sha256:${facts.boundary_hash ?? ""}`,
				geometry_included: false,
			},
			vocabulary: { hazard: "HIPs 2025" },
			provisional: Boolean(facts.provisional),
			migration_run_ids: facts.run_ids,
			previous_package_id: last?.package_id ?? null,
			suppression: { applied: suppression.rule !== null, rule: suppression.rule },
			purpose,
		};
		const pkg = seal({ schema: PUB_SCHEMA, header, observations, unattributed }, purpose, key ?? null);
		await insertPackage(tx, countryAccountsId, setting, pkg, userId);
		return pkg;
	});
}

export interface OutboxSummary {
	packageId: string;
	shareSettingId: string;
	dataset: string;
	tier: string;
	packageType: string;
	purpose: string;
	previousPackageId: string | null;
	contentDigest: string;
	signed: boolean;
	observationCount: number;
	status: string;
	createdAt: string;
}

export async function listPackages(countryAccountsId: string): Promise<OutboxSummary[]> {
	const res = await dr.execute(sql`
		SELECT package_id, share_setting_id, dataset, tier, package_type, purpose, previous_package_id,
			content_digest, signed, observation_count, status, created_at
		FROM pub.package_outbox WHERE country_accounts_id = ${countryAccountsId}
		ORDER BY created_at DESC, package_id DESC
	`);
	return (res.rows as Record<string, unknown>[]).map((r) => ({
		packageId: String(r.package_id),
		shareSettingId: String(r.share_setting_id),
		dataset: String(r.dataset),
		tier: String(r.tier),
		packageType: String(r.package_type),
		purpose: String(r.purpose),
		previousPackageId: (r.previous_package_id as string | null) ?? null,
		contentDigest: String(r.content_digest),
		signed: Boolean(r.signed),
		observationCount: Number(r.observation_count),
		status: String(r.status),
		createdAt: new Date(r.created_at as string).toISOString(),
	}));
}

/** The full package, only for the tenant that owns it. */
export async function getPackage(countryAccountsId: string, packageId: string): Promise<PubPackage | null> {
	const res = await dr.execute(sql`
		SELECT payload FROM pub.package_outbox
		WHERE package_id = ${packageId} AND country_accounts_id = ${countryAccountsId}
	`);
	return ((res.rows[0] as { payload: PubPackage } | undefined)?.payload) ?? null;
}
