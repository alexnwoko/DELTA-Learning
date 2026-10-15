// Provisional and retired records (solution pack C23, C22; standard OP-29).
// The migration loads records below published and stamps each one with
// legacy_data.migration.run_id. Such a record is provisional until it is
// published. Retirement (DEC-012) will be marked in
// legacy_data.migration.retired; no record carries that key yet.
// Pure module: safe for server and client code.

function migrationBlock(legacyData: unknown): Record<string, unknown> | null {
	if (!legacyData || typeof legacyData !== "object") return null;
	const m = (legacyData as Record<string, unknown>).migration;
	if (!m || typeof m !== "object") return null;
	return m as Record<string, unknown>;
}

/** The migration run id stamped on a migrated record, or null. */
export function migrationRunId(legacyData: unknown): string | null {
	const runId = migrationBlock(legacyData)?.run_id;
	return typeof runId === "string" && runId !== "" ? runId : null;
}

/** True when the record carries a retirement marker (not null, not false). */
export function isRetiredLegacyData(legacyData: unknown): boolean {
	const m = migrationBlock(legacyData);
	if (!m || !("retired" in m)) return false;
	return m.retired !== null && m.retired !== false;
}

/** A migrated record that is not yet published. */
export function isMigratedProvisional(row: {
	approvalStatus?: string | null;
	legacyData?: unknown;
}): boolean {
	return (
		row.approvalStatus !== "published" &&
		migrationRunId(row.legacyData) !== null
	);
}
