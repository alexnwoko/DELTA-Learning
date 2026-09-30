import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { PgDialect } from "drizzle-orm/pg-core";
import {
	approvalBasis,
	basisColumns,
	basisIncludesProvisional,
	basisStatuses,
	OFFICIAL_BASIS_STATUSES,
	rowOnApprovalBasis,
	SIGNED_IN_BASIS_STATUSES,
} from "~/utils/approvalBasis";
import {
	isMigratedProvisional,
	isRetiredLegacyData,
	migrationRunId,
} from "~/utils/provisional";

// C23 items 1, 3 and 4: one approval basis, retired records excluded,
// provisional records never on the official basis.

const dialect = new PgDialect();
const render = (q: ReturnType<typeof approvalBasis>) => dialect.sqlToQuery(q);

const migrated = (status: string, extra: Record<string, unknown> = {}) => ({
	approvalStatus: status,
	legacyData: { migration: { run_id: "load-ago-1", ...extra } },
});

describe("approval basis", () => {
	it("shows published records only to public, signed-in and official views", () => {
		expect(basisStatuses("public")).toEqual(["published"]);
		// D-04 default (pack decision 19) until Alex rules otherwise.
		expect(SIGNED_IN_BASIS_STATUSES).toEqual(["published"]);
		expect(basisStatuses("official")).toEqual(["published"]);
	});

	it("never admits a provisional record to the official basis", () => {
		expect(OFFICIAL_BASIS_STATUSES).toEqual(["published"]);
		expect(basisIncludesProvisional("official")).toBe(false);
		for (const status of [
			"draft",
			"waiting-for-validation",
			"needs-revision",
			"validated",
		]) {
			expect(rowOnApprovalBasis("official", migrated(status))).toBe(false);
		}
		expect(rowOnApprovalBasis("official", migrated("published"))).toBe(true);
	});

	it("labels figures provisional only when the basis admits drafts", () => {
		expect(basisIncludesProvisional("public")).toBe(false);
		expect(basisIncludesProvisional("signed-in")).toBe(
			SIGNED_IN_BASIS_STATUSES.some((s) => s !== "published"),
		);
	});

	it("excludes retired records from every basis", () => {
		const retired = migrated("published", {
			retired: { run_id: "load-ago-2", reason: "absent from run" },
		});
		for (const a of ["public", "signed-in", "official"] as const) {
			expect(rowOnApprovalBasis(a, retired)).toBe(false);
		}
		// A null or false marker does not retire the record.
		expect(
			rowOnApprovalBasis("public", migrated("published", { retired: null })),
		).toBe(true);
		expect(
			rowOnApprovalBasis("public", migrated("published", { retired: false })),
		).toBe(true);
		expect(rowOnApprovalBasis("public", { approvalStatus: "published" })).toBe(
			true,
		);
	});

	it("builds one SQL condition with the statuses and the retired check", () => {
		const q = render(approvalBasis("public", basisColumns("dr")));
		expect(q.sql).toContain(`"dr"."approvalStatus" IN ($1)`);
		expect(q.sql).toContain(`"dr"."legacy_data" -> 'migration' -> 'retired'`);
		expect(q.params).toEqual(["published"]);
	});

	it("omits the retired check for tables without legacy_data", () => {
		const q = render(
			approvalBasis("public", basisColumns("he", { legacyData: false })),
		);
		expect(q.sql).not.toContain("legacy_data");
	});
});

describe("provisional records", () => {
	it("marks migrated records below published as provisional", () => {
		expect(isMigratedProvisional(migrated("draft"))).toBe(true);
		expect(isMigratedProvisional(migrated("validated"))).toBe(true);
		expect(isMigratedProvisional(migrated("published"))).toBe(false);
		// A draft entered by hand is not a migrated record.
		expect(
			isMigratedProvisional({ approvalStatus: "draft", legacyData: null }),
		).toBe(false);
		expect(migrationRunId(migrated("draft").legacyData)).toBe("load-ago-1");
		expect(isRetiredLegacyData(migrated("draft").legacyData)).toBe(false);
	});
});

// The approval basis replaces every ad-hoc filter on the analytics read
// paths. A new hard-coded status filter there is a regression.
describe("no ad-hoc approval filters on analytics read paths", () => {
	const roots = [
		"app/backend.server/models/analytics",
		"app/backend.server/handlers/analytics",
		"app/routes/$lang+/analytics+",
	];
	const files = (dir: string): string[] =>
		readdirSync(dir).flatMap((f) => {
			const p = join(dir, f);
			return statSync(p).isDirectory() ? files(p) : [p];
		});
	const adHoc = [
		/approvalStatus"?\)?\s*(IN|=|ILIKE)\s*\(?'(published|validated)'/,
		/approvalStatus,\s*"(published|validated)"\)/,
	];

	it("finds no status literal filter", () => {
		const offenders: string[] = [];
		for (const root of roots) {
			for (const f of files(root)) {
				if (!/\.tsx?$/.test(f)) continue;
				const text = readFileSync(f, "utf8");
				text.split("\n").forEach((line, i) => {
					if (line.trim().startsWith("//") || line.trim().startsWith("*"))
						return;
					if (adHoc.some((re) => re.test(line))) {
						offenders.push(`${f}:${i + 1}: ${line.trim()}`);
					}
				});
			}
		}
		expect(offenders).toEqual([]);
	});
});

// C23 item 2: the reconciliation basis must be unreachable from public
// routes. No route module may import it.
describe("reconciliation basis is not reachable from routes", () => {
	const files = (dir: string): string[] =>
		readdirSync(dir).flatMap((f) => {
			const p = join(dir, f);
			return statSync(p).isDirectory() ? files(p) : [p];
		});

	it("is imported by no file under app/routes", () => {
		const importers = files("app/routes").filter((f) =>
			readFileSync(f, "utf8").includes("reconciliationBasis"),
		);
		expect(importers).toEqual([]);
	});
});
