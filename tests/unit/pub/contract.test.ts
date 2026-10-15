import { describe, expect, it } from "vitest";
import { generateKeyPairSync } from "crypto";
import {
	applySuppression,
	canonicalJson,
	contentDigest,
	OBS_STATUS,
	signDigest,
	signingKeyFromEnv,
	suppressionThresholdFromEnv,
	tenantRef,
	verifySignature,
	type PubObservation,
} from "~/backend.server/models/pub/contract";
import { VALUE_STATES } from "~/utils/valueState";

function obs(over: Partial<PubObservation>): PubObservation {
	return {
		division_key: "D1",
		measure: "deaths",
		hip_code: "MH",
		period: "2020",
		value: 10,
		value_state: "reported",
		records_reported: 5,
		records_zero_confirmed: 0,
		records_not_reported: 0,
		records_total: 5,
		coverage: 1,
		grade_distribution: { A: 0, B: 5, C: 0, D: 0 },
		plausibility_flagged_records: 0,
		obs_status: "A",
		conf_status: "F",
		...over,
	};
}

function keyPair() {
	const { privateKey, publicKey } = generateKeyPairSync("ed25519");
	return {
		priv: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
		pub: publicKey.export({ type: "spki", format: "pem" }).toString(),
	};
}

describe("delta.pub/1 contract", () => {
	it("maps every value state to an SDMX OBS_STATUS", () => {
		for (const s of VALUE_STATES) {
			expect(OBS_STATUS[s]).toBeDefined();
		}
		expect(OBS_STATUS.not_reported).toBe("L");
		expect(OBS_STATUS.insufficient_reporting).toBe("R");
		expect(OBS_STATUS.suppressed).toBe("Q");
	});

	it("canonical JSON sorts keys at every depth and keeps null", () => {
		expect(canonicalJson({ b: 1, a: { d: null, c: [2, { z: 0, y: 0.5 }] } })).toBe(
			'{"a":{"c":[2,{"y":0.5,"z":0}],"d":null},"b":1}',
		);
	});

	it("gives the same digest whatever the key order", () => {
		const a = { schema: "delta.pub/1", header: { x: 1, y: 2 }, observations: [], unattributed: [] };
		const b = { unattributed: [], observations: [], header: { y: 2, x: 1 }, schema: "delta.pub/1" };
		expect(contentDigest(a as never)).toBe(contentDigest(b as never));
		expect(contentDigest(a as never)).toMatch(/^sha256:[0-9a-f]{64}$/);
	});

	it("refuses non-finite numbers", () => {
		expect(() => canonicalJson({ v: Number.NaN })).toThrow();
	});

	it("never exposes the raw tenant id", () => {
		const id = "57ffba9a-86ac-4812-935f-9b8027c0e511";
		expect(tenantRef(id)).toMatch(/^sha256:[0-9a-f]{64}$/);
		expect(tenantRef(id)).not.toContain(id);
	});

	it("signs the digest and detects tampering", () => {
		const { priv, pub } = keyPair();
		const sig = signDigest("sha256:" + "a".repeat(64), { keyId: "k1", privateKeyPem: priv });
		expect(sig.alg).toBe("Ed25519");
		expect(verifySignature("sha256:" + "a".repeat(64), sig, pub)).toBe(true);
		expect(verifySignature("sha256:" + "b".repeat(64), sig, pub)).toBe(false);
	});

	it("reads the signing key only when both variables are set", () => {
		expect(signingKeyFromEnv({} as NodeJS.ProcessEnv)).toBeNull();
		expect(signingKeyFromEnv({ DELTA_PUB_SIGNING_KEY: "x" } as NodeJS.ProcessEnv)).toBeNull();
		expect(
			signingKeyFromEnv({ DELTA_PUB_SIGNING_KEY: "a\\nb", DELTA_PUB_SIGNING_KEY_ID: "k" } as NodeJS.ProcessEnv),
		).toEqual({ keyId: "k", privateKeyPem: "a\nb" });
	});

	it("reads no suppression threshold unless it is an integer above 1", () => {
		expect(suppressionThresholdFromEnv({} as NodeJS.ProcessEnv)).toBeNull();
		expect(suppressionThresholdFromEnv({ DELTA_PUB_MIN_CELL_RECORDS: "1" } as NodeJS.ProcessEnv)).toBeNull();
		expect(suppressionThresholdFromEnv({ DELTA_PUB_MIN_CELL_RECORDS: "3" } as NodeJS.ProcessEnv)).toBe(3);
	});
});

describe("sender-side suppression", () => {
	it("does nothing and records no rule when no threshold is set", () => {
		const input = [obs({ records_reported: 1, records_total: 1 })];
		const r = applySuppression(input, null);
		expect(r.observations).toBe(input);
		expect(r.rule).toBeNull();
	});

	it("suppresses a small cell and its smallest neighbour in the same group", () => {
		const r = applySuppression(
			[
				obs({ division_key: "D1", records_reported: 1, records_total: 1, value: 3 }),
				obs({ division_key: "D2", records_reported: 4, records_total: 4, value: 7 }),
				obs({ division_key: "D3", records_reported: 9, records_total: 9, value: 20 }),
			],
			3,
		);
		const byKey = Object.fromEntries(r.observations.map((o) => [o.division_key, o]));
		expect(byKey.D1).toMatchObject({ value: null, value_state: "suppressed", obs_status: "Q", conf_status: "C" });
		expect(byKey.D2).toMatchObject({ value: null, value_state: "suppressed", conf_status: "D" });
		expect(byKey.D3).toMatchObject({ value: 20, value_state: "reported" });
		expect([r.primary, r.secondary]).toEqual([1, 1]);
		expect(r.rule).toContain("fewer than 3");
	});

	it("leaves cells without a figure as they are", () => {
		const r = applySuppression(
			[obs({ value: null, value_state: "not_reported", obs_status: "L", records_reported: 0, records_total: 1 })],
			3,
		);
		expect(r.observations[0].value_state).toBe("not_reported");
		expect(r.primary).toBe(0);
	});

	it("does not add secondary suppression when two cells are already hidden", () => {
		const r = applySuppression(
			[
				obs({ division_key: "D1", records_reported: 1, records_total: 1 }),
				obs({ division_key: "D2", records_reported: 2, records_total: 2 }),
				obs({ division_key: "D3", records_reported: 9, records_total: 9 }),
			],
			3,
		);
		expect(r.secondary).toBe(0);
		expect(r.observations.find((o) => o.division_key === "D3")!.value_state).toBe("reported");
	});

	it("keeps groups apart: another period is not a neighbour", () => {
		const r = applySuppression(
			[
				obs({ division_key: "D1", period: "2020", records_reported: 1, records_total: 1 }),
				obs({ division_key: "D2", period: "2021", records_reported: 9, records_total: 9 }),
			],
			3,
		);
		expect(r.observations[1].value_state).toBe("reported");
		expect(r.secondary).toBe(0);
	});
});
