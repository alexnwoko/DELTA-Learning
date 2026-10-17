// D1 Analysis dashboard, Hazardous events dimension, panels 1 to 7: the
// loader behind ~/utils/dashboard/hazardEventPanels. Events are filtered on
// their own fields: tenant, approval basis, HIPs, start year and division.

import { sql, type SQL } from "drizzle-orm";
import {
	hipTypeLabels,
	impactFiltersFromQuery,
	type ImpactPanelsContext,
} from "~/backend.server/models/analytics/dashboard/impactPanels.server";
import {
	num,
	rows,
} from "~/backend.server/models/analytics/dashboard/impactPanels5to16.server";
import { divisionAndDescendantsSql } from "~/backend.server/utils/geographicFilters";
import type { HazardFilters } from "~/backend.server/models/analytics/hazard-analysis";
import { approvalBasis, basisColumns } from "~/utils/approvalBasis";
import type { DeltaQuery } from "~/utils/deltaQuery";
import type { HazardEventPanels1to7 } from "~/utils/dashboard/hazardEventPanels";

/** Divisions listed in panel 7. */
export const HAZARD_EVENT_DIVISIONS_TOP = 15;

function hazardEventsCte(filters: HazardFilters): SQL {
	const conds: SQL[] = [
		sql`he."country_accounts_id" = ${filters.countryAccountsId}`,
		approvalBasis(filters.audience, basisColumns("he", { legacyData: false })),
	];
	if (filters.hazardTypeId)
		conds.push(sql`he."hip_type_id" = ${filters.hazardTypeId}`);
	if (filters.hazardClusterId)
		conds.push(sql`he."hip_cluster_id" = ${filters.hazardClusterId}`);
	if (filters.specificHazardId)
		conds.push(sql`he."hip_hazard_id" = ${filters.specificHazardId}`);
	const year = sql`NULLIF(substring(he."start_date" from '^[0-9]{4}'), '')::int`;
	if (filters.fromDate)
		conds.push(
			sql`(${year} IS NULL OR ${year} >= ${Number(filters.fromDate.slice(0, 4))})`,
		);
	if (filters.toDate)
		conds.push(
			sql`(${year} IS NULL OR ${year} <= ${Number(filters.toDate.slice(0, 4))})`,
		);
	if (filters.geographicLevelId)
		conds.push(sql`EXISTS (
			SELECT 1 FROM "hazardous_event_division" hed
			WHERE hed."hazardous_event_id" = he."id"
				AND hed."division_id" IN ${divisionAndDescendantsSql(filters.geographicLevelId, filters.countryAccountsId)}
		)`);
	return sql`hev AS (
		SELECT he."id", NULLIF(he."hip_type_id", '') AS hip_type_id,
			NULLIF(he."hip_cluster_id", '') AS hip_cluster_id,
			NULLIF(he."hip_hazard_id", '') AS hip_hazard_id,
			he."hazardous_event_status" AS status,
			NULLIF(he."start_date", '') AS start_date,
			${year} AS year,
			NULLIF(substring(he."start_date" from '^[0-9]{4}-([0-9]{2})'), '')::int AS month,
			NULLIF(he."data_source", '') AS data_source,
			he."updated_at"
		FROM "hazardous_event" he
		WHERE ${sql.join(conds, sql` AND `)}
	)`;
}

export async function getHazardEventPanels1to7(
	query: DeltaQuery,
	ctx: ImpactPanelsContext,
): Promise<HazardEventPanels1to7> {
	const { filters, notApplied } = impactFiltersFromQuery(query, ctx);
	const hev = hazardEventsCte(filters);
	const divTree = sql`l1 AS (
		SELECT d."id", d."id" AS l1_id FROM "division" d
		WHERE d."level" = 1 AND d."country_accounts_id" = ${ctx.countryAccountsId}
		UNION ALL
		SELECT d."id", l1.l1_id FROM "division" d JOIN l1 ON d."parent_id" = l1."id"
	)`;
	const [events, flags, eventDivs, l1Count, labels] = await Promise.all([
		rows(sql`WITH ${hev} SELECT * FROM hev`),
		rows(sql`
			WITH ${hev}
			SELECT
				COUNT(*) FILTER (WHERE EXISTS (
					SELECT 1 FROM "disaster_event" de WHERE de."hazardous_event_id" = hev."id")) AS linked,
				COUNT(*) FILTER (WHERE EXISTS (
					SELECT 1 FROM "hazardous_event_geom" g WHERE g."hazardous_event_id" = hev."id")) AS footprint
			FROM hev`),
		rows(sql`
			WITH RECURSIVE ${hev}, ${divTree}
			SELECT DISTINCT hev."id"::text AS event_id, l1.l1_id::text AS division_id,
				COALESCE(d."name" ->> 'en', d."id"::text) AS name
			FROM hev
			JOIN "hazardous_event_division" hed ON hed."hazardous_event_id" = hev."id"
			JOIN l1 ON l1."id" = hed."division_id"
			JOIN "division" d ON d."id" = l1.l1_id`),
		rows(sql`SELECT COUNT(*) AS n FROM "division"
			WHERE "level" = 1 AND "country_accounts_id" = ${ctx.countryAccountsId}`),
		hipTypeLabels(),
	]);
	const typeLabel = (id: string | null) =>
		id === null ? "Hazard not coded" : (labels.get(id) ?? `HIPs type ${id}`);
	// A recorded "forecasted" status shows to signed-in readers only (D1
	// brief v0.2, section 3, panel 2). It is never sent to public readers.
	const shownStatus = (status: unknown) =>
		status === "ongoing" ||
		(status === "forecasted" && ctx.audience !== "public");
	const countBy = <K>(keyOf: (e: Record<string, unknown>) => K) => {
		const m = new Map<K, number>();
		for (const e of events) m.set(keyOf(e), (m.get(keyOf(e)) ?? 0) + 1);
		return m;
	};

	const divCounts = new Map<string, { name: string; events: number }>();
	const perEvent = new Map<string, number>();
	for (const r of eventDivs) {
		const id = r.division_id as string;
		const c = divCounts.get(id) ?? { name: r.name as string, events: 0 };
		c.events++;
		divCounts.set(id, c);
		perEvent.set(
			r.event_id as string,
			(perEvent.get(r.event_id as string) ?? 0) + 1,
		);
	}

	const years = countBy((e) => (e.year === null ? null : Number(e.year)));
	const months = countBy((e) =>
		e.year === null || e.month === null ? null : `${e.year}-${e.month}`,
	);
	const types = countBy((e) => (e.hip_type_id as string | null) ?? null);

	return {
		empty: events.length
			? null
			: {
					code: "G-01",
					reason:
						"No hazardous events recorded. Migrated data holds none; only events entered in DELTA appear here.",
				},
		headline: {
			events: events.length,
			ongoingOrForecasted: events.filter((e) => shownStatus(e.status)).length,
			linkedToDisasterEvent: num(flags[0]?.linked),
			withFootprint: num(flags[0]?.footprint),
			codedAtHazardLevel: events.filter((e) => e.hip_hazard_id !== null).length,
		},
		ongoing: {
			rows: events
				.filter((e) => shownStatus(e.status))
				.map((e) => ({
					eventId: e.id as string,
					hazardLabel: typeLabel((e.hip_type_id as string | null) ?? null),
					status: e.status as "ongoing" | "forecasted",
					startDate: (e.start_date as string | null) ?? null,
					divisions: perEvent.get(e.id as string) ?? 0,
					dataSource: (e.data_source as string | null) ?? null,
					lastUpdate: e.updated_at ? String(e.updated_at) : null,
				})),
		},
		byYear: {
			years: [...years.entries()]
				.filter(([y]) => y !== null)
				.map(([year, n]) => ({ year: year as number, events: n }))
				.sort((a, b) => a.year - b.year),
			eventsWithoutYear: years.get(null) ?? 0,
		},
		season: {
			cells: [...months.entries()]
				.filter(([k]) => k !== null)
				.map(([k, n]) => {
					const [y, m] = (k as string).split("-").map(Number);
					return { year: y, month: m, events: n };
				})
				.sort((a, b) => a.year - b.year || a.month - b.month),
			eventsWithoutMonth: months.get(null) ?? 0,
		},
		byHazard: {
			rows: [...types.entries()]
				.map(([id, n]) => ({
					hipTypeId: id ?? "none",
					label: typeLabel(id),
					events: n,
				}))
				.sort((a, b) => b.events - a.events),
		},
		depth: {
			rows: [...types.keys()].map((id) => {
				const of = events.filter(
					(e) => ((e.hip_type_id as string | null) ?? null) === id,
				);
				return {
					hipTypeId: id ?? "none",
					label: typeLabel(id),
					typeOnly: of.filter(
						(e) => e.hip_cluster_id === null && e.hip_hazard_id === null,
					).length,
					cluster: of.filter(
						(e) => e.hip_cluster_id !== null && e.hip_hazard_id === null,
					).length,
					specificHazard: of.filter((e) => e.hip_hazard_id !== null).length,
				};
			}),
		},
		divisions: {
			rows: [...divCounts.entries()]
				.map(([divisionId, c]) => ({
					divisionId,
					name: c.name,
					events: c.events,
				}))
				.sort((a, b) => b.events - a.events)
				.slice(0, HAZARD_EVENT_DIVISIONS_TOP),
			divisionsWithoutEvents: num(l1Count[0]?.n) - divCounts.size,
			multiDivisionEvents: [...perEvent.values()].filter((n) => n > 1).length,
		},
		meta: {
			method:
				"Hazardous events in scope, filtered on their own HIPs code, start year, approval state and division links; an event in several divisions counts in each",
			notApplied,
		},
	};
}
