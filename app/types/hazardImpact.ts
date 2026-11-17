import type { DisasterImpactMetadata } from "./disasterCalculations";
import type { ValueState } from "~/utils/valueState";

export interface HazardImpactData {
	eventsCount: HazardDataPoint[] | null;
	damages: HazardDataPoint[] | null;
	losses: HazardDataPoint[] | null;
	metadata: DisasterImpactMetadata;
}

export interface HazardDataPoint {
	hazardId: string;
	hazardName: string;
	/** null when no record reported the figure, never "0" (TR-076). */
	value: string | null;
	/** Share of the reported total; null when the figure is not reported. */
	percentage: number | null;
	/** Set on monetary figures: reported or not_reported (PD-04:596). */
	valueState?: ValueState;
	recordsReported?: number;
	recordsTotal?: number;
}

export interface HazardImpactFilters {
	sectorId?: string;
	hazardTypeId?: string;
	hazardClusterId?: string;
	specificHazardId?: string;
	geographicLevelId?: string;
	fromDate?: string;
	toDate?: string;
	disasterEventId?: string;
	_disasterEventId?: string;
	assessmentType?: "rapid" | "detailed";
	confidenceLevel?: "low" | "medium" | "high";
}

export interface HazardImpactResult {
	eventsCount: HazardDataPoint[];
	damages: HazardDataPoint[];
	losses: HazardDataPoint[];
	metadata: DisasterImpactMetadata;
}

export interface HazardImpactResponse {
	success: boolean;
	data?: HazardImpactData;
	error?: string;
}
