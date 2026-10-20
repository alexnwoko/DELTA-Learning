// Hazard by month, years pooled (Alex, 2026-10-19): the loader behind
// ~/utils/dashboard/hazardMonth. On Disaster impact each occurrence is a
// disaster record (its start month and HIPs hazard); on Disaster events it is
// a disaster event (the event's start month; the HIPs hazards of its linked
// records, since events carry no hazard of their own). Rows are specific HIPs
// hazards, so Drought and Flooding appear by name; occurrences with no usable
// month (a placeholder date or a year-only start) are counted per row, never
// dropped. People are the chosen human effect, with value states (TR-076).

import { cachedDashboard } from "~/backend.server/models/analytics/dashboard/dashboardCache.server";
import { sql, type SQL } from "drizzle-orm";
import { displacedHeadlineSql } from "~/backend.server/models/analytics/displacedHeadline";
import {
	underReviewFor,
	humanEffectsFilteredRecords,
} from "~/backend.server/models/analytics/hazard-analysis";
import {
	eventsCte,
	linkedRecordsCte,
} from "~/backend.server/models/analytics/dashboard/eventPanels.server";
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
import type { ImpactHeadlineMeasure } from "~/utils/dashboard/impactPanels";
import type {
	HazardMonth,
	HazardMonthRow,
} from "~/utils/dashboard/hazardMonth";
import { measureValue } from "~/utils/valueState";

/**
 * A month cell is a rare severe outlier when it holds few occurrences that
 * carry a high toll for its hazard: at most maxCount occurrences, and people
 * per reporting occurrence at least `multiple` times the hazard's median per
 * occurrence, for hazards with at least minReporting reporting occurrences.
 * Occurrences under review never count toward it.
 */
export const RARE_SEVERE_RULE = {
	maxCount: 2,
	multiple: 5,
	minReporting: 10,
} as const;

/**
 * A calendar day (month and day, any year) is a placeholder date when it
 * holds at least minRecords occurrences and at least `multiple` times the
 * average per calendar day of the dated occurrences in scope. Examples:
 * Angola, 72 records on 31 January; Ethiopia, 7,445 on 7 September (the
 * DesInventar source itself carries 2008-9-7, 2007-9-7 and so on).
 */
export const PLACEHOLDER_DATE_RULE = { minRecords: 10, multiple: 10 } as const;

/** The people measure when the query names none (Alex, 2026-10-19). */
export const HAZARD_MONTH_DEFAULT_MEASURE: ImpactHeadlineMeasure =
	"affected_direct";

const DAY_RE = /^\d{4}-(\d{2}-\d{2})/;
/** "MM-DD" of a day-precise date, else null. */
const calendarDay = (d: unknown): string | null =>
	typeof d === "string" ? (d.match(DAY_RE)?.[1] ?? null) : null;

/** Calendar days ("MM-DD") that are placeholders among day-precise dates. */
export function placeholderDays(
	dates: (string | null | undefined)[],
): Map<string, number> {
	const counts = new Map<string, number>();
	let dated = 0;
	for (const d of dates) {
		const day = calendarDay(d);
		if (!day) continue;
		dated++;
		counts.set(day, (counts.get(day) ?? 0) + 1);
	}
	const avg = dated / 365;
	return new Map(
		[...counts].filter(
			([, n]) =>
				n >= PLACEHOLDER_DATE_RULE.minRecords &&
				n >= PLACEHOLDER_DATE_RULE.multiple * avg,
		),
	);
}

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

/** Per-record value and confirmed-zero tests for a measure. */
function recordMeasure(m: ImpactHeadlineMeasure) {
	const total =
		m === "displaced"
			? displacedHeadlineSql("hcp")
			: sql.raw(`hcp."${m}_total"`);
	const flag = sql.raw(`hcp."${m}"`);
	return {
		value: sql`CASE WHEN ${total} > 0 THEN ${total} END`,
		zero: sql`COALESCE((${total} = 0 AND ${flag} IS TRUE) OR (${flag} IS FALSE AND COALESCE(${total}, 0) = 0), false)`,
	};
}

/** Row key of a record: its specific hazard, else its cluster, else none. */
const rowKey = (rec: string) =>
	sql.raw(
		`COALESCE(NULLIF(${rec}."hip_hazard_id", ''), 'cluster:' || NULLIF(${rec}."hip_cluster_id", ''), 'none')`,
	);
const monthOf = (col: SQL) =>
	sql`NULLIF(substring(${col} from '^[0-9]{4}-([0-9]{2})'), '')::int`;
const yearOf = (col: SQL) =>
	sql`NULLIF(substring(${col} from '^[0-9]{4}'), '')::int`;
const dayOf = (col: SQL) =>
	sql`substring(${col} from '^[0-9]{4}-([0-9]{2}-[0-9]{2})')`;

/** One occurrence group: a row key, a month (or none) and its tallies. */
interface Tally {
	key: string;
	cluster: string | null;
	/** 1 to 12; null when the month is unknown or a placeholder. */
	month: number | null;
	placeholder: boolean;
	noMonth: boolean;
	total: number;
	sum: number;
	reported: number;
	zero: number;
	flagged: number;
}

interface HazardNames {
	hazards: Map<string, { label: string; cluster: string }>;
	clusters: Map<string, { label: string; typeId: string | null }>;
}

async function hazardNames(): Promise<HazardNames> {
	const [hz, cl] = await Promise.all([
		rows(
			sql`SELECT "id"::text AS id, "name_en" AS name, "cluster_id"::text AS cluster FROM "hip_hazard"`,
		),
		rows(
			sql`SELECT "id"::text AS id, "name_en" AS name, "type_id"::text AS type_id FROM "hip_cluster"`,
		),
	]);
	return {
		hazards: new Map(
			hz.map((r) => [
				r.id as string,
				{ label: r.name as string, cluster: r.cluster as string },
			]),
		),
		clusters: new Map(
			cl.map((r) => [
				r.id as string,
				{
					label: r.name as string,
					typeId: (r.type_id as string | null) ?? null,
				},
			]),
		),
	};
}

const sumOf = (list: Tally[], f: (t: Tally) => number) =>
	list.reduce((s, t) => s + f(t), 0);

function buildRows(
	tallies: Tally[],
	medians: Map<string, { median: number | null; n: number }>,
	names: HazardNames,
): HazardMonthRow[] {
	const by = new Map<string, Tally[]>();
	for (const t of tallies) by.set(t.key, [...(by.get(t.key) ?? []), t]);
	return [...by]
		.map(([key, list]): HazardMonthRow => {
			const med = medians.get(key);
			const dated = list.filter((t) => t.month !== null);
			const cells = MONTHS.map((month) => {
				const c = dated.filter((t) => t.month === month);
				const total = sumOf(c, (t) => t.total);
				const sum = sumOf(c, (t) => t.sum);
				const reported = sumOf(c, (t) => t.reported);
				const people = measureValue({
					sum: reported > 0 ? sum : null,
					reported,
					zeroConfirmed: sumOf(c, (t) => t.zero),
					total,
				});
				const perOcc = reported > 0 ? sum / reported : 0;
				const rare =
					total > 0 &&
					total <= RARE_SEVERE_RULE.maxCount &&
					sumOf(c, (t) => t.flagged) === 0 &&
					!!med &&
					med.n >= RARE_SEVERE_RULE.minReporting &&
					med.median !== null &&
					med.median > 0 &&
					perOcc >= RARE_SEVERE_RULE.multiple * med.median;
				return { month, count: total, people, rare };
			});
			const level: HazardMonthRow["level"] =
				key === "none"
					? "none"
					: key.startsWith("cluster:")
						? "cluster"
						: "hazard";
			const hazard = level === "hazard" ? names.hazards.get(key) : undefined;
			const clusterId =
				level === "cluster"
					? key.slice("cluster:".length)
					: (hazard?.cluster ?? list.find((t) => t.cluster)?.cluster ?? null);
			const cluster = clusterId ? names.clusters.get(clusterId) : undefined;
			const datedReported = sumOf(dated, (t) => t.reported);
			return {
				key,
				level,
				label:
					level === "none"
						? "Hazard not coded"
						: level === "hazard"
							? (hazard?.label ?? `HIPs hazard ${key}`)
							: // Coded to a cluster only: say so, so the row is never read as a group heading (Alex, 2026-10-19: the direct hazard, not the top grouping).
								`${cluster?.label ?? `HIPs cluster ${clusterId}`} (specific hazard not recorded)`,
				hipHazardId: level === "hazard" ? key : null,
				hipClusterId: clusterId,
				clusterLabel: cluster?.label ?? null,
				hipTypeId: cluster?.typeId ?? null,
				total: cells.reduce((s, c) => s + c.count, 0),
				allOccurrences: sumOf(list, (t) => t.total),
				people: measureValue({
					sum: datedReported > 0 ? sumOf(dated, (t) => t.sum) : null,
					reported: datedReported,
					zeroConfirmed: sumOf(dated, (t) => t.zero),
					total: sumOf(dated, (t) => t.total),
				}),
				unplaced: {
					placeholder: sumOf(
						list.filter((t) => t.placeholder),
						(t) => t.total,
					),
					noMonth: sumOf(
						list.filter((t) => t.noMonth),
						(t) => t.total,
					),
				},
				cells,
			};
		})
		.sort(
			(a, b) =>
				b.allOccurrences - a.allOccurrences || a.label.localeCompare(b.label),
		);
}

const methodText = (unit: HazardMonth["unit"], m: ImpactHeadlineMeasure) =>
	`${unit === "disaster_record" ? "Disaster records" : "Disaster events"} by specific HIPs hazard (or cluster when no hazard is coded) and start month, all years pooled; people = ${m}, with value states (a month with occurrences but no reported figure is not reported, never 0). ${
		unit === "disaster_event"
			? "An event takes the hazards of its linked disaster records and counts under each. "
			: ""
	}Occurrences with no usable month are counted per hazard, not drawn: placeholder dates (a calendar day with ${PLACEHOLDER_DATE_RULE.minRecords} or more occurrences and ${PLACEHOLDER_DATE_RULE.multiple} times the daily average, such as a source default of 7 September) and year-only starts. Rare severe: at most ${RARE_SEVERE_RULE.maxCount} occurrences in the month and ${m} per reporting occurrence at least ${RARE_SEVERE_RULE.multiple} times the hazard's median, for hazards with ${RARE_SEVERE_RULE.minReporting} or more reporting occurrences; occurrences under review (a plausibility flag or above the ceiling) never make a month rare and are left out of the median. The start month is a reporting date for slow-onset hazards such as drought, a weak guide to onset. More records can reflect more reporting.`;

async function computeHazardMonth(
	query: DeltaQuery,
	ctx: ImpactPanelsContext,
	unit: HazardMonth["unit"],
): Promise<HazardMonth> {
	const { filters, notApplied } = impactFiltersFromQuery(query, ctx);
	// Alex, 2026-10-19: people directly affected by default here (deaths when
	// the query asks for them), so the switch shows the breadth of impact.
	const measure: ImpactHeadlineMeasure = query.measure
		? chosenMeasure(query)
		: HAZARD_MONTH_DEFAULT_MEASURE;
	const rm = recordMeasure(measure);
	const names = await hazardNames();
	let tallies: Tally[];
	const medians = new Map<string, { median: number | null; n: number }>();
	let phDays: Map<string, number>;
	let years: HazardMonth["years"];

	if (unit === "disaster_record") {
		const fr = humanEffectsFilteredRecords(filters);
		const base = sql`
			WITH RECURSIVE ${fr},
			rv0 AS (
				SELECT ${rowKey("rec")} AS k, NULLIF(rec."hip_cluster_id", '') AS cl,
					${dayOf(sql`rec."start_date"`)} AS md,
					${monthOf(sql`rec."start_date"`)} AS month0,
					${yearOf(sql`rec."start_date"`)} AS year,
					${rm.value} AS v, ${rm.zero} AS z,
					${underReviewFor(measure, sql`fr.pflags`, rm.value)} AS fl
				FROM filtered_records fr
				JOIN "disaster_records" rec ON rec."id" = fr.record_id
				LEFT JOIN "human_category_presence" hcp ON hcp."record_id" = fr.record_id
			),
			ph AS (
				SELECT md, COUNT(*) AS n FROM rv0 WHERE md IS NOT NULL GROUP BY md
				HAVING COUNT(*) >= ${PLACEHOLDER_DATE_RULE.minRecords}
					AND COUNT(*) >= ${PLACEHOLDER_DATE_RULE.multiple} *
						(SELECT COUNT(*) FROM rv0 WHERE md IS NOT NULL) / 365.0
			),
			rv AS (
				SELECT rv0.*, (ph.md IS NOT NULL) AS placeholder,
					CASE WHEN ph.md IS NULL THEN rv0.month0 END AS month
				FROM rv0 LEFT JOIN ph ON ph.md = rv0.md
			)`;
		const [groups, med, span, days] = await Promise.all([
			rows(sql`${base}
				SELECT k, cl, month, placeholder,
					(year IS NOT NULL AND month0 IS NULL) AS no_month,
					COUNT(*) AS total, SUM(v) AS sum, COUNT(v) AS reported,
					COUNT(*) FILTER (WHERE v IS NULL AND z) AS zero,
					COUNT(*) FILTER (WHERE fl) AS flagged
				FROM rv GROUP BY 1, 2, 3, 4, 5`),
			rows(sql`${base}
				SELECT k, percentile_cont(0.5) WITHIN GROUP (ORDER BY v) AS median, COUNT(v) AS n
				FROM rv WHERE v IS NOT NULL AND NOT fl AND month IS NOT NULL GROUP BY 1`),
			rows(sql`${base} SELECT MIN(year) AS y0, MAX(year) AS y1 FROM rv`),
			rows(sql`${base} SELECT md, n FROM ph`),
		]);
		tallies = groups.map((r) => ({
			key: r.k as string,
			cluster: (r.cl as string | null) ?? null,
			month: r.month == null ? null : num(r.month),
			placeholder: r.placeholder === true,
			noMonth: r.no_month === true,
			total: num(r.total),
			sum: num(r.sum),
			reported: num(r.reported),
			zero: num(r.zero),
			flagged: num(r.flagged),
		}));
		for (const r of med)
			medians.set(r.k as string, {
				median: r.median === null ? null : Number(r.median),
				n: num(r.n),
			});
		phDays = new Map(days.map((r) => [r.md as string, num(r.n)]));
		years =
			span[0]?.y0 != null
				? { from: num(span[0].y0), to: num(span[0].y1) }
				: null;
	} else {
		const ev = eventsCte(filters);
		const lr = linkedRecordsCte(filters);
		const perEvent = await rows(sql`
			WITH RECURSIVE ${ev}, ${lr},
			pe AS (
				SELECT fr.event_id, SUM(${rm.value}) AS s, COUNT(${rm.value}) AS rep,
					COUNT(*) FILTER (WHERE ${rm.value} IS NULL AND ${rm.zero}) AS z,
					COUNT(*) FILTER (WHERE ${underReviewFor(measure, sql`fr.pflags`, rm.value)}) AS fl
				FROM filtered_records fr
				LEFT JOIN "human_category_presence" hcp ON hcp."record_id" = fr.record_id
				GROUP BY 1
			),
			ek AS (
				SELECT DISTINCT fr.event_id, ${rowKey("rec")} AS k, NULLIF(rec."hip_cluster_id", '') AS cl
				FROM filtered_records fr
				JOIN "disaster_records" rec ON rec."id" = fr.record_id
			)
			SELECT ev."id"::text AS id, ev.start_date,
				${monthOf(sql`ev.start_date`)} AS month0, ${yearOf(sql`ev.start_date`)} AS year,
				COALESCE(ek.k, 'none') AS k, ek.cl,
				pe.s, COALESCE(pe.rep, 0) AS rep, COALESCE(pe.z, 0) AS z, COALESCE(pe.fl, 0) AS fl
			FROM ev
			LEFT JOIN ek ON ek.event_id = ev."id"
			LEFT JOIN pe ON pe.event_id = ev."id"`);
		phDays = placeholderDays([
			...new Map(
				perEvent.map((r) => [r.id as string, r.start_date as string | null]),
			).values(),
		]);
		tallies = perEvent.map((r) => {
			const ph = phDays.has(calendarDay(r.start_date) ?? "");
			const reported = num(r.rep) > 0;
			return {
				key: r.k as string,
				cluster: (r.cl as string | null) ?? null,
				month: ph || r.month0 == null ? null : num(r.month0),
				placeholder: ph,
				noMonth: r.year != null && r.month0 == null,
				total: 1,
				sum: reported ? num(r.s) : 0,
				reported: reported ? 1 : 0,
				zero: !reported && num(r.z) > 0 ? 1 : 0,
				flagged: num(r.fl) > 0 ? 1 : 0,
			};
		});
		const byKey = new Map<string, number[]>();
		for (const t of tallies) {
			if (t.month === null || t.reported === 0 || t.flagged > 0) continue;
			byKey.set(t.key, [...(byKey.get(t.key) ?? []), t.sum]);
		}
		for (const [k, vs] of byKey) {
			const s = [...vs].sort((a, b) => a - b);
			const mid = Math.floor(s.length / 2);
			medians.set(k, {
				median: s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2,
				n: s.length,
			});
		}
		const ys = perEvent
			.map((r) => r.year)
			.filter((y) => y != null)
			.map(Number);
		years = ys.length ? { from: Math.min(...ys), to: Math.max(...ys) } : null;
	}

	const rowsOut = buildRows(tallies, medians, names);
	return {
		unit,
		measure,
		rows: rowsOut,
		withoutMonth: rowsOut.reduce((s, r) => s + r.unplaced.noMonth, 0),
		placeholderDates: rowsOut.reduce((s, r) => s + r.unplaced.placeholder, 0),
		placeholderDays: [...phDays]
			.map(([d, n]) => ({ day: d, occurrences: n }))
			.sort((a, b) => b.occurrences - a.occurrences),
		years,
		meta: { method: methodText(unit, measure), notApplied },
	};
}

/** Hazard by month, reused for DASHBOARD_CACHE_TTL_MS per tenant, audience, query and unit. */
export function getHazardMonth(
	query: DeltaQuery,
	ctx: ImpactPanelsContext,
	unit: HazardMonth["unit"],
): Promise<HazardMonth> {
	return cachedDashboard("getHazardMonth", [ctx, query, unit], () =>
		computeHazardMonth(query, ctx, unit),
	);
}
