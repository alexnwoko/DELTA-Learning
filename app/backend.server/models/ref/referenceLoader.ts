import { sql } from "drizzle-orm";
import { dr, type Tx } from "~/db.server";
import { parseCSV } from "~/utils/csv";
import {
	validateReferenceValueCells,
	type ReferenceValueInput,
} from "~/backend.server/models/ref/referenceValueRules";

// E1 (Enrichment Data Integration, section 7.1 steps 1 and 4): loads
// reference values from a CSV into ref.source, ref.release and ref.value.
// Columns follow delta_reference_value.schema.json plus iso3. Every row is
// validated by the same rules as the schema; a row that fails, or that
// cannot be resolved to a tenant, indicator or division, is rejected and
// reported, and never written. Valid rows are upserted on the ref.value
// natural key, so loading the same file twice changes nothing.

export const SCHEMA_COLUMNS = [
	"indicator_code",
	"family",
	"quantity_type",
	"unit",
	"division_key",
	"boundary_vintage",
	"period_start",
	"period_end",
	"value",
	"value_state",
	"lower_bound",
	"upper_bound",
	"method",
	"grade",
	"source",
	"release",
	"licence",
	"redistribution_rule",
	"source_status",
	"rdls_id",
] as const;

export const CSV_COLUMNS = [...SCHEMA_COLUMNS, "iso3"] as const;

/** division_key values that mean "the national value" (division_id NULL). */
export const NATIONAL_KEYS = ["national"];

export interface RejectedRow {
	/** 1-based data row (the header is row 0). */
	row: number;
	iso3: string;
	divisionKey: string;
	errors: string[];
}

export interface LoadReport {
	dryRun: boolean;
	rowsRead: number;
	rowsValid: number;
	rowsRejected: number;
	inserted: number;
	updated: number;
	unchanged: number;
	sourcesCreated: number;
	releasesCreated: number;
	rejected: RejectedRow[];
	/** Errors that stop the whole file (for example an unknown column). */
	fileErrors: string[];
}

export interface LoadOptions {
	dryRun?: boolean;
	/** Load into this tenant only; each row's iso3 must match its country. */
	countryAccountsId?: string;
}

export type CsvRow = Record<string, string>;

/** Parses the CSV text into rows keyed by header, plus header errors. */
export async function parseReferenceCsv(
	text: string,
): Promise<{ rows: CsvRow[]; fileErrors: string[] }> {
	let records: string[][];
	try {
		records = await parseCSV(text.replace(/^\uFEFF/, ""));
	} catch (e) {
		return {
			rows: [],
			fileErrors: [`CSV parse error: ${e instanceof Error ? e.message : e}`],
		};
	}
	if (records.length === 0) {
		return { rows: [], fileErrors: ["file is empty"] };
	}
	const header = records[0].map((h) => h.trim());
	const fileErrors: string[] = [];
	const unknown = header.filter(
		(h) => !(CSV_COLUMNS as readonly string[]).includes(h),
	);
	if (unknown.length > 0) {
		fileErrors.push(`unknown column(s): ${unknown.join(", ")}`);
	}
	const dupes = header.filter((h, i) => header.indexOf(h) !== i);
	if (dupes.length > 0) {
		fileErrors.push(`duplicate column(s): ${[...new Set(dupes)].join(", ")}`);
	}
	if (!header.includes("iso3")) fileErrors.push("missing column: iso3");
	const rows = records
		.slice(1)
		.filter((r) => r.some((c) => c !== ""))
		.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
	return { rows, fileErrors };
}

class DryRunRollback extends Error {}

interface Resolved {
	row: number;
	value: ReferenceValueInput;
	countryAccountsId: string;
	divisionId: string | null;
}

async function resolveTenant(
	tx: Tx,
	iso3: string,
	opts: LoadOptions,
	cache: Map<string, string | string[]>,
): Promise<{ id: string } | { error: string }> {
	if (opts.countryAccountsId) {
		const res = await tx.execute(sql`
			SELECT c.iso3 FROM country_accounts ca
			JOIN countries c ON c.id = ca.country_id
			WHERE ca.id = ${opts.countryAccountsId}
		`);
		const row = res.rows[0] as { iso3: string | null } | undefined;
		if (!row) return { error: `tenant ${opts.countryAccountsId} not found` };
		if ((row.iso3 ?? "").toUpperCase() !== iso3) {
			return {
				error: `iso3 ${iso3} does not match the tenant's country (${row.iso3 ?? "none"})`,
			};
		}
		return { id: opts.countryAccountsId };
	}
	let hit = cache.get(iso3);
	if (hit === undefined) {
		const res = await tx.execute(sql`
			SELECT ca.id FROM country_accounts ca
			JOIN countries c ON c.id = ca.country_id
			WHERE upper(c.iso3) = ${iso3}
			ORDER BY ca.id
		`);
		const ids = (res.rows as { id: string }[]).map((r) => r.id);
		hit = ids.length === 1 ? ids[0] : ids;
		cache.set(iso3, hit);
	}
	if (typeof hit === "string") return { id: hit };
	if (hit.length === 0) return { error: `no country account for iso3 ${iso3}` };
	return {
		error: `${hit.length} country accounts for iso3 ${iso3}; pass --tenant to choose one`,
	};
}

async function resolveDivision(
	tx: Tx,
	countryAccountsId: string,
	divisionKey: string,
	iso3: string,
): Promise<{ id: string | null } | { error: string }> {
	if (
		divisionKey.toUpperCase() === iso3 ||
		NATIONAL_KEYS.includes(divisionKey.toLowerCase())
	) {
		return { id: null };
	}
	for (const col of ["national_id", "import_id"] as const) {
		const res = await tx.execute(sql`
			SELECT id FROM division
			WHERE country_accounts_id = ${countryAccountsId}
				AND ${sql.identifier(col)} = ${divisionKey}
		`);
		if (res.rows.length === 1)
			return { id: (res.rows[0] as { id: string }).id };
	}
	return {
		error: `division_key ${divisionKey}: no division with that national_id or import_id in the tenant`,
	};
}

async function checkIndicator(
	tx: Tx,
	v: ReferenceValueInput,
	cache: Map<string, Record<string, string> | null>,
): Promise<string | null> {
	let ind = cache.get(v.indicator_code);
	if (ind === undefined) {
		const res = await tx.execute(sql`
			SELECT family, quantity_type, unit FROM ref.indicator WHERE code = ${v.indicator_code}
		`);
		ind = (res.rows[0] as Record<string, string> | undefined) ?? null;
		cache.set(v.indicator_code, ind);
	}
	if (!ind) return `indicator_code ${v.indicator_code}: not in ref.indicator`;
	const diffs = (["family", "quantity_type", "unit"] as const).filter(
		(k) => ind[k] !== v[k],
	);
	if (diffs.length > 0) {
		return `indicator_code ${v.indicator_code}: ${diffs
			.map((k) => `${k} '${v[k]}' differs from ref.indicator '${ind[k]}'`)
			.join("; ")}`;
	}
	return null;
}

interface SourceRow {
	id: string;
	licence: string;
	redistribution_rule: string;
	source_status: string;
	rdls_id: string | null;
}

async function upsertSource(
	tx: Tx,
	v: ReferenceValueInput,
	report: LoadReport,
	cache: Map<string, SourceRow>,
): Promise<{ id: string } | { error: string }> {
	let s = cache.get(v.source);
	if (!s) {
		const res = await tx.execute(sql`
			SELECT id, licence, redistribution_rule, source_status, rdls_id
			FROM ref.source WHERE name = ${v.source}
		`);
		s = res.rows[0] as unknown as SourceRow | undefined;
		if (!s) {
			const ins = await tx.execute(sql`
				INSERT INTO ref.source (name, licence, redistribution_rule, source_status, rdls_id)
				VALUES (${v.source}, ${v.licence}, ${v.redistribution_rule}, ${v.source_status}, ${v.rdls_id})
				RETURNING id, licence, redistribution_rule, source_status, rdls_id
			`);
			s = ins.rows[0] as unknown as SourceRow;
			report.sourcesCreated += 1;
		}
		cache.set(v.source, s);
	}
	const diffs = (
		["licence", "redistribution_rule", "source_status"] as const
	).filter((k) => s[k] !== v[k]);
	if (diffs.length > 0) {
		return {
			error: `source ${v.source}: ${diffs
				.map((k) => `${k} '${v[k]}' differs from ref.source '${s[k]}'`)
				.join("; ")}`,
		};
	}
	return { id: s.id };
}

async function upsertRelease(
	tx: Tx,
	sourceId: string,
	v: ReferenceValueInput,
	report: LoadReport,
	cache: Map<string, string>,
): Promise<string> {
	const key = `${sourceId}\u0000${v.release}`;
	const hit = cache.get(key);
	if (hit) return hit;
	const res = await tx.execute(sql`
		SELECT id FROM ref.release WHERE source_id = ${sourceId} AND version = ${v.release}
	`);
	let id = (res.rows[0] as { id: string } | undefined)?.id;
	if (!id) {
		const ins = await tx.execute(sql`
			INSERT INTO ref.release (source_id, source_status, version)
			VALUES (${sourceId}, ${v.source_status}, ${v.release})
			RETURNING id
		`);
		id = (ins.rows[0] as { id: string }).id;
		report.releasesCreated += 1;
	}
	cache.set(key, id);
	return id;
}

async function upsertValue(
	tx: Tx,
	r: Resolved,
	releaseId: string,
): Promise<"inserted" | "updated" | "unchanged"> {
	const v = r.value;
	const res = await tx.execute(sql`
		INSERT INTO ref.value AS t (
			country_accounts_id, division_id, boundary_vintage, indicator_code,
			release_id, source_status, period_start, period_end, value, value_state,
			lower_bound, upper_bound, method, grade
		) VALUES (
			${r.countryAccountsId}, ${r.divisionId}::uuid, ${v.boundary_vintage}, ${v.indicator_code},
			${releaseId}, ${v.source_status}, ${v.period_start}::date, ${v.period_end}::date,
			${v.value}::double precision, ${v.value_state},
			${v.lower_bound}::double precision, ${v.upper_bound}::double precision,
			${v.method}, ${v.grade}
		)
		ON CONFLICT (country_accounts_id, COALESCE(division_id, '00000000-0000-0000-0000-000000000000'::uuid), indicator_code, release_id, period_start)
		DO UPDATE SET
			boundary_vintage = EXCLUDED.boundary_vintage,
			source_status = EXCLUDED.source_status,
			period_end = EXCLUDED.period_end,
			value = EXCLUDED.value,
			value_state = EXCLUDED.value_state,
			lower_bound = EXCLUDED.lower_bound,
			upper_bound = EXCLUDED.upper_bound,
			method = EXCLUDED.method,
			grade = EXCLUDED.grade
		WHERE (t.boundary_vintage, t.source_status, t.period_end, t.value, t.value_state,
				t.lower_bound, t.upper_bound, t.method, t.grade)
			IS DISTINCT FROM
			(EXCLUDED.boundary_vintage, EXCLUDED.source_status, EXCLUDED.period_end, EXCLUDED.value,
				EXCLUDED.value_state, EXCLUDED.lower_bound, EXCLUDED.upper_bound, EXCLUDED.method,
				EXCLUDED.grade)
		RETURNING (xmax = 0) AS inserted
	`);
	if (res.rows.length === 0) return "unchanged";
	return (res.rows[0] as { inserted: boolean }).inserted
		? "inserted"
		: "updated";
}

/**
 * Validates, resolves and upserts the rows. With dryRun, the same work runs
 * inside a transaction that is rolled back, so the counts are exact and
 * nothing is kept.
 */
export async function loadReferenceRows(
	rows: CsvRow[],
	opts: LoadOptions = {},
): Promise<LoadReport> {
	const report: LoadReport = {
		dryRun: !!opts.dryRun,
		rowsRead: rows.length,
		rowsValid: 0,
		rowsRejected: 0,
		inserted: 0,
		updated: 0,
		unchanged: 0,
		sourcesCreated: 0,
		releasesCreated: 0,
		rejected: [],
		fileErrors: [],
	};
	const reject = (i: number, row: CsvRow, errors: string[]) => {
		report.rejected.push({
			row: i + 1,
			iso3: (row.iso3 ?? "").trim(),
			divisionKey: (row.division_key ?? "").trim(),
			errors,
		});
	};

	try {
		await dr.transaction(async (tx) => {
			const tenantCache = new Map<string, string | string[]>();
			const indicatorCache = new Map<string, Record<string, string> | null>();
			const sourceCache = new Map<string, SourceRow>();
			const releaseCache = new Map<string, string>();
			const seenKeys = new Map<string, number>();

			for (let i = 0; i < rows.length; i++) {
				const row = rows[i];
				const checked = validateReferenceValueCells(row);
				const iso3 = (row.iso3 ?? "").trim().toUpperCase();
				const errors = checked.ok ? [] : [...checked.errors];
				if (!/^[A-Z]{3}$/.test(iso3)) {
					errors.push("iso3: required, three letters");
				}
				if (!checked.ok || errors.length > 0) {
					reject(i, row, errors);
					continue;
				}
				const v = checked.row;

				const tenant = await resolveTenant(tx, iso3, opts, tenantCache);
				if ("error" in tenant) {
					reject(i, row, [tenant.error]);
					continue;
				}
				const indicatorError = await checkIndicator(tx, v, indicatorCache);
				if (indicatorError) {
					reject(i, row, [indicatorError]);
					continue;
				}
				const division = await resolveDivision(
					tx,
					tenant.id,
					v.division_key,
					iso3,
				);
				if ("error" in division) {
					reject(i, row, [division.error]);
					continue;
				}
				const source = await upsertSource(tx, v, report, sourceCache);
				if ("error" in source) {
					reject(i, row, [source.error]);
					continue;
				}
				const releaseId = await upsertRelease(
					tx,
					source.id,
					v,
					report,
					releaseCache,
				);

				const key = [
					tenant.id,
					division.id ?? "national",
					v.indicator_code,
					releaseId,
					v.period_start,
				].join("|");
				const first = seenKeys.get(key);
				if (first !== undefined) {
					reject(i, row, [
						`duplicate of row ${first} (same tenant, division, indicator, release and period_start)`,
					]);
					continue;
				}
				seenKeys.set(key, i + 1);

				const outcome = await upsertValue(
					tx,
					{
						row: i + 1,
						value: v,
						countryAccountsId: tenant.id,
						divisionId: division.id,
					},
					releaseId,
				);
				report[outcome] += 1;
				report.rowsValid += 1;
			}

			if (opts.dryRun) throw new DryRunRollback();
		});
	} catch (e) {
		if (!(e instanceof DryRunRollback)) throw e;
	}

	report.rowsRejected = report.rejected.length;
	return report;
}

/** Parses and loads a CSV text. A file error stops the load before any write. */
export async function loadReferenceCsv(
	text: string,
	opts: LoadOptions = {},
): Promise<LoadReport> {
	const { rows, fileErrors } = await parseReferenceCsv(text);
	if (fileErrors.length > 0) {
		return {
			dryRun: !!opts.dryRun,
			rowsRead: rows.length,
			rowsValid: 0,
			rowsRejected: 0,
			inserted: 0,
			updated: 0,
			unchanged: 0,
			sourcesCreated: 0,
			releasesCreated: 0,
			rejected: [],
			fileErrors,
		};
	}
	return loadReferenceRows(rows, opts);
}
