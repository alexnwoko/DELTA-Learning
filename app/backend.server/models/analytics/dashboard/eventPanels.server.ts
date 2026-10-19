// D1 Analysis dashboard, Disaster events dimension, panels 1 to 7: the loader
// behind ~/utils/dashboard/eventPanels. Events are filtered on their own
// fields (tenant, approval basis, HIPs, start year); a place filter keeps the
// events with a linked record in the division, because events carry no
// division links of their own (disaster_event_division is empty).

import { cachedDashboard } from "~/backend.server/models/analytics/dashboard/dashboardCache.server";
import { sql, type SQL } from "drizzle-orm";
import {
	humanEffectMeasuresFromRow,
	humanEffectMeasuresSelect,
	humanEffectsFilteredRecords,
	measurePartsCtes,
	measurePartsJoins,
	recordFlagsColumn,
	type HazardFilters,
} from "~/backend.server/models/analytics/hazard-analysis";
import {
	chosenMeasure,
	EMPTY_CELL,
	hipTypeLabels,
	impactFiltersFromQuery,
	rankValue,
	type ImpactPanelsContext,
} from "~/backend.server/models/analytics/dashboard/impactPanels.server";
import {
	GAR_THRESHOLD,
	housesCte,
	num,
	rows,
} from "~/backend.server/models/analytics/dashboard/impactPanels5to16.server";
import { divisionAndDescendantsSql } from "~/backend.server/utils/geographicFilters";
import { approvalBasis, basisColumns } from "~/utils/approvalBasis";
import type { DeltaQuery } from "~/utils/deltaQuery";
import type { PanelMeta } from "~/utils/dashboard/impactPanels";
import {
	EVENT_GROUPING_RULES,
	type EventGroupingRule,
	type EventPanels1to7,
	type RecordsPerEvent,
} from "~/utils/dashboard/eventPanels";

/** Events listed in panel 3. */
export const LARGEST_EVENTS_TOP = 25;

const RULE_SQL = sql`CASE
	WHEN de."legacy_data" -> 'migration' ->> 'event_grouping' IN ('glide', 'glide_registry') THEN 'glide'
	WHEN de."legacy_data" -> 'migration' ->> 'event_grouping' = 'ser' THEN 'serial'
	ELSE 'entered'
END`;

/** Events in scope: tenant, approval basis, HIPs, start year and place. */
export function eventsCte(filters: HazardFilters): SQL {
	const conds: SQL[] = [
		sql`de."country_accounts_id" = ${filters.countryAccountsId}`,
		approvalBasis(filters.audience, basisColumns("de")),
	];
	if (filters.hazardTypeId)
		conds.push(sql`de."hip_type_id" = ${filters.hazardTypeId}`);
	if (filters.hazardClusterId)
		conds.push(sql`de."hip_cluster_id" = ${filters.hazardClusterId}`);
	if (filters.specificHazardId)
		conds.push(sql`de."hip_hazard_id" = ${filters.specificHazardId}`);
	const year = sql`NULLIF(substring(de."start_date" from '^[0-9]{4}'), '')::int`;
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
			SELECT 1
			FROM "disaster_records" r
			JOIN "disaster_records_division" drd ON drd."disaster_record_id" = r."id"
			WHERE r."disaster_event_id" = de."id"
				AND drd."division_id" IN ${divisionAndDescendantsSql(filters.geographicLevelId, filters.countryAccountsId)}
		)`);
	if (filters.regionId)
		conds.push(sql`EXISTS (
			SELECT 1
			FROM "disaster_records" r
			JOIN "disaster_records_division" drd ON drd."disaster_record_id" = r."id"
			JOIN geo.division_ancestor da
				ON da.division_id = drd."division_id" AND da.country_accounts_id = ${filters.countryAccountsId}
			JOIN geo.region_member m
				ON m.division_id = da.ancestor_id AND m.country_accounts_id = da.country_accounts_id
			WHERE r."disaster_event_id" = de."id" AND m.region_id = ${filters.regionId}
		)`);
	return sql`ev AS (
		SELECT de."id", ${RULE_SQL} AS rule,
			NULLIF(de."glide", '') AS glide,
			COALESCE(NULLIF(de."name_national", ''), NULLIF(de."name_global_or_regional", ''), NULLIF(de."glide", ''), de."id"::text) AS name,
			NULLIF(de."start_date", '') AS start_date,
			NULLIF(de."end_date", '') AS end_date,
			(NULLIF(de."name_national", '') IS NOT NULL OR NULLIF(de."name_global_or_regional", '') IS NOT NULL) AS has_name,
			NULLIF(de."national_disaster_id", '') AS national_id,
			NULLIF(de."hip_hazard_id", '') AS hip_hazard_id,
			${year} AS year,
			NULLIF(de."hip_type_id", '') AS hip_type_id
		FROM "disaster_event" de
		WHERE ${sql.join(conds, sql` AND `)}
	)`;
}

/**
 * Records linked to the events in scope, in the approval basis. Named
 * filtered_records so the shared measure and houses builders apply to it.
 */
export function linkedRecordsCte(filters: HazardFilters): SQL {
	return sql`filtered_records AS (
		SELECT r."id" AS record_id, r."disaster_event_id" AS event_id, ${recordFlagsColumn("r")} AS pflags
		FROM "disaster_records" r
		JOIN ev ON ev."id" = r."disaster_event_id"
		WHERE ${approvalBasis(filters.audience, basisColumns("r"))}
	)`;
}

const zeroRules = (): Record<EventGroupingRule, number> => ({
	glide: 0,
	serial: 0,
	entered: 0,
});

async function computeGetEventPanels1to7(
	query: DeltaQuery,
	ctx: ImpactPanelsContext,
): Promise<EventPanels1to7> {
	const { filters, notApplied } = impactFiltersFromQuery(query, ctx);
	const measure = chosenMeasure(query);
	const ev = eventsCte(filters);
	const lr = linkedRecordsCte(filters);
	const meta = (method: string, coverage?: string): PanelMeta => ({
		method,
		...(coverage ? { coverage } : {}),
		notApplied,
	});

	const [events, perEvent, overall, scope, labels] = await Promise.all([
		rows(sql`WITH ${ev} SELECT * FROM ev`),
		rows(sql`
			WITH RECURSIVE ${ev}, ${lr}, ${measurePartsCtes}, ${housesCte},
			l1 AS (
				SELECT d."id", d."id" AS l1_id FROM "division" d
				WHERE d."level" = 1 AND d."country_accounts_id" = ${ctx.countryAccountsId}
				UNION ALL
				SELECT d."id", l1.l1_id FROM "division" d JOIN l1 ON d."parent_id" = l1."id"
			)
			SELECT fr.event_id::text AS event_id,
				${humanEffectMeasuresSelect()},
				SUM(h.td) FILTER (WHERE h.td > 0) AS td_sum,
				(SELECT COUNT(DISTINCT l1.l1_id)
					FROM filtered_records f2
					JOIN "disaster_records_division" drd ON drd."disaster_record_id" = f2.record_id
					JOIN l1 ON l1."id" = drd."division_id"
					WHERE f2.event_id = fr.event_id) AS divisions
			FROM filtered_records fr
			LEFT JOIN "human_category_presence" hcp ON hcp."record_id" = fr.record_id
			${measurePartsJoins}
			LEFT JOIN "disaster_records" rec ON rec."id" = fr.record_id
			LEFT JOIN houses h ON h."record_id" = fr.record_id
			GROUP BY fr.event_id`),
		rows(sql`
			WITH ${ev}, ${lr}, ${measurePartsCtes}
			SELECT ${humanEffectMeasuresSelect()}
			FROM filtered_records fr
			LEFT JOIN "human_category_presence" hcp ON hcp."record_id" = fr.record_id
			${measurePartsJoins}
			LEFT JOIN "disaster_records" rec ON rec."id" = fr.record_id`),
		rows(sql`
			WITH RECURSIVE ${humanEffectsFilteredRecords(filters)}
			SELECT COUNT(*) AS records,
				COUNT(*) FILTER (WHERE r."disaster_event_id" IS NULL) AS not_linked
			FROM filtered_records fr
			JOIN "disaster_records" r ON r."id" = fr.record_id`),
		hipTypeLabels(),
	]);
	const linkedByRule = (
		await rows(sql`
			WITH RECURSIVE ${humanEffectsFilteredRecords(filters)},
			rules AS (SELECT de."id", ${RULE_SQL} AS rule FROM "disaster_event" de
				WHERE de."country_accounts_id" = ${ctx.countryAccountsId})
			SELECT rules.rule, COUNT(*) AS n
			FROM filtered_records fr
			JOIN "disaster_records" r ON r."id" = fr.record_id
			JOIN rules ON rules."id" = r."disaster_event_id"
			GROUP BY 1`)
	).reduce<Record<EventGroupingRule, number>>(
		(m, r) => ({ ...m, [r.rule as EventGroupingRule]: num(r.n) }),
		zeroRules(),
	);

	const typeLabel = (id: string | null) =>
		id === null ? "Hazard not coded" : (labels.get(id) ?? `HIPs type ${id}`);
	const byEvent = new Map(
		perEvent.map((r) => [
			r.event_id as string,
			{
				measures: humanEffectMeasuresFromRow(r),
				records: num(r.records_total),
				td: r.td_sum === null ? null : num(r.td_sum),
				divisions: num(r.divisions),
			},
		]),
	);
	const overallMeasures = humanEffectMeasuresFromRow(overall[0] ?? {});
	const recordsInScope = num(scope[0]?.records);
	const recordsLinked = recordsInScope - num(scope[0]?.not_linked);

	const byRule = zeroRules();
	for (const e of events) byRule[e.rule as EventGroupingRule]++;

	// Panel 4: events per start year.
	const yearMap = new Map<number, Record<EventGroupingRule, number>>();
	let eventsWithoutYear = 0;
	for (const e of events) {
		if (e.year === null || e.year === undefined) {
			eventsWithoutYear++;
			continue;
		}
		const y = Number(e.year);
		const r = yearMap.get(y) ?? zeroRules();
		r[e.rule as EventGroupingRule]++;
		yearMap.set(y, r);
	}

	// Panel 5: events per HIPs type of the event.
	const typeCounts = new Map<string | null, number>();
	for (const e of events) {
		const k = (e.hip_type_id as string | null) ?? null;
		typeCounts.set(k, (typeCounts.get(k) ?? 0) + 1);
	}

	// Panel 6: linked records per event.
	const binOf = (n: number): RecordsPerEvent["bins"][number]["label"] =>
		n === 1
			? "1"
			: n <= 5
				? "2 to 5"
				: n <= 20
					? "6 to 20"
					: n <= 100
						? "21 to 100"
						: "Over 100";
	const bins: RecordsPerEvent["bins"] = (
		["1", "2 to 5", "6 to 20", "21 to 100", "Over 100"] as const
	).map((label) => ({ label, events: 0 }));
	let eventsWithoutRecords = 0;
	for (const e of events) {
		const n = byEvent.get(e.id as string)?.records ?? 0;
		if (n === 0) eventsWithoutRecords++;
		else bins.find((b) => b.label === binOf(n))!.events++;
	}

	// Panel 7: event size against the GAR 2015 threshold.
	let intensive = 0;
	let extensive = 0;
	let zeroConfirmed = 0;
	let notReported = 0;
	for (const e of events) {
		const x = byEvent.get(e.id as string);
		const deaths = x?.measures.deaths;
		const td = x?.td ?? null;
		if (
			(deaths?.valueState === "reported" &&
				(deaths.value ?? 0) >= GAR_THRESHOLD.deaths) ||
			(td !== null && td >= GAR_THRESHOLD.housesDestroyed)
		)
			intensive++;
		else if (deaths?.valueState === "reported" || (td !== null && td > 0))
			extensive++;
		else if (deaths?.valueState === "zero_confirmed") zeroConfirmed++;
		else notReported++;
	}

	// Panel 3: largest events by the chosen measure.
	const largestRows = events
		.map((e) => {
			const x = byEvent.get(e.id as string);
			return {
				eventId: e.id as string,
				name: e.name as string,
				glide: (e.glide as string | null) ?? null,
				startDate: (e.start_date as string | null) ?? null,
				hazardLabel: typeLabel((e.hip_type_id as string | null) ?? null),
				rule: e.rule as EventGroupingRule,
				records: x?.records ?? 0,
				divisions: x?.divisions ?? 0,
				cell: x ? x.measures[measure] : EMPTY_CELL,
			};
		})
		.sort(
			(a, b) => rankValue(b.cell) - rankValue(a.cell) || b.records - a.records,
		)
		.slice(0, LARGEST_EVENTS_TOP);

	const ruleNote =
		"Events are grouped by GLIDE where a GLIDE number exists, or by the guarded country serial rule (RV-1); entered events were recorded as events directly.";
	return {
		empty: events.length
			? null
			: { reason: "No disaster events in scope for these filters." },
		headline: {
			events: events.length,
			byRule,
			eventsWithGlide: events.filter((e) => e.glide !== null).length,
			recordsLinked,
			recordsInScope,
			deaths: overallMeasures.deaths,
		},
		linkage: {
			linked: linkedByRule,
			notLinked: recordsInScope - recordsLinked,
			recordsInScope,
		},
		largest: { measure, rows: largestRows },
		byYear: {
			years: [...yearMap.entries()]
				.sort((a, b) => a[0] - b[0])
				.map(([year, r]) => ({
					year,
					events: EVENT_GROUPING_RULES.reduce((s, k) => s + r[k], 0),
					byRule: r,
				})),
			eventsWithoutYear,
		},
		byHazard: {
			rows: [...typeCounts.entries()]
				.map(([id, events]) => ({
					hipTypeId: id ?? "none",
					label: typeLabel(id),
					events,
				}))
				.sort((a, b) => b.events - a.events),
		},
		recordsPerEvent: {
			bins,
			eventsWithoutRecords,
			recordsNotGrouped: recordsInScope - recordsLinked,
		},
		eventSize: {
			threshold: { ...GAR_THRESHOLD, source: "GAR 2015" },
			intensive,
			extensive,
			zeroConfirmed,
			notReported,
			note: "The GAR threshold is defined on records; it is applied here to the sum over each event's linked records.",
		},
		meta: {
			headline: meta(
				`Events in scope by grouping rule. ${ruleNote}`,
				`${recordsLinked} of ${recordsInScope} records in scope are linked to an event`,
			),
			linkage: meta(
				"Records in scope by the grouping rule of their event; not linked records are their own part",
			),
			largest: meta(
				`Sum over each event's linked records, a record counted once; top ${LARGEST_EVENTS_TOP}`,
			),
			byYear: meta(
				`Events per start year. ${ruleNote} Ungrouped records are not events.`,
			),
			byHazard: meta("Events per HIPs type recorded on the event"),
			recordsPerEvent: meta("Linked records per event in the approval basis"),
			eventSize: meta(
				"Per event: intensive when its linked records sum to 30 or more deaths or 600 or more houses destroyed (GAR 2015)",
			),
		},
	};
}

/** getEventPanels1to7, reused for DASHBOARD_CACHE_TTL_MS per tenant, audience and query. */
export function getEventPanels1to7(
	query: DeltaQuery,
	ctx: ImpactPanelsContext,
): Promise<EventPanels1to7> {
	return cachedDashboard("getEventPanels1to7", [ctx, query], () =>
		computeGetEventPanels1to7(query, ctx),
	);
}
