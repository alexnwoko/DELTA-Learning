// Adapts geoportal API cells (PD-05 field names) to the shared map-state
// resolver (app/utils/mapState.ts, owned by Analytics), so the geoportal and
// the analytics maps draw every value state the same way. Pure module.

import type { GeoCell } from "~/backend.server/models/geo/queries";
import type { MapCell, MeasureFamily } from "~/utils/mapState";
import { geoMeasureInfo } from "~/utils/geoMeasures";
import { dataTokens } from "~/utils/designTokens.generated";

/** Measure family for the ramp (V-2: one ramp per family). */
export function measureFamily(measure: string): MeasureFamily {
	return geoMeasureInfo(measure).family;
}

/**
 * GeoCell to MapCell. The API counts confirmed zeros inside records_reported
 * (PD-05); the resolver keeps them apart, so they are taken out here.
 * Records shared with another area are not known per cell; the response
 * caption states them.
 */
export function toMapCell(cell: GeoCell): MapCell {
	const precision = Object.entries(cell.geo_precision)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([k, n]) => `GEO-${k} (${n})`)
		.join(", ");
	return {
		areaId: cell.division_id,
		value: cell.value,
		valueState: cell.value_state,
		recordsReported: cell.records_reported - cell.records_zero_confirmed,
		recordsZeroConfirmed: cell.records_zero_confirmed,
		recordsTotal: cell.records_total,
		recordsFlagged: cell.plausibility_flagged_records,
		gradeDistribution: cell.gradeDistribution,
		geoPrecision: precision || null,
	};
}

/** Areas with no record in scope: not a value state, so drawn on its own. */
export const NO_RECORDS_STYLE = {
	fill: dataTokens.map.noRecords.fill,
	stroke: dataTokens.map.noRecords.stroke,
	strokeWidth: 0.8,
	label: "Nothing in scope",
} as const;

/**
 * RV-5 density: value per 1,000 km2 of the division's true area, rounded for
 * reading (whole numbers from 100, one decimal from 1, two significant digits
 * below). No area gives null, never zero.
 */
export function densityPer1000Km2(value: number, km2: number): number | null {
	if (!(km2 > 0)) return null;
	const d = (value / km2) * 1000;
	if (d === 0) return 0;
	if (Math.abs(d) >= 100) return Math.round(d);
	if (Math.abs(d) >= 1) return Math.round(d * 10) / 10;
	return Number(d.toPrecision(2));
}

export interface BarPartInput {
	key: string;
	label: string;
	cells: readonly GeoCell[];
}

/**
 * Bars mode (Alex 2026-10-17, option B): one cell per area whose parts are
 * the breakdown, for example houses destroyed and damaged. Parts are never
 * added: the cell's value is the largest reported part, used only to decide
 * whether the area carries bars. Record counts come from the first part
 * (both measures are read from the same records). An area where no part is
 * reported keeps the first part's state, so it draws no bars.
 */
export function barCells(inputs: readonly BarPartInput[]): MapCell[] {
	const byPart = inputs.map(
		(p) => new Map(p.cells.map((c) => [c.division_id, c])),
	);
	const ids = new Set(inputs.flatMap((p) => p.cells.map((c) => c.division_id)));
	return [...ids].sort().map((id) => {
		const first = byPart.map((m) => m.get(id)).find(Boolean) as GeoCell;
		const base = toMapCell(first);
		const parts = inputs.map((p, i) => {
			const c = byPart[i].get(id);
			return {
				key: p.key,
				label: p.label,
				value: c?.value_state === "reported" ? c.value : null,
				valueState: c?.value_state ?? "not_reported",
				recordsFlagged: c?.plausibility_flagged_records ?? 0,
			};
		});
		const reported = parts
			.map((p) => p.value)
			.filter((v): v is number => typeof v === "number");
		if (reported.length === 0) return { ...base, parts };
		return {
			...base,
			value: Math.max(...reported),
			valueState: "reported" as const,
			// A record flagged on both parts is one record: the larger count, never the sum.
			recordsFlagged: Math.max(...parts.map((p) => p.recordsFlagged ?? 0)),
			parts,
		};
	});
}
