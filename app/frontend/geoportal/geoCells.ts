// Adapts geoportal API cells (PD-05 field names) to the shared map-state
// resolver (app/utils/mapState.ts, owned by Analytics), so the geoportal and
// the analytics maps draw every value state the same way. Pure module.

import type { GeoCell } from "~/backend.server/models/geo/queries";
import type { MapCell, MeasureFamily } from "~/utils/mapState";

/** Measure family for the ramp (V-2: one ramp per family). */
export function measureFamily(measure: string): MeasureFamily {
	if (measure.startsWith("houses_")) return "housing";
	if (measure === "records" || measure === "events") return "events";
	return "people";
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
