// The Sendai Framework Monitoring section of the D1 dashboard: one loader
// for the nine slots (DELTA_Analytics_SFM_Requirements.md, section 6.2).
// Built from the same record filters and measures as the Disaster impact
// panels, so a figure reads the same in both places.

import { sql } from "drizzle-orm";
import { cachedDashboard } from "~/backend.server/models/analytics/dashboard/dashboardCache.server";
import {
	getAffectedPeopleByHazardFilters,
	getHumanEffectsGrouped,
	humanEffectsFilteredRecords,
} from "~/backend.server/models/analytics/hazard-analysis";
import {
	EMPTY_CELL,
	hipTypeLabels,
	impactFiltersFromQuery,
	rankValue,
	type ImpactPanelsContext,
} from "~/backend.server/models/analytics/dashboard/impactPanels.server";
import {
	housesCte,
	num,
	rows,
} from "~/backend.server/models/analytics/dashboard/impactPanels5to16.server";
import { sectorHitsCtes } from "~/backend.server/models/analytics/dashboard/sectorPanels.server";
import type { DeltaQuery } from "~/utils/deltaQuery";
import { measureValue } from "~/utils/valueState";
import type { PanelCell, PanelMeta } from "~/utils/dashboard/impactPanels";
import type { SendaiSection, SendaiSlot } from "~/utils/dashboard/sendaiPanels";

/** DesInventar source fields held only in legacy_data (not loaded). */
const SOURCE_UNITS = [
	{ field: "nhectareas", label: "Crops (hectares)" },
	{ field: "cabezas", label: "Livestock (head)" },
	{ field: "kmvias", label: "Roads (km)" },
] as const;
const FACILITY_FIELDS = [
	{ field: "nhospitales", label: "Health facilities" },
	{ field: "nescuelas", label: "Education facilities" },
] as const;

/** Records whose legacy field holds a number above 0. */
const above0 = (field: string) =>
	sql`COUNT(*) FILTER (WHERE rec."legacy_data" ->> ${field} ~ '^[0-9]+(\\.[0-9]+)?$'
		AND (rec."legacy_data" ->> ${field})::numeric > 0)`;

function countCell(sum: unknown, reported: unknown, total: unknown): PanelCell {
	return measureValue({
		sum: sum as number | string | null,
		reported: reported as number | string,
		zeroConfirmed: 0,
		total: total as number | string,
	});
}

async function computeSendai(
	query: DeltaQuery,
	ctx: ImpactPanelsContext,
): Promise<SendaiSection> {
	const { filters, notApplied } = impactFiltersFromQuery(query, ctx);
	const national = !filters.geographicLevelId && !query.where.region;
	const code = <C extends string>(c: C): C | null => (national ? c : null);
	const fr = humanEffectsFilteredRecords(filters);

	const [headline, byYear, byType, labels, houses, legacy, coverage, decades] =
		await Promise.all([
			getAffectedPeopleByHazardFilters(filters),
			getHumanEffectsGrouped(filters, "year"),
			getHumanEffectsGrouped(filters, "hipType"),
			hipTypeLabels(),
			rows(sql`
				WITH RECURSIVE ${fr}, ${housesCte}
				SELECT NULLIF(substring(rec."start_date" from '^[0-9]{4}'), '')::int AS year,
					SUM(h.td) FILTER (WHERE h.td > 0) AS td_sum,
					COUNT(*) FILTER (WHERE h.td > 0) AS td_reported,
					SUM(h.pd) FILTER (WHERE h.pd > 0) AS pd_sum,
					COUNT(*) FILTER (WHERE h.pd > 0) AS pd_reported,
					COUNT(*) AS records_total
				FROM filtered_records fr
				JOIN "disaster_records" rec ON rec."id" = fr.record_id
				LEFT JOIN houses h ON h."record_id" = fr.record_id
				GROUP BY 1`),
			rows(sql`
				WITH RECURSIVE ${fr}
				SELECT
					COUNT(*) FILTER (WHERE
						(rec."legacy_data" ->> 'valorus' ~ '^[0-9]+(\\.[0-9]+)?$' AND (rec."legacy_data" ->> 'valorus')::numeric > 0)
						OR (rec."legacy_data" ->> 'valorloc' ~ '^[0-9]+(\\.[0-9]+)?$' AND (rec."legacy_data" ->> 'valorloc')::numeric > 0)
					) AS money,
					${sql.join(
						[...SOURCE_UNITS, ...FACILITY_FIELDS].map(
							(u) => sql`${above0(u.field)} AS ${sql.raw(`"${u.field}"`)}`,
						),
						sql`, `,
					)}
				FROM filtered_records fr
				JOIN "disaster_records" rec ON rec."id" = fr.record_id`),
			rows(sql`
				WITH RECURSIVE ${fr}
				SELECT COUNT(*) AS total,
					COUNT(*) FILTER (WHERE
						hcp."deaths" IS NOT NULL OR hcp."deaths_total" IS NOT NULL
						OR hcp."missing" IS NOT NULL OR hcp."missing_total" IS NOT NULL
						OR hcp."injured" IS NOT NULL OR hcp."injured_total" IS NOT NULL
						OR hcp."affected_direct" IS NOT NULL OR hcp."affected_direct_total" IS NOT NULL
					) AS with_any
				FROM filtered_records fr
				LEFT JOIN "human_category_presence" hcp ON hcp."record_id" = fr.record_id`),
			rows(sql`
				WITH RECURSIVE ${fr}, ${sectorHitsCtes}
				SELECT h.top_id::text AS sector_id,
					COALESCE(s."name" ->> 'en', s."sectorname") AS label,
					(NULLIF(substring(rec."start_date" from '^[0-9]{4}'), '')::int / 10) * 10 AS decade,
					COUNT(*) FILTER (WHERE h.dmg) AS dmg_yes,
					COUNT(*) FILTER (WHERE h.dmg IS FALSE) AS dmg_no,
					COUNT(*) AS records
				FROM hits h
				JOIN "disaster_records" rec ON rec."id" = h.record_id
				JOIN "sector" s ON s."id" = h.top_id
				GROUP BY 1, 2, 3`),
		]);

	const m = headline.measures;
	const typeLabel = (id: string | null) =>
		id === null ? "No HIPs type" : (labels.get(id) ?? `HIPs type ${id}`);
	const years = byYear
		.filter((r) => r.year !== null)
		.map((r) => r.year as number)
		.sort((a, b) => a - b);

	// A1 reference: the annual average of deaths over the years shown.
	let reference: SendaiSection["a1"]["reference"] = null;
	if (years.length) {
		const from = years[0];
		const to = years[years.length - 1];
		const span = to - from + 1;
		const deaths = m.deaths;
		reference = {
			from,
			to,
			years: span,
			deaths:
				deaths.value === null
					? deaths
					: { ...deaths, value: Math.round((deaths.value / span) * 100) / 100 },
		};
	}

	const housesTotal = (k: "td" | "pd") => {
		const reported = houses.reduce((s, r) => s + num(r[`${k}_reported`]), 0);
		const sum = houses.reduce((s, r) => s + num(r[`${k}_sum`]), 0);
		return countCell(reported ? sum : null, reported, num(coverage[0]?.total));
	};

	const sectors = [
		...new Map(decades.map((r) => [r.sector_id as string, r.label as string])),
	]
		.map(([sectorId, label]) => ({ sectorId, label }))
		.filter((s) =>
			decades.some((r) => r.sector_id === s.sectorId && num(r.dmg_yes) > 0),
		)
		.sort((a, b) => a.label.localeCompare(b.label));
	const decadeList = [
		...new Set(
			decades.filter((r) => r.decade !== null).map((r) => Number(r.decade)),
		),
	].sort((a, b) => a - b);

	const l = legacy[0] ?? {};
	const total = num(coverage[0]?.total);
	const coverageText = `Based on ${num(coverage[0]?.with_any)} of ${total} records`;
	const meta = (method: string): PanelMeta => ({
		method,
		coverage: coverageText,
		notApplied,
	});
	const placeNote = national
		? ""
		: " Sub-national figures. Not a Sendai indicator value (TR-060).";

	const metaBySlot: Record<SendaiSlot, PanelMeta> = {
		s0: meta(`Sum over records in scope; a record counts once.${placeNote}`),
		a1: meta(
			`Sum per start year; the reference is the annual average over the years shown.${placeNote}`,
		),
		a2: meta(
			`Sum per HIPs type; records without a HIPs type are their own row.${placeNote}`,
		),
		b1: meta(
			`Sum per start year; directly affected is shown as recorded, not built from its parts.${placeNote}`,
		),
		b2: meta(
			`Counted damage rows in the Housing sector per start year; destroyed and damaged are never added.${placeNote}`,
		),
		c1: meta(
			"No money is shown until the monetary convention is ruled (G-06). Physical units list records only; sums are withheld until a plausibility cap exists.",
		),
		c2: meta(
			"Records reporting damage per level-2 sector and decade; a record can carry several sectors, so columns do not add up.",
		),
		d1: meta(
			"Facility counts are held in source fields and not loaded until validated (G-22); records with a value above 0 are counted.",
		),
		d2: meta("No disruption records are held (G-08)."),
	};

	return {
		nationalOnly: national,
		provisional: ctx.provisional,
		coverage: { recordsWith: num(coverage[0]?.with_any), recordsTotal: total },
		s0: {
			indicators: [
				{ code: code("A-2"), label: "Deaths", cell: m.deaths },
				{ code: code("A-3"), label: "Missing persons", cell: m.missing },
				{ code: code("B-2"), label: "Injured or ill", cell: m.injured },
			],
			inputs: [
				{
					inputTo: code("B-3"),
					label: "Dwellings damaged",
					cell: housesTotal("pd"),
				},
				{
					inputTo: code("B-4"),
					label: "Dwellings destroyed",
					cell: housesTotal("td"),
				},
			],
			directlyAffected: m.affected_direct,
			refused: [
				{
					code: code("A-1"),
					reason: "Rates need a population denominator (TR-152)",
				},
				{
					code: code("B-1"),
					reason: "Rates need a population denominator (TR-152)",
				},
			],
		},
		a1: {
			years: years.map((year) => {
				const r = byYear.find((x) => x.year === year)!;
				return { year, deaths: r.measures.deaths, missing: r.measures.missing };
			}),
			reference,
		},
		a2: {
			rows: byType
				.map((r) => ({
					hipTypeId: r.hipTypeId ?? "none",
					label: typeLabel(r.hipTypeId),
					deaths: r.measures.deaths,
					missing: r.measures.missing,
				}))
				.sort((a, b) => rankValue(b.deaths) - rankValue(a.deaths)),
		},
		b1: {
			injured: years.map((year) => ({
				year,
				cell: byYear.find((x) => x.year === year)!.measures.injured,
			})),
			affectedDirect: years.map((year) => ({
				year,
				cell: byYear.find((x) => x.year === year)!.measures.affected_direct,
			})),
		},
		b2: {
			rows: houses
				.filter((r) => r.year !== null)
				.map((r) => ({
					year: Number(r.year),
					destroyed: countCell(r.td_sum, r.td_reported, r.records_total),
					damaged: countCell(r.pd_sum, r.pd_reported, r.records_total),
				}))
				.sort((a, b) => a.year - b.year),
		},
		c1: {
			gap: {
				code: "G-06",
				reason: "Not shown: monetary convention pending (G-06).",
			},
			untypedMoneyRecords: num(l.money),
			units: [
				{
					label: "Dwellings (counted)",
					status: "held",
					records: houses.reduce(
						(s, r) => s + num(r.td_reported) + num(r.pd_reported),
						0,
					),
				},
				...SOURCE_UNITS.map((u) => ({
					label: u.label,
					status: "source field, not loaded" as const,
					records: num(l[u.field]),
				})),
			],
		},
		c2: {
			sectors,
			rows: decadeList.map((decade) => ({
				decade,
				cells: sectors.map((s) => {
					const r = decades.find(
						(x) => x.sector_id === s.sectorId && Number(x.decade) === decade,
					);
					return r
						? measureValue({
								sum: num(r.dmg_yes) > 0 ? num(r.dmg_yes) : null,
								reported: num(r.dmg_yes),
								zeroConfirmed: num(r.dmg_no),
								total: num(r.records),
							})
						: EMPTY_CELL;
				}),
			})),
		},
		d1: {
			gap: {
				code: "G-22",
				reason:
					"Not yet available: facility counts are held in source fields and not loaded until validated (G-22).",
			},
			sourceFields: FACILITY_FIELDS.map((f) => ({
				field: f.field,
				label: f.label,
				records: num(l[f.field]),
			})),
		},
		d2: {
			gap: {
				code: "G-08",
				reason: "Not yet available: no disruption records (G-08).",
			},
		},
		meta: metaBySlot,
	};
}

/** The Sendai section, reused for DASHBOARD_CACHE_TTL_MS per tenant, audience and query. */
export function getSendaiSection(
	query: DeltaQuery,
	ctx: ImpactPanelsContext,
): Promise<SendaiSection> {
	return cachedDashboard("getSendaiSection", [ctx, query], () =>
		computeSendai(query, ctx),
	);
}
