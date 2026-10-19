// D1 Analysis dashboard, Disaster events dimension, panels 11, 12, 13 and 16:
// the loader behind ~/utils/dashboard/eventPanels8to16 (reassessment DE-11,
// DE-12, DE-13, DE-16). Same event scope as panels 1 to 7; places and
// sectors come from the linked disaster records, because events carry no
// division or sector links of their own.

import { cachedDashboard } from "~/backend.server/models/analytics/dashboard/dashboardCache.server";
import { sql } from "drizzle-orm";
import {
	eventsCte,
	linkedRecordsCte,
} from "~/backend.server/models/analytics/dashboard/eventPanels.server";
import {
	humanEffectMeasuresFromRow,
	humanEffectMeasuresSelect,
	measurePartsCtes,
	measurePartsJoins,
} from "~/backend.server/models/analytics/hazard-analysis";
import {
	chosenMeasure,
	hipTypeLabels,
	impactFiltersFromQuery,
	type ImpactPanelsContext,
} from "~/backend.server/models/analytics/dashboard/impactPanels.server";
import {
	num,
	rows,
} from "~/backend.server/models/analytics/dashboard/impactPanels5to16.server";
import { sectorHitsCtes } from "~/backend.server/models/analytics/dashboard/sectorPanels.server";
import type { DeltaQuery } from "~/utils/deltaQuery";
import type { EventGroupingRule } from "~/utils/dashboard/eventPanels";
import type {
	EventCompleteness,
	EventPanels8to16,
} from "~/utils/dashboard/eventPanels8to16";
import type { PanelMeta } from "~/utils/dashboard/impactPanels";

/** Events the register lists, newest first. */
export const EVENT_REGISTER_TOP = 100;

/** Below this many events with a value, the exceedance curve is flagged. */
export const EXCEEDANCE_MIN_EVENTS = 10;
/** Points the exceedance curve carries (largest events first). */
export const EXCEEDANCE_MAX_POINTS = 200;

/** Bins of level-1 divisions per event (panel 13). */
const DIVISION_BINS: { label: string; min: number; max: number }[] = [
	{ label: "1 division", min: 1, max: 1 },
	{ label: "2 to 3", min: 2, max: 3 },
	{ label: "4 to 6", min: 4, max: 6 },
	{ label: "7 or more", min: 7, max: Number.POSITIVE_INFINITY },
];

const COMPLETENESS_LABELS: Record<
	EventCompleteness["rows"][number]["key"],
	string
> = {
	name: "Name",
	start_day: "Start date to the day",
	start_year_only: "Start year only",
	end_date: "End date",
	hazard_type: "HIPs type",
	specific_hazard: "Specific HIPs hazard",
	glide: "GLIDE number",
	national_id: "National disaster ID",
	linked_records: "At least one linked disaster record",
	places: "At least one place (from linked records)",
};

async function computeGetEventPanels8to16(
	query: DeltaQuery,
	ctx: ImpactPanelsContext,
): Promise<EventPanels8to16> {
	const { filters, notApplied } = impactFiltersFromQuery(query, ctx);
	const ev = eventsCte(filters);
	const lr = linkedRecordsCte(filters);
	const meta = (method: string): PanelMeta => ({ method, notApplied });
	const l1 = sql`l1 AS (
		SELECT d."id", d."id" AS l1_id FROM "division" d
		WHERE d."level" = 1 AND d."country_accounts_id" = ${ctx.countryAccountsId}
		UNION ALL
		SELECT d."id", l1.l1_id FROM "division" d JOIN l1 ON d."parent_id" = l1."id"
	)`;

	const [perEvent, sectors, labels] = await Promise.all([
		// One row per event in scope: its fields, linked records and divisions.
		rows(sql`
			WITH RECURSIVE ${ev}, ${lr}, ${l1},
			ev_rec AS (
				SELECT fr.event_id, COUNT(*) AS records FROM filtered_records fr GROUP BY 1
			),
			ev_div AS (
				SELECT fr.event_id, COUNT(DISTINCT l1.l1_id) AS divisions
				FROM filtered_records fr
				JOIN "disaster_records_division" drd ON drd."disaster_record_id" = fr.record_id
				JOIN l1 ON l1."id" = drd."division_id"
				GROUP BY 1
			)
			SELECT ev."id"::text AS id, ev.name, ev.rule, ev.glide, ev.national_id,
				ev.start_date, ev.end_date, ev.hip_type_id, ev.hip_hazard_id,
				ev.has_name,
				COALESCE(r.records, 0) AS records, COALESCE(d.divisions, 0) AS divisions
			FROM ev
			LEFT JOIN ev_rec r ON r.event_id = ev."id"
			LEFT JOIN ev_div d ON d.event_id = ev."id"`),
		// Events with a linked record reporting damage, per level-2 sector.
		rows(sql`
			WITH RECURSIVE ${ev}, ${lr}, ${sectorHitsCtes}
			SELECT h.top_id::text AS sector_id,
				COALESCE(s."name" ->> 'en', s."sectorname") AS label,
				COUNT(DISTINCT fr.event_id) AS events
			FROM hits h
			JOIN filtered_records fr ON fr.record_id = h.record_id
			JOIN "sector" s ON s."id" = h.top_id
			WHERE h.dmg
			GROUP BY 1, 2`),
		hipTypeLabels(),
	]);
	const measure = chosenMeasure(query);
	const perEventMeasures = await rows(sql`
		WITH RECURSIVE ${ev}, ${lr}, ${measurePartsCtes}
		SELECT fr.event_id::text AS event_id, ${humanEffectMeasuresSelect()}
		FROM filtered_records fr
		LEFT JOIN "human_category_presence" hcp ON hcp."record_id" = fr.record_id
		${measurePartsJoins}
		LEFT JOIN "disaster_records" rec ON rec."id" = fr.record_id
		GROUP BY fr.event_id`);
	// DE-20: HIPs clusters of each event's linked records.
	const eventClusters = await rows(sql`
		WITH RECURSIVE ${ev}, ${lr}
		SELECT fr.event_id::text AS event_id,
			array_agg(DISTINCT NULLIF(rec."hip_cluster_id", '')) FILTER (WHERE NULLIF(rec."hip_cluster_id", '') IS NOT NULL) AS clusters
		FROM filtered_records fr
		JOIN "disaster_records" rec ON rec."id" = fr.record_id
		GROUP BY 1`);
	const clusterNames = new Map(
		(
			await rows(
				sql`SELECT "id"::text AS id, "name_en" AS name FROM "hip_cluster"`,
			)
		).map((r) => [r.id as string, r.name as string]),
	);
	const anySector = await rows(sql`
		WITH RECURSIVE ${ev}, ${lr}, ${sectorHitsCtes}
		SELECT COUNT(DISTINCT fr.event_id) AS n
		FROM hits h JOIN filtered_records fr ON fr.record_id = h.record_id
		WHERE h.dmg`);

	const total = perEvent.length;
	const typeLabel = (id: string | null) =>
		id === null ? "Hazard not coded" : (labels.get(id) ?? `HIPs type ${id}`);
	const day = (d: unknown) =>
		typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d);
	const yearOnly = (d: unknown) => typeof d === "string" && /^\d{4}$/.test(d);
	const count = (f: (r: Record<string, unknown>) => boolean) =>
		perEvent.filter(f).length;

	const register = [...perEvent]
		.sort(
			(a, b) =>
				String(b.start_date ?? "").localeCompare(String(a.start_date ?? "")) ||
				String(a.id).localeCompare(String(b.id)),
		)
		.slice(0, EVENT_REGISTER_TOP)
		.map((r) => ({
			eventId: r.id as string,
			name: r.name as string,
			startDate: (r.start_date as string | null) ?? null,
			endDate: (r.end_date as string | null) ?? null,
			hazardLabel: typeLabel((r.hip_type_id as string | null) ?? null),
			rule: r.rule as EventGroupingRule,
			glide: (r.glide as string | null) ?? null,
			nationalId: (r.national_id as string | null) ?? null,
			records: num(r.records),
			divisions: num(r.divisions),
		}));

	const keys: [
		EventCompleteness["rows"][number]["key"],
		(r: Record<string, unknown>) => boolean,
	][] = [
		["name", (r) => r.has_name === true],
		["start_day", (r) => day(r.start_date)],
		["start_year_only", (r) => yearOnly(r.start_date)],
		["end_date", (r) => r.end_date != null],
		["hazard_type", (r) => r.hip_type_id != null],
		["specific_hazard", (r) => r.hip_hazard_id != null],
		["glide", (r) => r.glide != null],
		["national_id", (r) => r.national_id != null],
		["linked_records", (r) => num(r.records) > 0],
		["places", (r) => num(r.divisions) > 0],
	];

	const withDivisions = perEvent.map((r) => num(r.divisions));

	// DE-17: empirical exceedance of the chosen measure per event.
	const names = new Map(
		perEvent.map((r) => [r.id as string, r.name as string]),
	);
	const yearsSeen = perEvent
		.map((r) =>
			typeof r.start_date === "string" ? Number(r.start_date.slice(0, 4)) : NaN,
		)
		.filter((y) => Number.isFinite(y));
	const years = yearsSeen.length
		? Math.max(...yearsSeen) - Math.min(...yearsSeen) + 1
		: null;
	const valued = perEventMeasures
		.map((r) => ({
			eventId: r.event_id as string,
			cell: humanEffectMeasuresFromRow(r)[measure],
		}))
		.filter((e) => e.cell.valueState === "reported" && (e.cell.value ?? 0) > 0)
		.map((e) => ({ eventId: e.eventId, value: e.cell.value as number }))
		.sort((a, b) => b.value - a.value || a.eventId.localeCompare(b.eventId));
	const points = valued.slice(0, EXCEEDANCE_MAX_POINTS).map((e) => {
		// Ties share the rank of the last tied event: all of them reach the value.
		const rank = valued.filter((x) => x.value >= e.value).length;
		return {
			eventId: e.eventId,
			name: names.get(e.eventId) ?? e.eventId,
			value: e.value,
			rank,
			perYear: years ? Math.round((rank / years) * 1000) / 1000 : null,
			returnPeriodYears: years ? Math.round((years / rank) * 10) / 10 : null,
		};
	});

	// DE-20: hazard mix per event; co-occurrence only, never a cascade.
	const clusterLabel = (id: string) =>
		clusterNames.get(id) || `HIPs cluster ${id}`;
	const lists = eventClusters.map((r) =>
		((r.clusters as string[] | null) ?? []).slice().sort(),
	);
	const pairCounts = new Map<string, number>();
	const clusterEvents = new Map<string, number>();
	for (const l of lists) {
		for (const c of l) clusterEvents.set(c, (clusterEvents.get(c) ?? 0) + 1);
		for (let i = 0; i < l.length; i++)
			for (let j = i + 1; j < l.length; j++) {
				const k = `${l[i]}|${l[j]}`;
				pairCounts.set(k, (pairCounts.get(k) ?? 0) + 1);
			}
	}
	const hazardMix = {
		bins: [
			{ label: "1 hazard cluster", test: (n: number) => n === 1 },
			{ label: "2", test: (n: number) => n === 2 },
			{ label: "3 or more", test: (n: number) => n >= 3 },
		].map((b) => ({
			label: b.label,
			events: lists.filter((l) => b.test(l.length)).length,
		})),
		eventsWithoutHazard: lists.filter((l) => l.length === 0).length,
		pairs: [...pairCounts]
			.map(([k, events]) => {
				const [a, b] = k.split("|");
				return { a: clusterLabel(a), b: clusterLabel(b), events };
			})
			.sort((x, y) => y.events - x.events || x.a.localeCompare(y.a))
			.slice(0, 15),
		byCluster: [...clusterEvents]
			.map(([id, events]) => ({
				hipClusterId: id,
				label: clusterLabel(id),
				events,
			}))
			.sort((x, y) => y.events - x.events || x.label.localeCompare(y.label)),
	};

	// DE-21: events per start month and year.
	const seasonCounts = new Map<string, number>();
	let eventsWithoutMonth = 0;
	for (const r of perEvent) {
		const m =
			typeof r.start_date === "string"
				? /^(\d{4})-(\d{2})/.exec(r.start_date)
				: null;
		if (!m) {
			if (typeof r.start_date === "string" && /^\d{4}/.test(r.start_date))
				eventsWithoutMonth++;
			continue;
		}
		const key = `${Number(m[1])}-${Number(m[2])}`;
		seasonCounts.set(key, (seasonCounts.get(key) ?? 0) + 1);
	}
	const seasonCells = [...seasonCounts]
		.map(([k, events]) => {
			const [year, month] = k.split("-").map(Number);
			return { year, month, events };
		})
		.sort((a, b) => a.year - b.year || a.month - b.month);
	return {
		register: { rows: register, eventsInScope: total },
		completeness: {
			eventsInScope: total,
			rows: keys.map(([key, f]) => ({
				key,
				label: COMPLETENESS_LABELS[key],
				events: count(f),
			})),
		},
		divisionsPerEvent: {
			bins: DIVISION_BINS.map((b) => ({
				label: b.label,
				events: withDivisions.filter((n) => n >= b.min && n <= b.max).length,
			})),
			eventsWithoutDivision: withDivisions.filter((n) => n === 0).length,
		},
		bySector: {
			rows: sectors
				.map((r) => ({
					sectorId: r.sector_id as string,
					label: r.label as string,
					events: num(r.events),
				}))
				.sort((a, b) => b.events - a.events || a.label.localeCompare(b.label)),
			eventsWithoutSector: total - num(anySector[0]?.n),
		},
		exceedance: {
			measure,
			years,
			points,
			eventsNotReported: total - valued.length,
			tooFewEvents: valued.length < EXCEEDANCE_MIN_EVENTS,
		},
		season: { cells: seasonCells, eventsWithoutMonth },
		hazardMix,
		meta: {
			register: meta(
				`Disaster events in scope, newest first (top ${EVENT_REGISTER_TOP}); records and divisions come from linked disaster records in the approval basis`,
			),
			completeness: meta(
				"Disaster events in scope filling each field; places come from linked disaster records, because events hold no division links of their own",
			),
			divisionsPerEvent: meta(
				"Disaster events by the number of level-1 divisions their linked disaster records name",
			),
			exceedance: meta(
				`Empirical exceedance from recorded disaster events: per event, the sum of ${measure} over its linked disaster records; rank = events at or above the value; per year = rank / years of record; return period = years / rank. Not a hazard or risk model; with fewer than ${EXCEEDANCE_MIN_EVENTS} events or a short record the tail is unstable. Events with no reported value are left out and counted`,
			),
			hazardMix: meta(
				"HIPs clusters carried by each disaster event's linked disaster records. Hazards in the same event co-occur; this is not evidence that one triggered another. Events with no linked record are not counted",
			),
			season: meta(
				"Disaster events by start month and year, from the event's own start date; events with a start year only are counted, not drawn",
			),
			bySector: meta(
				"Disaster events with at least one linked disaster record reporting damage in the level-2 sector; an event can count under several sectors",
			),
		},
	};
}

/** getEventPanels8to16, reused for DASHBOARD_CACHE_TTL_MS per tenant, audience and query. */
export function getEventPanels8to16(
	query: DeltaQuery,
	ctx: ImpactPanelsContext,
): Promise<EventPanels8to16> {
	return cachedDashboard("getEventPanels8to16", [ctx, query], () =>
		computeGetEventPanels8to16(query, ctx),
	);
}
