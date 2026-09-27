import { sql } from "drizzle-orm";
import { dr } from "~/db.server";
import {
	PLAUSIBILITY_FIELD_MEASURE,
	type PlausibilityMeasure,
} from "~/utils/plausibility";

export interface PlausibilityFlag {
	code: string;
	fields: string[];
	ruleVersion: string | null;
	note: string | null;
}

export interface PlausibilityReviewItem {
	recordId: string;
	apiImportId: string | null;
	startDate: string | null;
	locationDesc: string | null;
	approvalStatus: string;
	flags: PlausibilityFlag[];
	/** People and housing measures the flags put a caveat on. */
	measures: PlausibilityMeasure[];
}

/**
 * Records of one tenant that carry plausibility flags, for review by the
 * national focal point (solution pack C30). Values are never changed here.
 */
export async function getPlausibilityReviewQueue(
	countryAccountsId: string,
): Promise<PlausibilityReviewItem[]> {
	const res = await dr.execute(sql`
		SELECT
			dr."id" AS record_id,
			dr."api_import_id",
			dr."start_date",
			dr."location_desc",
			dr."approvalStatus" AS approval_status,
			dr."legacy_data" -> 'migration' -> 'plausibility_flags' AS flags
		FROM "disaster_records" dr
		WHERE dr."country_accounts_id" = ${countryAccountsId}
			AND jsonb_typeof(dr."legacy_data" -> 'migration' -> 'plausibility_flags') = 'array'
			AND jsonb_array_length(dr."legacy_data" -> 'migration' -> 'plausibility_flags') > 0
		ORDER BY dr."start_date" NULLS LAST, dr."api_import_id"
	`);
	return res.rows.map((row: any) => {
		const raw: any[] = Array.isArray(row.flags) ? row.flags : [];
		const flags: PlausibilityFlag[] = raw.map((f) => ({
			code: String(f?.code ?? ""),
			fields: Array.isArray(f?.fields) ? f.fields.map(String) : [],
			ruleVersion: f?.rule_version ?? null,
			note: f?.note ?? null,
		}));
		const measures = [
			...new Set(
				flags
					.flatMap((f) => f.fields)
					.map((field) => PLAUSIBILITY_FIELD_MEASURE[field])
					.filter((m): m is PlausibilityMeasure => Boolean(m)),
			),
		];
		return {
			recordId: String(row.record_id),
			apiImportId: row.api_import_id ?? null,
			startDate: row.start_date ?? null,
			locationDesc: row.location_desc ?? null,
			approvalStatus: String(row.approval_status),
			flags,
			measures,
		};
	});
}
