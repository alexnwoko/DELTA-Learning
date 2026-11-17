import { describe, it, expect, vi, beforeEach } from "vitest";

// AB-01 (PD-05): the provisional basis is for signed-in reviewers with
// ValidateData only; any other request for it is refused, never downgraded.

let sessionUser: unknown = undefined;
let canValidate = false;
vi.mock("~/utils/session", () => ({
	getUserFromSession: vi.fn(async () => sessionUser),
}));
vi.mock("~/utils/auth", () => ({
	hasPermission: vi.fn(async (_r: Request, p: string) =>
		p === "ValidateData" ? canValidate : false,
	),
}));

import { approvalAudienceForBasis } from "~/backend.server/approvalAudience.server";
import {
	basisStatuses,
	basisIncludesProvisional,
	PROVISIONAL_BASIS_STATUSES,
} from "~/utils/approvalBasis";

const req = () => new Request("http://localhost/en/analytics/hazards");
const signedIn = {
	user: { id: "u1", totpEnabled: false },
	session: { totpAuthed: false },
};

async function status(p: Promise<unknown>): Promise<number | string> {
	try {
		return String(await p);
	} catch (e) {
		return e instanceof Response ? e.status : "error";
	}
}

describe("reviewer provisional basis", () => {
	beforeEach(() => {
		sessionUser = undefined;
		canValidate = false;
	});

	it("keeps the published basis for everyone who does not ask", async () => {
		expect(await approvalAudienceForBasis(req(), "published")).toBe("public");
		sessionUser = signedIn;
		expect(await approvalAudienceForBasis(req(), "published")).toBe(
			"signed-in",
		);
	});

	it("refuses the provisional basis on a public request", async () => {
		canValidate = true;
		expect(await status(approvalAudienceForBasis(req(), "provisional"))).toBe(
			403,
		);
	});

	it("refuses it for a signed-in user without ValidateData", async () => {
		sessionUser = signedIn;
		expect(await status(approvalAudienceForBasis(req(), "provisional"))).toBe(
			403,
		);
	});

	it("grants it to a reviewer with ValidateData", async () => {
		sessionUser = signedIn;
		canValidate = true;
		expect(await approvalAudienceForBasis(req(), "provisional")).toBe(
			"reviewer-provisional",
		);
	});

	it("admits draft and workflow records, never needs-revision, and is labelled", () => {
		expect(basisStatuses("reviewer-provisional")).toBe(
			PROVISIONAL_BASIS_STATUSES,
		);
		expect(PROVISIONAL_BASIS_STATUSES).toContain("draft");
		expect(PROVISIONAL_BASIS_STATUSES).not.toContain("needs-revision");
		expect(basisIncludesProvisional("reviewer-provisional")).toBe(true);
		expect(basisIncludesProvisional("public")).toBe(false);
	});
});
