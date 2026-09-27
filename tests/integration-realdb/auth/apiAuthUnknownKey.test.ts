import { describe, it, expect } from "vitest";
import { randomUUID } from "crypto";
import { apiAuth } from "~/backend.server/models/api_key";

// Architecture 48h plan P0: an unknown API key returned undefined instead of
// 401, because the repository returns an array and an empty array is truthy.

function req(key?: string) {
	const headers = new Headers();
	if (key !== undefined) headers.set("X-Auth", key);
	return new Request("http://localhost/en/api/test", { headers });
}

async function statusOf(p: Promise<unknown>) {
	try {
		const v = await p;
		return { resolved: v };
	} catch (e) {
		return { status: e instanceof Response ? e.status : String(e) };
	}
}

describe("apiAuth", () => {
	it("rejects a missing key with 401", async () => {
		expect(await statusOf(apiAuth(req()))).toEqual({ status: 401 });
	});

	it("rejects an unknown key with 401", async () => {
		expect(await statusOf(apiAuth(req(randomUUID())))).toEqual({ status: 401 });
	});
});
