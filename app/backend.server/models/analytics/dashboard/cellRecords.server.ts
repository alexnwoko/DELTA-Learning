// The records behind a month cell of Hazard by month (FR-AN-068), the loader
// behind ~/utils/dashboard/cellRecords. It reads the same CTEs as the panel,
// so the list and the cell count the same records under the same approval
// basis and tenant. Nothing is excluded: flagged records are listed and marked.

import { sql } from "drizzle-orm";
import {
	recordMonthCtes,
	HAZARD_MONTH_DEFAULT_MEASURE,
} from "~/backend.server/models/analytics/dashboard/hazardMonth.server";
import {
	chosenMeasure,
	impactFiltersFromQuery,
	type ImpactPanelsContext,
} from "~/backend.server/models/analytics/dashboard/impactPanels.server";
import {
	num,
	rows,
} from "~/backend.server/models/analytics/dashboard/impactPanels5to16.server";
import type { DeltaQuery } from "~/utils/deltaQuery";
import type { CellRecords } from "~/utils/dashboard/cellRecords";

/** Records listed per cell, largest first; total says how many there are. */
export const CELL_RECORDS_LIMIT = 100;

export async function getCellRecords(
	query: DeltaQuery,
	ctx: ImpactPanelsContext,
	cell: { key: string; month: number },
): Promise<CellRecords> {
	if (!Number.isInteger(cell.month) || cell.month < 1 || cell.month > 12)
		throw new Error(`invalid month ${cell.month}`);
	const { filters, notApplied } = impactFiltersFromQuery(query, ctx);
	const measure = query.measure
		? chosenMeasure(query)
		: HAZARD_MONTH_DEFAULT_MEASURE;
	const list = await rows(sql`${recordMonthCtes(filters, measure)},
		cell AS (SELECT * FROM rv WHERE k = ${cell.key} AND month = ${cell.month})
		SELECT c.record_id::text AS id, r."start_date" AS start_date, c.v, c.z, c.fl,
			NULLIF(btrim(r."primary_data_source"), '') AS source,
			COUNT(*) OVER () AS total,
			(SELECT COALESCE(array_agg(pf ->> 'code'), '{}')
				FROM jsonb_array_elements(COALESCE(c.pflags, '[]'::jsonb)) AS pf
				WHERE pf ->> 'code' IS NOT NULL) AS flags,
			(SELECT COALESCE(array_agg(COALESCE(d."name" ->> 'en', d."national_id") ORDER BY d."name" ->> 'en'), '{}')
				FROM "disaster_records_division" drd
				JOIN "division" d ON d."id" = drd."division_id"
				WHERE drd."disaster_record_id" = c.record_id) AS places
		FROM cell c
		JOIN "disaster_records" r ON r."id" = c.record_id
		ORDER BY c.v DESC NULLS LAST, r."start_date", c.record_id
		LIMIT ${CELL_RECORDS_LIMIT}`);
	return {
		key: cell.key,
		month: cell.month,
		measure,
		records: list.map((r) => ({
			recordId: r.id as string,
			startDate: (r.start_date as string | null) ?? null,
			places: (r.places as string[]) ?? [],
			value: r.v == null ? null : Number(r.v),
			valueState:
				r.v != null
					? "reported"
					: r.z === true
						? "zero_confirmed"
						: "not_reported",
			flags: (r.flags as string[]) ?? [],
			underReview: r.fl === true,
			source: (r.source as string | null) ?? null,
		})),
		total: num(list[0]?.total),
		meta: {
			method: `Records behind this cell: disaster records of this hazard starting in this month, all years, on the same basis as the panel. Placeholder dates are not in a month. Largest reported ${measure} first, at most ${CELL_RECORDS_LIMIT} listed. Flags are shown; values stay as recorded.`,
			notApplied,
		},
	};
}
