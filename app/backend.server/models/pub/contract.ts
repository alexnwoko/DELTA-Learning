// The delta.pub/1 publication package (ADR-11; DV2
// 03_Design_Specs/Tiered_Analytics_and_Geoportal/delta_pub_1_Specification.md).
// Pure module: types, the value-state to SDMX mapping, the canonical digest,
// signing and sender-side suppression. No database access.

import { createHash, createPrivateKey, createPublicKey, sign, verify } from "crypto";
import type { ValueState } from "~/utils/valueState";
import type { GeoMeasure } from "~/utils/geoMeasures";

export const PUB_SCHEMA = "delta.pub/1";

export const PUB_DATASETS = ["human_effects"] as const;
export type PubDataset = (typeof PUB_DATASETS)[number];

export const PUB_TIERS = ["regional", "global", "public"] as const;
export type PubTier = (typeof PUB_TIERS)[number];

export const PUB_HIP_LEVELS = ["type", "cluster", "hazard"] as const;
export type PubHipLevel = (typeof PUB_HIP_LEVELS)[number];

export const PUB_REDISTRIBUTION = ["none", "regional_only", "regional_and_global"] as const;
export type PubRedistribution = (typeof PUB_REDISTRIBUTION)[number];

export type PubPurpose = "publication" | "specification_test";
export type PubPackageType = "replace" | "withdraw";
export type ObsStatus = "A" | "L" | "O" | "M" | "Q" | "R";
export type ConfStatus = "F" | "C" | "D";

/** Value state to SDMX OBS_STATUS (specification s4). */
export const OBS_STATUS: Record<ValueState, ObsStatus> = {
	reported: "A",
	zero_confirmed: "A",
	not_reported: "L",
	not_applicable: "M",
	suppressed: "Q",
	insufficient_reporting: "R",
};

export interface PubObservation {
	division_key: string;
	measure: GeoMeasure;
	hip_code: string;
	period: string;
	value: number | null;
	value_state: ValueState;
	records_reported: number;
	records_zero_confirmed: number;
	records_not_reported: number;
	records_total: number;
	coverage: number;
	grade_distribution: { A: number; B: number; C: number; D: number };
	plausibility_flagged_records: number;
	obs_status: ObsStatus;
	conf_status: ConfStatus;
}

export interface PubUnattributed {
	measure: GeoMeasure;
	records: number;
	reasons: Record<string, number>;
}

export interface PubHeader {
	package_id: string;
	package_type: PubPackageType;
	created_at: string;
	publisher: {
		iso3: string;
		tenant_ref: string;
		instance_type: "shared_saas" | "self_hosted";
		application_version: string;
	};
	slice: {
		dataset: PubDataset;
		admin_level: number;
		period_from: string;
		period_to: string;
		measures: GeoMeasure[];
		hip_level: PubHipLevel;
	};
	basis: { record_statuses: string[]; label: "official" | "test_only" };
	consent: {
		consent_id: string | null;
		tier: PubTier;
		aggregation_level: number;
		granted_by_role: string | null;
		granted_at: string | null;
		redistribution: PubRedistribution;
	};
	method: {
		read_model_version: string;
		period_assignment: "start_year";
		min_att_grade: "A" | "B" | "C" | "D";
		zero_coverage_rule: { min_coverage: number; min_records: number; ruling: "provisional" | "final" };
		read_model_refreshed_at: string | null;
	};
	boundary: {
		key_scheme: "national_id" | "pcode";
		vintage: string;
		boundary_set_hash: string;
		geometry_included: boolean;
	};
	vocabulary: { hazard: "HIPs 2025" };
	provisional: boolean;
	migration_run_ids: string[];
	previous_package_id: string | null;
	suppression: { applied: boolean; rule: string | null };
	purpose: PubPurpose;
}

export interface PubSignature {
	alg: "Ed25519";
	key_id: string;
	value: string;
}

export interface PubPackage {
	schema: typeof PUB_SCHEMA;
	header: PubHeader;
	observations: PubObservation[];
	unattributed: PubUnattributed[];
	integrity: { content_digest: string; signature: PubSignature | null };
}

/** SHA-256 of a tenant id, so the raw id never leaves the national instance. */
export function tenantRef(countryAccountsId: string): string {
	return "sha256:" + createHash("sha256").update(countryAccountsId).digest("hex");
}

/**
 * Canonical JSON: keys sorted, no whitespace, numbers in their JavaScript form
 * (RFC 8785 style). Every value in a package is a string, a finite number, a
 * boolean, null, an array or a plain object.
 */
export function canonicalJson(value: unknown): string {
	if (value === null || typeof value !== "object") {
		if (typeof value === "number" && !Number.isFinite(value)) {
			throw new Error("canonicalJson: non-finite number");
		}
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) {
		return "[" + value.map(canonicalJson).join(",") + "]";
	}
	const obj = value as Record<string, unknown>;
	const keys = Object.keys(obj)
		.filter((k) => obj[k] !== undefined)
		.sort();
	return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalJson(obj[k])).join(",") + "}";
}

/** Digest of the package without its integrity member (specification s6). */
export function contentDigest(pkg: Omit<PubPackage, "integrity">): string {
	return "sha256:" + createHash("sha256").update(canonicalJson(pkg), "utf8").digest("hex");
}

export interface PubSigningKey {
	keyId: string;
	privateKeyPem: string;
}

/**
 * The instance signing key, from DELTA_PUB_SIGNING_KEY (PKCS8 PEM, Ed25519)
 * and DELTA_PUB_SIGNING_KEY_ID. Key custody and rotation are not ruled
 * (TBD-decision); with no key configured, publication is refused.
 */
export function signingKeyFromEnv(env: NodeJS.ProcessEnv = process.env): PubSigningKey | null {
	const pem = env.DELTA_PUB_SIGNING_KEY?.replace(/\\n/g, "\n");
	const keyId = env.DELTA_PUB_SIGNING_KEY_ID;
	if (!pem || !keyId) return null;
	return { keyId, privateKeyPem: pem };
}

/** Ed25519 signature over the content digest string. */
export function signDigest(digest: string, key: PubSigningKey): PubSignature {
	const value = sign(null, Buffer.from(digest, "utf8"), createPrivateKey(key.privateKeyPem));
	return { alg: "Ed25519", key_id: key.keyId, value: value.toString("base64") };
}

export function verifySignature(digest: string, signature: PubSignature, publicKeyPem: string): boolean {
	return verify(
		null,
		Buffer.from(digest, "utf8"),
		createPublicKey(publicKeyPem),
		Buffer.from(signature.value, "base64"),
	);
}

/**
 * Sender-side suppression threshold: cells with fewer contributing records
 * than this are suppressed. From DELTA_PUB_MIN_CELL_RECORDS. The threshold is
 * not ruled (TBD-decision); unset means no suppression runs, and the package
 * header says so.
 */
export function suppressionThresholdFromEnv(env: NodeJS.ProcessEnv = process.env): number | null {
	const raw = env.DELTA_PUB_MIN_CELL_RECORDS;
	if (!raw) return null;
	const n = Number(raw);
	return Number.isInteger(n) && n > 1 ? n : null;
}

function suppress(o: PubObservation, conf: ConfStatus): PubObservation {
	return { ...o, value: null, value_state: "suppressed", obs_status: "Q", conf_status: conf };
}

/**
 * Primary suppression (C): a cell that carries a figure from fewer than
 * `minRecords` records. Secondary suppression (D): within one measure, period
 * and hazard node, a lone suppressed cell takes the next smallest figure with
 * it, so it cannot be recovered by subtraction from a total. Cells without a
 * figure (not reported, insufficient reporting) disclose nothing and are
 * left as they are.
 */
export function applySuppression(
	observations: PubObservation[],
	minRecords: number | null,
): { observations: PubObservation[]; rule: string | null; primary: number; secondary: number } {
	if (minRecords === null) {
		return { observations, rule: null, primary: 0, secondary: 0 };
	}
	const hasFigure = (o: PubObservation) => o.value !== null;
	let primary = 0;
	let secondary = 0;
	const out = observations.map((o) => {
		if (hasFigure(o) && o.records_reported + o.records_zero_confirmed < minRecords) {
			primary++;
			return suppress(o, "C");
		}
		return o;
	});
	const groups = new Map<string, number[]>();
	out.forEach((o, i) => {
		const k = `${o.measure}|${o.period}|${o.hip_code}`;
		groups.set(k, [...(groups.get(k) ?? []), i]);
	});
	for (const idx of groups.values()) {
		const suppressed = idx.filter((i) => out[i].value_state === "suppressed");
		if (suppressed.length !== 1) continue;
		const candidates = idx
			.filter((i) => hasFigure(out[i]))
			.sort((a, b) => out[a].records_total - out[b].records_total || out[a].division_key.localeCompare(out[b].division_key));
		if (candidates.length > 0) {
			out[candidates[0]] = suppress(out[candidates[0]], "D");
			secondary++;
		}
	}
	return {
		observations: out,
		rule: `primary: figure from fewer than ${minRecords} records (C); secondary: lone suppressed cell per measure, period and hazard node takes the next smallest figure (D)`,
		primary,
		secondary,
	};
}
