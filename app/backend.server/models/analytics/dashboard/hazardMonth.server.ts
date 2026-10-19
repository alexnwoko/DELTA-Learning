// Hazard by month, years pooled (Alex, 2026-10-19): the loader behind
// ~/utils/dashboard/hazardMonth. On Disaster impact each occurrence is a
// disaster record (its start month and HIPs cluster); on Disaster events it
// is a disaster event (the event's start month; the HIPs clusters of its
// linked records, since events carry no hazard of their own). People are the
// chosen human effect, with value states as everywhere (TR-076).

import { cachedDashboard } from "~/backend.server/models/analytics/dashboard/dashboardCache.server";
import { sql, type SQL } from "drizzle-orm";
import { displacedHeadlineSql } from "~/backend.server/models/analytics/displacedHeadline";
import {
	aboveCeiling,
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
import type { HazardMonth } from "~/utils/dashboard/hazardMonth";
import { measureValue } from "~/utils/valueState";

/**
 * A month cell is a rare severe outlier when it holds few occurrences that
 * carry a high toll for its hazard: at most RARE_MAX_COUNT occurrences, and
 * people per reporting occurrence at least RARE_MULTIPLE times the hazard's
 * median per occurrence, for hazards with at least RARE_MIN_REPORTING
 * reporting occurrences.
 */
export const RARE_SEVERE_RULE = {
	maxCount: 2,
	multiple: 5,
	minReporting: 10,
} as const;

/**
 * A calendar day (month and day, any year) is a placeholder date when it
 * holds at least minRecords occurrences and at least multiple times the
 * average per calendar day of the dated occurrences in scope (2026-10-19
 * seasonality research: Angola, 72 records on 31 January, 57 times the
 * average). Occurrences on it count as having no usable month.
 */
export const PLACEHOLDER_DATE_RULE = { minRecords: 10, multiple: 10 } as const;

/** Calendar days ("MM-DD") that are placeholders among day-precise dates. */
export function placeholderDays(
	dates: (string | null | undefined)[],
): Set<string> {
	const counts = new Map<string, number>();
	let dated = 0;
	for (const d of dates) {
		const m = typeof d === "string" ? /^\d{4}-(\d{2}-\d{2})/.exec(d) : null;
		if (!m) continue;
		dated++;
		counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
	}
	const avg = dated / 365;
	return new Set(
		[...counts]
			.filter(
				([, n]) =>
					n >= PLACEHOLDER_DATE_RULE.minRecords &&
					n >= PLACEHOLDER_DATE_RULE.multiple * avg,
			)
			.map(([k]) => k),
	);
}

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

/** Per-record value, reported and confirmed-zero tests for a measure. */
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

const monthOf = (col: SQL) =>
	sql`NULLIF(substring(${col} from '^[0-9]{4}-([0-9]{2})'), '')::int`;
const yearOf = (col: SQL) =>
	sql`NULLIF(substring(${col} from '^[0-9]{4}'), '')::int`;

interface Occ {
	cluster: string | null;
	month: number;
	sum: number;
	reported: number;
	zero: number;
	total: number;
	median: number | null;
	reportingInHazard: number;
	/** Occurrences under review (plausibility flag or above the ceiling). */
	flagged: number;
}

function buildRows(
	occ: Occ[],
	clusters: Map<string, { label: string; typeId: string | null }>,
): HazardMonth["rows"] {
	const by = new Map<string, Occ[]>();
	for (const o of occ) {
		const k = o.cluster ?? "none";
		by.set(k, [...(by.get(k) ?? []), o]);
	}
	return [...by]
		.map(([id, list]) => {
			const cells = MONTHS.map((month) => {
				const c = list.find((o) => o.month === month);
				const people = measureValue({
					sum: c && c.reported > 0 ? c.sum : null,
					reported: c?.reported ?? 0,
					zeroConfirmed: c?.zero ?? 0,
					total: c?.total ?? 0,
				});
				const perOcc = c && c.reported > 0 ? c.sum / c.reported : 0;
				const rare =
					!!c &&
					c.flagged === 0 &&
					c.total <= RARE_SEVERE_RULE.maxCount &&
					c.reportingInHazard >= RARE_SEVERE_RULE.minReporting &&
					c.median !== null &&
					c.median > 0 &&
					perOcc >= RARE_SEVERE_RULE.multiple * c.median;
				return { month, count: c?.total ?? 0, people, rare };
			});
			const info = id === "none" ? null : clusters.get(id);
			return {
				hipClusterId: id,
				label:
					id === "none"
						? "Hazard not coded"
						: (info?.label ?? `HIPs cluster ${id}`),
				hipTypeId: info?.typeId ?? null,
				total: cells.reduce((s, c) => s + c.count, 0),
				cells,
			};
		})
		.sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
}

async function clusterInfo() {
	const r = await rows(
		sql`SELECT "id"::text AS id, "name_en" AS name, "type_id"::text AS type_id FROM "hip_cluster"`,
	);
	return new Map(
		r.map((x) => [
			x.id as string,
			{ label: x.name as string, typeId: (x.type_id as string | null) ?? null },
		]),
	);
}

const methodText = (unit: HazardMonth["unit"], m: ImpactHeadlineMeasure) =>
	`${unit === "disaster_record" ? "Disaster records" : "Disaster events"} by HIPs cluster and start month, all years pooled; people = ${m} with value states (a month with occurrences but no reported figure is not reported, never 0). ${
		unit === "disaster_event"
			? "An event takes the clusters of its linked disaster records and counts under each. "
			: ""
	}Rare severe: at most ${RARE_SEVERE_RULE.maxCount} occurrences in the month and ${m} per reporting occurrence at least ${RARE_SEVERE_RULE.multiple} times the hazard's median, for hazards with ${RARE_SEVERE_RULE.minReporting} or more reporting occurrences; occurrences under review (a plausibility flag or above the ceiling) never make a month rare and are left out of the median. Placeholder dates (a calendar day with ${PLACEHOLDER_DATE_RULE.minRecords} or more occurrences and ${PLACEHOLDER_DATE_RULE.multiple} times the daily average, such as a default 31 January) count as no month. The start month is a reporting date for slow-onset hazards such as drought, a weak guide to onset. More records can reflect more reporting.`;

async function computeHazardMonth(
	query: DeltaQuery,
	ctx: ImpactPanelsContext,
	unit: HazardMonth["unit"],
): Promise<HazardMonth> {
	const { filters, notApplied } = impactFiltersFromQuery(query, ctx);
	const measure = chosenMeasure(query);
	const rm = recordMeasure(measure);
	const clusters = await clusterInfo();
	let occ: Occ[];
	let withoutMonth: number;
	let placeholderDates: number;
	let years: HazardMonth["years"];

	if (unit === "disaster_record") {
		const fr = humanEffectsFilteredRecords(filters);
		const base = sql`
			WITH RECURSIVE ${fr},
			rv0 AS (
				SELECT NULLIF(rec."hip_cluster_id", '') AS cl,
					substring(rec."start_date" from '^[0-9]{4}-([0-9]{2}-[0-9]{2})') AS md,
					${monthOf(sql`rec."start_date"`)} AS month0,
					${yearOf(sql`rec."start_date"`)} AS year,
					${rm.value} AS v, ${rm.zero} AS z,
					(fr.pflags IS NOT NULL OR ${aboveCeiling(measure, rm.value)}) AS fl
				FROM filtered_records fr
				JOIN "disaster_records" rec ON rec."id" = fr.record_id
				LEFT JOIN "human_category_presence" hcp ON hcp."record_id" = fr.record_id
			),
			ph AS (
				SELECT md FROM rv0 WHERE md IS NOT NULL GROUP BY md
				HAVING COUNT(*) >= ${PLACEHOLDER_DATE_RULE.minRecords}
					AND COUNT(*) >= ${PLACEHOLDER_DATE_RULE.multiple} *
						(SELECT COUNT(*) FROM rv0 WHERE md IS NOT NULL) / 365.0
			),
			rv AS (
				SELECT rv0.*, (ph.md IS NOT NULL) AS placeholder,
					CASE WHEN ph.md IS NULL THEN rv0.month0 END AS month
				FROM rv0 LEFT JOIN ph ON ph.md = rv0.md
			)`;
		const [cells, med, span] = await Promise.all([
			rows(sql`${base}
				SELECT cl, month, COUNT(*) AS total, SUM(v) AS sum,
					COUNT(v) AS reported, COUNT(*) FILTER (WHERE v IS NULL AND z) AS zero,
					COUNT(*) FILTER (WHERE fl) AS flagged
				FROM rv WHERE month BETWEEN 1 AND 12 GROUP BY 1, 2`),
			rows(sql`${base}
				SELECT cl, percentile_cont(0.5) WITHIN GROUP (ORDER BY v) AS median, COUNT(v) AS reporting
				FROM rv WHERE v IS NOT NULL AND NOT fl AND month BETWEEN 1 AND 12 GROUP BY 1`),
			rows(sql`${base}
				SELECT MIN(year) AS y0, MAX(year) AS y1,
					COUNT(*) FILTER (WHERE year IS NOT NULL AND month0 IS NULL) AS no_month,
					COUNT(*) FILTER (WHERE placeholder) AS placeholder
				FROM rv`),
		]);
		const medBy = new Map(
			med.map((r) => [(r.cl as string | null) ?? "none", r]),
		);
		occ = cells.map((r) => {
			const m = medBy.get((r.cl as string | null) ?? "none");
			return {
				cluster: (r.cl as string | null) ?? null,
				month: num(r.month),
				sum: num(r.sum),
				reported: num(r.reported),
				zero: num(r.zero),
				total: num(r.total),
				median: m && m.median !== null ? Number(m.median) : null,
				reportingInHazard: num(m?.reporting),
				flagged: num(r.flagged),
			};
		});
		withoutMonth = num(span[0]?.no_month);
		placeholderDates = num(span[0]?.placeholder);
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
					COUNT(*) FILTER (WHERE fr.pflags IS NOT NULL OR ${aboveCeiling(measure, rm.value)}) AS fl
				FROM filtered_records fr
				LEFT JOIN "human_category_presence" hcp ON hcp."record_id" = fr.record_id
				GROUP BY 1
			),
			ec AS (
				SELECT DISTINCT fr.event_id, NULLIF(rec."hip_cluster_id", '') AS cl
				FROM filtered_records fr
				JOIN "disaster_records" rec ON rec."id" = fr.record_id
			)
			SELECT ev."id"::text AS id, ev.start_date, ${monthOf(sql`ev.start_date`)} AS month,
				${yearOf(sql`ev.start_date`)} AS year, ec.cl,
				pe.s, COALESCE(pe.rep, 0) AS rep, COALESCE(pe.z, 0) AS z,
				COALESCE(pe.fl, 0) AS fl
			FROM ev
			LEFT JOIN ec ON ec.event_id = ev."id"
			LEFT JOIN pe ON pe.event_id = ev."id"`);
		const ph = placeholderDays([
			...new Map(
				perEvent.map((r) => [r.id as string, r.start_date as string | null]),
			).values(),
		]);
		const isPh = (r: Record<string, unknown>) => {
			const m =
				typeof r.start_date === "string"
					? /^\d{4}-(\d{2}-\d{2})/.exec(r.start_date)
					: null;
			return !!m && ph.has(m[1]);
		};
		const dated = perEvent.filter((r) => r.month != null && !isPh(r));
		// Each event's state: reported when its records sum above 0.
		const state = (r: Record<string, unknown>) => ({
			value: num(r.rep) > 0 ? num(r.s) : null,
			zero: num(r.rep) === 0 && num(r.z) > 0,
		});
		const medians = new Map<string, { median: number | null; n: number }>();
		const byCl = new Map<string, number[]>();
		for (const r of dated) {
			const v = state(r).value;
			if (v === null || v <= 0 || num(r.fl) > 0) continue;
			const k = (r.cl as string | null) ?? "none";
			byCl.set(k, [...(byCl.get(k) ?? []), v]);
		}
		for (const [k, vs] of byCl) {
			const s = [...vs].sort((a, b) => a - b);
			const mid = Math.floor(s.length / 2);
			medians.set(k, {
				median: s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2,
				n: s.length,
			});
		}
		const agg = new Map<string, Occ>();
		for (const r of dated) {
			const cl = (r.cl as string | null) ?? null;
			const k = `${cl ?? "none"}|${num(r.month)}`;
			const st = state(r);
			const m = medians.get(cl ?? "none");
			const o = agg.get(k) ?? {
				cluster: cl,
				month: num(r.month),
				sum: 0,
				reported: 0,
				zero: 0,
				total: 0,
				median: m?.median ?? null,
				reportingInHazard: m?.n ?? 0,
				flagged: 0,
			};
			o.total++;
			if (num(r.fl) > 0) o.flagged++;
			if (st.value !== null && st.value > 0) {
				o.sum += st.value;
				o.reported++;
			} else if (st.zero) o.zero++;
			agg.set(k, o);
		}
		occ = [...agg.values()];
		const ids = (rs: Record<string, unknown>[]) =>
			new Set(rs.map((r) => r.id as string)).size;
		withoutMonth = ids(
			perEvent.filter((r) => r.month == null && r.year != null),
		);
		placeholderDates = ids(perEvent.filter(isPh));
		const ys = perEvent
			.map((r) => r.year)
			.filter((y) => y != null)
			.map(Number);
		years = ys.length ? { from: Math.min(...ys), to: Math.max(...ys) } : null;
	}

	return {
		unit,
		measure,
		rows: buildRows(occ, clusters),
		withoutMonth,
		placeholderDates,
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
