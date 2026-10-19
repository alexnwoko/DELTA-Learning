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
