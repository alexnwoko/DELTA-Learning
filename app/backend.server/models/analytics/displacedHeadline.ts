// Displaced, without the people relocated afterwards (Alex, 2026-10-16;
// contract O-2 with Backend Migration).
//
// The platform keeps displaced people as one population split by timing and
// duration: the rows of a record may not add up to more than its total
// (validate.ts). A record that reports 109 evacuated and 2,000 relocated is
// therefore stored with displaced_total 2,109. Evacuated and relocated
// people are never added together in a figure (SDG 1.5.1 metadata), so the
// displaced figure is the stored total minus the rows of people relocated
// after the event: timing 'reactive' and duration 'permanent'. People
// evacuated before the event and then relocated (one row, pre-emptive and
// permanent) stay in the figure once.
//
// Only rows split by timing and duration alone are subtracted; rows that are
// also split by sex, age or another dimension belong to other groups.
// A null total stays null (TR-076).

import { SQL, sql } from "drizzle-orm";

/** The relocated-after-the-event subtotal for one record. */
function relocatedSubtotal(recordId: SQL): SQL {
	return sql`COALESCE((
		SELECT SUM(dsp_r."displaced")
		FROM "human_dsg" hd_r
		JOIN "displaced" dsp_r ON dsp_r."dsg_id" = hd_r."id"
		WHERE hd_r."record_id" = ${recordId}
			AND dsp_r."timing" = 'reactive'
			AND dsp_r."duration" = 'permanent'
			AND dsp_r."assisted" IS NULL
			AND hd_r."sex" IS NULL
			AND hd_r."age" IS NULL
			AND hd_r."disability" IS NULL
			AND hd_r."global_poverty_line" IS NULL
			AND hd_r."national_poverty_line" IS NULL
			AND (
				hd_r."custom" IS NULL
				OR hd_r."custom" = '{}'::jsonb
				OR (
					SELECT COUNT(*)
					FROM jsonb_each(hd_r."custom")
					WHERE jsonb_typeof(value) != 'null'
				) = 0
			)
	), 0)`;
}

/**
 * The displaced figure for raw SQL in which human_category_presence has the
 * given alias, for example `displacedHeadlineSql("hcp")`.
 */
export function displacedHeadlineSql(hcpAlias: string): SQL {
	const a = sql.raw(`"${hcpAlias}"`);
	return sql`(${a}."displaced_total" - ${relocatedSubtotal(sql`${a}."record_id"`)})`;
}

/**
 * The displaced figure for Drizzle queries that select from
 * human_category_presence without an alias.
 */
export const displacedHeadlineCol: SQL = sql`("human_category_presence"."displaced_total" - ${relocatedSubtotal(
	sql`"human_category_presence"."record_id"`,
)})`;
