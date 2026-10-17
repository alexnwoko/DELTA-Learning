// D1 Analysis dashboard, Sectors view (view=sectors), panels 1 to 7: the
// loader behind ~/utils/dashboard/sectorPanels. Records in scope come from
// the disaster-impact filters; a record reports damage in a level-2 sector
// when a sector link says so (with_damage) or it holds a counted damage row
// in the sector or below it. Losses and disruption read their own flags;
// they are never merged with damage. Money is gap G-06.

import { sql, type SQL } from "drizzle-orm";
import {
	humanEffectsFilteredRecords,
	type HazardFilters,
} from "~/backend.server/models/analytics/hazard-analysis";
import {
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
import type { DeltaQuery } from "~/utils/deltaQuery";
import { measureValue } from "~/utils/valueState";
import type { PanelCell, PanelMeta } from "~/utils/dashboard/impactPanels";
import type {
	SectorGap,
	SectorPanels1to7,
	SectorRef,
} from "~/utils/dashboard/sectorPanels";

/** Seeded level-2 sectors (migration 20250813075915). */
export const SECTOR_IDS = {
	agriculture: "8cf24ec3-3567-4c40-a5fd-bff9e9a27d87",
	industry: "3e2bdf02-4f7a-4898-a9a5-bd98a8d1e370",
	housing: "6ac0b833-6218-49d0-9882-827c1b748d7a",
	health: "4a39d053-a4cf-41f8-93c0-7c30e60f3b42",
	education: "fd53c0da-5ad6-4a7d-943b-089c7726a2bb",
	culture: "a48d6f2e-16e4-4976-8c25-5c8b1788232f",
} as const;

const MONEY_GAP: SectorGap = {
	code: "G-06",
	reason: "Not shown: monetary convention pending (G-06).",
};

/** Level-2 ancestor of every sector, and each record's sector effects. */
const sectorHitsCtes = sql`sec_up AS (
	SELECT "id", "id" AS top_id FROM "sector" WHERE "level" = 2
	UNION ALL
	SELECT s."id", u.top_id FROM "sector" s JOIN sec_up u ON s."parent_id" = u."id"
),
hits AS (
	SELECT x.record_id, u.top_id,
		bool_or(x.dmg) AS dmg, bool_or(x.loss) AS loss, bool_or(x.disr) AS disr
	FROM (
		SELECT sdr."disaster_record_id" AS record_id, sdr."sector_id",
			sdr."with_damage" AS dmg, sdr."with_losses" AS loss, sdr."with_disruption" AS disr
		FROM "sector_disaster_records_relation" sdr
		UNION ALL
		SELECT d."record_id", d."sector_id",
			COALESCE(d."td_damage_amount", 0) + COALESCE(d."pd_damage_amount", 0) > 0,
			NULL::boolean, NULL::boolean
		FROM "damages" d
	) x
	JOIN filtered_records fr ON fr.record_id = x.record_id
	JOIN sec_up u ON u."id" = x."sector_id"
	GROUP BY 1, 2
)`;

/** A yes/no flag cell: yes is reported, an explicit no is a confirmed zero. */
function flagCell(yes: unknown, no: unknown, total: number): PanelCell {
	const y = num(yes);
	return measureValue({
		sum: y > 0 ? y : null,
		reported: y,
		zeroConfirmed: num(no),
		total,
	});
}

/** A count without a confirmed-zero source (dwellings). */
function countCell(sum: unknown, reported: unknown, total: unknown): PanelCell {
	return measureValue({
		sum: sum as number | string | null,
		reported: reported as number | string,
		zeroConfirmed: 0,
		total: total as number | string,
	});
}

function sectorFilter(query: DeltaQuery): SQL {
	const ids = query.where.sectors ?? [];
	return ids.length
		? sql`AND h.top_id::text IN (${sql.join(
				ids.map((id) => sql`${String(id)}`),
				sql`, `,
			)})`
		: sql``;
}

export async function getSectorPanels1to7(
	query: DeltaQuery,
	ctx: ImpactPanelsContext,
): Promise<SectorPanels1to7> {
	const impact = impactFiltersFromQuery(query, ctx);
	const filters: HazardFilters = impact.filters;
	// The Sectors view applies the sector facet itself.
	const notApplied = impact.notApplied.filter((n) => n !== "sector");
	const fr = humanEffectsFilteredRecords(filters);
	const sf = sectorFilter(query);
	const meta = (method: string, coverage?: string): PanelMeta => ({
		method,
		...(coverage ? { coverage } : {}),
		notApplied,
	});

	const [
		tree,
		perSector,
		perTypeSector,
		perYear,
		scope,
		typeTotals,
		dwellingsByType,
		labels,
	] = await Promise.all([
		rows(sql`
				SELECT s."id"::text AS id, COALESCE(s."name" ->> 'en', s."sectorname") AS label,
					s."level", s."parent_id"::text AS parent_id
				FROM "sector" s WHERE s."level" IN (1, 2)
				ORDER BY s."level", 2`),
		rows(sql`
				WITH RECURSIVE ${fr}, ${sectorHitsCtes}
				SELECT h.top_id::text AS sector_id,
					COUNT(*) FILTER (WHERE h.dmg) AS dmg_yes,
					COUNT(*) FILTER (WHERE h.dmg IS FALSE) AS dmg_no,
					COUNT(*) FILTER (WHERE h.loss) AS loss_yes,
					COUNT(*) FILTER (WHERE h.loss IS FALSE) AS loss_no,
					COUNT(*) FILTER (WHERE h.disr) AS disr_yes,
					COUNT(*) FILTER (WHERE h.disr IS FALSE) AS disr_no
				FROM hits h WHERE TRUE ${sf}
				GROUP BY 1`),
		rows(sql`
				WITH RECURSIVE ${fr}, ${sectorHitsCtes}
				SELECT NULLIF(rec."hip_type_id", '') AS hip_type_id, h.top_id::text AS sector_id,
					COUNT(*) FILTER (WHERE h.dmg) AS dmg_yes,
					COUNT(*) FILTER (WHERE h.dmg IS FALSE) AS dmg_no
				FROM hits h JOIN "disaster_records" rec ON rec."id" = h.record_id
				WHERE TRUE ${sf}
				GROUP BY 1, 2`),
		rows(sql`
				WITH RECURSIVE ${fr}, ${sectorHitsCtes}
				SELECT h.top_id::text AS sector_id,
					NULLIF(substring(rec."start_date" from '^[0-9]{4}'), '')::int AS year,
					COUNT(*) FILTER (WHERE h.dmg) AS dmg_yes,
					COUNT(*) FILTER (WHERE h.dmg IS FALSE) AS dmg_no,
					COUNT(*) AS records
				FROM hits h JOIN "disaster_records" rec ON rec."id" = h.record_id
				WHERE TRUE ${sf}
				GROUP BY 1, 2`),
		rows(sql`
				WITH RECURSIVE ${fr}, ${sectorHitsCtes}
				SELECT
					(SELECT COUNT(*) FROM filtered_records) AS records,
					(SELECT COUNT(DISTINCT h.record_id) FROM hits h WHERE h.dmg ${sf}) AS any_dmg,
					(SELECT COUNT(DISTINCT h.record_id) FROM hits h WHERE h.loss ${sf}) AS any_loss,
					(SELECT COUNT(*) FROM "losses") AS loss_rows`),
		rows(sql`
				WITH RECURSIVE ${fr}
				SELECT NULLIF(rec."hip_type_id", '') AS hip_type_id, COUNT(*) AS n
				FROM filtered_records fr JOIN "disaster_records" rec ON rec."id" = fr.record_id
				GROUP BY 1`),
		rows(sql`
				WITH RECURSIVE ${fr}, ${housesCte}
				SELECT NULLIF(rec."hip_type_id", '') AS hip_type_id,
					SUM(h.td) FILTER (WHERE h.td > 0) AS td_sum,
					COUNT(*) FILTER (WHERE h.td > 0) AS td_reported,
					SUM(h.pd) FILTER (WHERE h.pd > 0) AS pd_sum,
					COUNT(*) FILTER (WHERE h.pd > 0) AS pd_reported,
					COUNT(*) AS records_total
				FROM filtered_records fr
				JOIN "disaster_records" rec ON rec."id" = fr.record_id
				LEFT JOIN houses h ON h."record_id" = fr.record_id
				GROUP BY 1`),
		hipTypeLabels(),
	]);

	const total = num(scope[0]?.records);
	const refs = new Map<string, SectorRef>(
		tree.map((r) => [
			r.id as string,
			{
				sectorId: r.id as string,
				label: r.label as string,
				level: Number(r.level),
				parentId: (r.parent_id as string | null) ?? null,
			},
		]),
	);
	const level2 = [...refs.values()].filter((r) => r.level === 2);
	const bySector = new Map(perSector.map((r) => [r.sector_id as string, r]));
	const linked = level2.filter(
		(s) => num(bySector.get(s.sectorId)?.dmg_yes) > 0,
	);
	const damageCell = (id: string) =>
		flagCell(bySector.get(id)?.dmg_yes, bySector.get(id)?.dmg_no, total);
	const typeLabel = (id: string | null) =>
		id === null ? "No HIPs type" : (labels.get(id) ?? `HIPs type ${id}`);

	// Dwellings, by HIPs type and in total.
	const dwellingRows = dwellingsByType.map((r) => ({
		key: (r.hip_type_id as string | null) ?? "none",
		label: typeLabel((r.hip_type_id as string | null) ?? null),
		damaged: countCell(r.pd_sum, r.pd_reported, r.records_total),
		destroyed: countCell(r.td_sum, r.td_reported, r.records_total),
	}));
	const sumOf = (k: "pd" | "td") => {
		const reported = dwellingsByType.reduce(
			(s, r) => s + num(r[`${k}_reported`]),
			0,
		);
		const sum = dwellingsByType.reduce((s, r) => s + num(r[`${k}_sum`]), 0);
		return countCell(reported ? sum : null, reported, total);
	};

	// Panel 2: every level-2 sector under its level-1 heading.
	const groups = [...refs.values()]
		.filter((r) => r.level === 1)
		.map((l1) => ({
			level1: l1,
			rows: level2
				.filter((s) => s.parentId === l1.sectorId)
				.map((s) => ({ sector: s, records: damageCell(s.sectorId) }))
				.sort((a, b) => rankValue(b.records) - rankValue(a.records)),
		}))
		.filter((g) => g.rows.length);

	// Panel 4: hazard by sector, linked sectors only.
	const typeIds = typeTotals.map(
		(r) => (r.hip_type_id as string | null) ?? null,
	);
	const hazardBySector = {
		sectors: linked,
		rows: typeIds.map((id) => ({
			hipTypeId: id ?? "none",
			label: typeLabel(id),
			cells: linked.map((s) => {
				const h = perTypeSector.find(
					(r) =>
						((r.hip_type_id as string | null) ?? null) === id &&
						r.sector_id === s.sectorId,
				);
				const t = num(
					typeTotals.find(
						(r) => ((r.hip_type_id as string | null) ?? null) === id,
					)?.n,
				);
				return flagCell(h?.dmg_yes, h?.dmg_no, t);
			}),
		})),
	};

	// Panel 5: per linked sector, records reporting damage by start year.
	const series = linked.map((s) => ({
		sector: s,
		years: perYear
			.filter((r) => r.sector_id === s.sectorId && r.year !== null)
			.map((r) => ({
				year: Number(r.year),
				records: flagCell(r.dmg_yes, r.dmg_no, num(r.records)),
			}))
			.sort((a, b) => a.year - b.year),
	}));
	const recordsWithoutYear = perYear
		.filter((r) => r.year === null)
		.reduce((s, r) => s + num(r.records), 0);

	// Panel 7: Sendai Targets C and D, national figures only.
	const national = !filters.geographicLevelId && !query.where.region;
	const code = (c: string) => (national ? c : null);
	const notHeld = (c: SectorGap["code"], reason: string): SectorGap => ({
		code: c,
		reason,
	});

	return {
		empty: total ? null : { reason: "No records in scope for these filters." },
		headline: {
			recordsAnySector: flagCell(scope[0]?.any_dmg, 0, total),
			sectorsLinked: { linked: linked.length, level2Total: level2.length },
			dwellingsDamaged: sumOf("pd"),
			dwellingsDestroyed: sumOf("td"),
			losses: flagCell(scope[0]?.any_loss, 0, total),
			money: MONEY_GAP,
		},
		reporting: { groups },
		effectTypes: {
			columns: ["damage_physical", "damage_money", "losses", "disruption"],
			rows: linked.map((s) => {
				const r = bySector.get(s.sectorId);
				return {
					sector: s,
					damagePhysical: damageCell(s.sectorId),
					damageMoney: MONEY_GAP,
					losses: flagCell(r?.loss_yes, r?.loss_no, total),
					disruption: flagCell(r?.disr_yes, r?.disr_no, total),
				};
			}),
		},
		hazardBySector,
		byYear: { series, recordsWithoutYear },
		dwellings: { groupBy: "hipType", rows: dwellingRows },
		sendai: {
			nationalOnly: national,
			rows: [
				{
					code: code("C-2"),
					indicator: "Direct agricultural loss",
					heldLabel: "Records reporting agricultural damage",
					held: damageCell(SECTOR_IDS.agriculture),
					status: "MONEY",
					gap: notHeld(
						"G-04",
						"Agriculture source flags are not linked yet (G-04).",
					),
				},
				{
					code: code("C-3"),
					indicator:
						"Direct economic loss to other damaged or destroyed productive assets",
					heldLabel: "Records reporting industry damage",
					held: damageCell(SECTOR_IDS.industry),
					status: "MONEY",
					gap: MONEY_GAP,
				},
				{
					code: code("C-4"),
					indicator:
						"Direct economic loss in the housing sector, by damaged and destroyed dwellings",
					heldLabel: "Dwellings destroyed",
					held: sumOf("td"),
					status: "MONEY",
					gap: MONEY_GAP,
				},
				{
					code: code("C-5"),
					indicator:
						"Direct economic loss from damaged or destroyed critical infrastructure",
					heldLabel: "",
					held: null,
					status: "MONEY",
					gap: notHeld(
						"G-04",
						"Infrastructure source flags are not linked yet (G-04).",
					),
				},
				{
					code: code("C-6"),
					indicator: "Direct economic loss to cultural heritage",
					heldLabel: "",
					held: null,
					status: "NOT_HELD",
					gap: null,
				},
				{
					code: code("D-2"),
					indicator: "Destroyed or damaged health facilities",
					heldLabel:
						"Records reporting health-sector damage (a yes, not a facility count)",
					held: damageCell(SECTOR_IDS.health),
					status: "NOT_HELD",
					gap: notHeld(
						"G-22",
						"Facility counts are held in source fields and not loaded (G-22).",
					),
				},
				{
					code: code("D-3"),
					indicator: "Destroyed or damaged educational facilities",
					heldLabel:
						"Records reporting education-sector damage (a yes, not a facility count)",
					held: damageCell(SECTOR_IDS.education),
					status: "NOT_HELD",
					gap: notHeld(
						"G-22",
						"Facility counts are held in source fields and not loaded (G-22).",
					),
				},
				{
					code: code("D-4"),
					indicator:
						"Other destroyed or damaged critical infrastructure units and facilities",
					heldLabel: "",
					held: null,
					status: "NOT_HELD",
					gap: null,
				},
				{
					code: code("D-5"),
					indicator: "Disruptions to basic services",
					heldLabel: "",
					held: null,
					status: "NOT_HELD",
					gap: notHeld("G-08", "No disruption records (G-08)."),
				},
			],
		},
		meta: {
			headline: meta(
				`Records in scope reporting damage in any level-2 sector; damage and losses are separate. ${num(scope[0]?.loss_rows)} loss rows are held.`,
				`${linked.length} of ${level2.length} level-2 sectors have records reporting damage`,
			),
			reporting: meta(
				"Records reporting damage per level-2 sector, from the sector flag or a counted damage row in the sector or below it; a record can carry several sectors, so rows do not add up",
			),
			effectTypes: meta(
				"Value state of each effect type per sector; money is not shown (G-06); damage and losses are never merged",
			),
			hazardBySector: meta(
				"Records reporting damage per HIPs type of the record and level-2 sector; columns do not add up",
			),
			byYear: meta(
				"Records reporting damage per sector and start year; records without a start year are counted, not drawn; more records in later years can reflect more reporting",
			),
			dwellings: meta(
				"Counted damage rows in the Housing sector, furniture and equipment left out; destroyed and damaged are never added. Inputs to B-3, B-4 and C-4; no indicator code",
			),
			sendai: meta(
				national
					? "What DELTA holds towards Sendai Targets C and D, national figures. Sendai-aligned counts from national records, not the official Sendai Framework Monitor submission."
					: "Sub-national figures. Not a Sendai indicator value (TR-060).",
			),
		},
	};
}
