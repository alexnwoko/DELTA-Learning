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
// A null total stays null (TR-076). A record that reports nothing but people
// relocated after the event (total equal to that subtotal) is not reported
// for displaced, never a confirmed 0; the relocated measure still counts it.
// A record that reports evacuation explicitly as 0 (a pre-emptive row of 0)
// stays a confirmed 0.

import { SQL, sql } from "drizzle-orm";

/** Rows split by timing and duration alone: no other dimension is set. */
function onlyTimingAndDuration(): SQL {
	return sql`dsp_r."assisted" IS NULL
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
			)`;
}

/** The relocated-after-the-event subtotal for one record. */
function relocatedSubtotal(recordId: SQL): SQL {
	return sql`COALESCE((
		SELECT SUM(dsp_r."displaced")
		FROM "human_dsg" hd_r
		JOIN "displaced" dsp_r ON dsp_r."dsg_id" = hd_r."id"
		WHERE hd_r."record_id" = ${recordId}
			AND dsp_r."timing" = 'reactive'
			AND dsp_r."duration" = 'permanent'
			AND ${onlyTimingAndDuration()}
	), 0)`;
}

/** Whether the record reports evacuation before the event, even as 0. */
function reportsEvacuation(recordId: SQL): SQL {
	return sql`EXISTS (
		SELECT 1
		FROM "human_dsg" hd_r
		JOIN "displaced" dsp_r ON dsp_r."dsg_id" = hd_r."id"
		WHERE hd_r."record_id" = ${recordId}
			AND dsp_r."timing" = 'pre-emptive'
			AND dsp_r."displaced" IS NOT NULL
			AND ${onlyTimingAndDuration()}
	)`;
}

/**
 * The displaced figure for raw SQL in which human_category_presence has the
 * given alias, for example `displacedHeadlineSql("hcp")`.
 */
function displacedFigure(total: SQL, recordId: SQL): SQL {
	const sub = relocatedSubtotal(recordId);
	return sql`(CASE
		WHEN ${sub} > 0 AND ${total} = ${sub} AND NOT ${reportsEvacuation(recordId)}
			THEN NULL
		ELSE ${total} - ${sub}
	END)`;
}

export function displacedHeadlineSql(hcpAlias: string): SQL {
	const a = sql.raw(`"${hcpAlias}"`);
	return displacedFigure(sql`${a}."displaced_total"`, sql`${a}."record_id"`);
}

/**
 * The displaced figure for Drizzle queries that select from
 * human_category_presence without an alias.
 */
export const displacedHeadlineCol: SQL = displacedFigure(
	sql`"human_category_presence"."displaced_total"`,
	sql`"human_category_presence"."record_id"`,
);

// Evacuated and relocated, read from the typed displaced rows (contract
// O-2). Evacuated (Sendai G-6 source) is the pre-emptive rows; relocated is
// every permanent row, before or after the event. Each is null when the
// record has no such row: not reported, never 0 (TR-076). They are never
// added to each other or to displaced.

function typedSubtotal(recordId: SQL, rowFilter: SQL): SQL {
	return sql`(
		SELECT SUM(dsp_r."displaced")
		FROM "human_dsg" hd_r
		JOIN "displaced" dsp_r ON dsp_r."dsg_id" = hd_r."id"
		WHERE hd_r."record_id" = ${recordId}
			AND ${rowFilter}
			AND ${onlyTimingAndDuration()}
	)`;
}

/** People evacuated before the event, for raw SQL with the given alias. */
export function evacuatedSql(hcpAlias: string): SQL {
	const a = sql.raw(`"${hcpAlias}"`);
	return typedSubtotal(
		sql`${a}."record_id"`,
		sql`dsp_r."timing" = 'pre-emptive'`,
	);
}

/** People relocated permanently, for raw SQL with the given alias. */
export function relocatedSql(hcpAlias: string): SQL {
	const a = sql.raw(`"${hcpAlias}"`);
	return typedSubtotal(
		sql`${a}."record_id"`,
		sql`dsp_r."duration" = 'permanent'`,
	);
}
