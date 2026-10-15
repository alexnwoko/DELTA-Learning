// The selection object delta.query/1 (PD v1.0: one selection object for the
// Data, Analytics and Geoportal areas; TR-175, TR-182). The URL, permalinks,
// report exports and every analytics or geo response carry the same object.
// Field names follow the query contract of geoportal work package 1
// (work_query-contract.md section a), with `dimension` in place of `grain`.
// Pure module: no database access, safe for server and client code.

export const QUERY_CONTRACT = "delta.query/1" as const;

/**
 * The three DELTA dimensions. "disaster_impact" is the analysis name of the
 * dimension built on disaster records (Alex 2026-10-15); the data-entry
 * entity and its API keep the name "disaster record".
 */
export const QUERY_DIMENSIONS = [
	"hazardous_event",
	"disaster_event",
	"disaster_impact",
] as const;
export type QueryDimension = (typeof QUERY_DIMENSIONS)[number];

/** Approval basis (AB-01): published by default; provisional for reviewers. */
export const QUERY_BASES = ["published", "provisional"] as const;
export type QueryBasis = (typeof QUERY_BASES)[number];

export const HUMAN_EFFECTS = [
	"deaths",
	"injured",
	"missing",
	"affected_direct",
	"affected_indirect",
	"displaced",
] as const;
export type QueryHumanEffect = (typeof HUMAN_EFFECTS)[number];

/**
 * One measure per query (Geoportal proposal 2026-10-15). Monetary measures
 * parse, but every endpoint refuses them with MONETARY_CONVENTIONS_PENDING
 * until the money convention (D-04, memo 5b) is ruled.
 */
export const QUERY_MEASURES = [
	"records",
	...HUMAN_EFFECTS,
	"houses_destroyed",
	"houses_damaged",
	"evacuated",
	"relocated",
	"events",
	"records_per_event",
	"damages",
	"losses",
	"disruption",
	"total_damage_amount",
] as const;
export type QueryMeasure = (typeof QUERY_MEASURES)[number];

export const MONETARY_MEASURES: readonly QueryMeasure[] = [
	"damages",
	"losses",
	"disruption",
	"total_damage_amount",
];

export function isMonetaryMeasure(m: QueryMeasure): boolean {
	return MONETARY_MEASURES.includes(m);
}

/**
 * Attribution grade floor (TR-071). D is never a floor: grade D is excluded
 * from official reporting. A floor narrows attribution, not the record set,
 * and every response that applies it reports excluded_by_grade_floor beside
 * the figure (TR-072).
 */
export const ATT_GRADE_FLOORS = ["A", "B", "C"] as const;
export type AttGradeFloor = (typeof ATT_GRADE_FLOORS)[number];

/** Refusal codes the query parser can raise (PD-05 refusal table). */
export const QUERY_REFUSALS = {
	multiSeries: "MULTI_SERIES_CHOROPLETH",
	attD: "ATT_D_EXCLUDED_FROM_OFFICIAL",
} as const;

export interface DeltaQuery {
	contract: typeof QUERY_CONTRACT;
	dimension: QueryDimension;
	/** One measure; absent means the view's default measure. */
	measure?: QueryMeasure;
	/** Attribution grade floor; absent means no floor. */
	minAttGrade?: AttGradeFloor;
	scope: {
		basis: QueryBasis;
		/** ISO date the figures are read as of; absent means now. */
		asOf?: string;
	};
	where: {
		hazard?: { typeId?: string; clusterId?: string; hazardId?: string };
		/** A division and its descendants, within the tenant. */
		geo?: { divisionId: string };
		/** Inclusive ISO dates (YYYY, YYYY-MM or YYYY-MM-DD). */
		time?: { from?: string; to?: string };
		sectors?: string[];
		humanEffects?: QueryHumanEffect[];
		/** Restricts Disaster impact to one disaster event (embedded views). */
		disasterEventId?: string;
		/** Restricts to one hazardous event (embedded views). */
		hazardousEventId?: string;
	};
}

export const DEFAULT_QUERY: DeltaQuery = {
	contract: QUERY_CONTRACT,
	dimension: "disaster_impact",
	scope: { basis: "published" },
	where: {},
};

const UUID =
	/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const PARTIAL_DATE = /^\d{4}(-\d{2}(-\d{2})?)?$/;

/**
 * HIP ids (hip_class, hip_cluster, hip_hazard and the record columns that
 * point at them) are numeric text, for example "1037"; the newer hazard
 * tables use UUIDs. Either form is a valid hazard id.
 */
const HIP_ID = /^\d{1,12}$/;

export function isHipId(v: unknown): v is string {
	return typeof v === "string" && (HIP_ID.test(v) || UUID.test(v));
}

export function isUuid(v: unknown): v is string {
	return typeof v === "string" && UUID.test(v);
}

function isPartialDate(v: unknown): v is string {
	return typeof v === "string" && PARTIAL_DATE.test(v);
}

/** One rejected input, so the caller can report it in meta.notApplied. */
export interface QueryIssue {
	param: string;
	reason: string;
}

export interface ParsedQuery {
	query: DeltaQuery;
	issues: QueryIssue[];
}

/** URL parameter names: short and readable, one per filter. */
const P = {
	dimension: "dim",
	grain: "grain",
	basis: "basis",
	asOf: "asOf",
	hazardType: "hipType",
	hazardCluster: "hipCluster",
	hazard: "hip",
	division: "division",
	from: "from",
	to: "to",
	sector: "sector",
	effect: "effect",
	disasterEvent: "disasterEvent",
	measure: "measure",
	minAttGrade: "minAttGrade",
	hazardousEvent: "hazardousEvent",
} as const;

/** The work package 1 contract used `grain`; its values map onto dimension. */
function dimensionFromGrain(grain: string): QueryDimension | null {
	if (grain === "disaster_record") return "disaster_impact";
	return (QUERY_DIMENSIONS as readonly string[]).includes(grain)
		? (grain as QueryDimension)
		: null;
}

/**
 * Reads delta.query/1 from URL search parameters. Unknown or malformed
 * values are not applied and never guessed; each one is returned in
 * `issues`, so the caller states it in meta.notApplied (TR-175) or refuses
 * the request. A dropped division filter widens the view, so it must never
 * pass unreported.
 */
export function parseDeltaQuery(params: URLSearchParams): ParsedQuery {
	const issues: QueryIssue[] = [];
	const query: DeltaQuery = {
		contract: QUERY_CONTRACT,
		dimension: DEFAULT_QUERY.dimension,
		scope: { basis: "published" },
		where: {},
	};

	const dim = params.get(P.dimension) ?? params.get(P.grain);
	if (dim !== null) {
		const d = dimensionFromGrain(dim);
		if (d) query.dimension = d;
		else
			issues.push({ param: P.dimension, reason: `unknown dimension "${dim}"` });
	}

	const measures = params.getAll(P.measure).filter((m) => m !== "");
	if (measures.length > 1) {
		issues.push({ param: P.measure, reason: QUERY_REFUSALS.multiSeries });
	} else if (measures.length === 1) {
		if ((QUERY_MEASURES as readonly string[]).includes(measures[0])) {
			query.measure = measures[0] as QueryMeasure;
		} else {
			issues.push({
				param: P.measure,
				reason: `unknown measure "${measures[0]}"`,
			});
		}
	}

	const floor = params.get(P.minAttGrade);
	if (floor !== null && floor !== "") {
		if ((ATT_GRADE_FLOORS as readonly string[]).includes(floor)) {
			query.minAttGrade = floor as AttGradeFloor;
		} else if (floor === "D") {
			issues.push({ param: P.minAttGrade, reason: QUERY_REFUSALS.attD });
		} else {
			issues.push({
				param: P.minAttGrade,
				reason: `unknown grade floor "${floor}"`,
			});
		}
	}

	const basis = params.get(P.basis);
	if (basis !== null) {
		if ((QUERY_BASES as readonly string[]).includes(basis)) {
			query.scope.basis = basis as QueryBasis;
		} else {
			issues.push({ param: P.basis, reason: `unknown basis "${basis}"` });
		}
	}

	const asOf = params.get(P.asOf);
	if (asOf !== null) {
		if (/^\d{4}-\d{2}-\d{2}$/.test(asOf)) query.scope.asOf = asOf;
		else issues.push({ param: P.asOf, reason: "not an ISO date" });
	}

	const uuidParam = (name: string): string | undefined => {
		const v = params.get(name);
		if (v === null || v === "") return undefined;
		if (isUuid(v)) return v;
		issues.push({ param: name, reason: "not a valid id" });
		return undefined;
	};

	const hipParam = (name: string): string | undefined => {
		const v = params.get(name);
		if (v === null || v === "") return undefined;
		if (isHipId(v)) return v;
		issues.push({ param: name, reason: "not a valid hazard id" });
		return undefined;
	};
	const typeId = hipParam(P.hazardType);
	const clusterId = hipParam(P.hazardCluster);
	const hazardId = hipParam(P.hazard);
	if (typeId || clusterId || hazardId) {
		query.where.hazard = {
			...(typeId && { typeId }),
			...(clusterId && { clusterId }),
			...(hazardId && { hazardId }),
		};
	}

	const divisionId = uuidParam(P.division);
	if (divisionId) query.where.geo = { divisionId };

	const from = params.get(P.from);
	const to = params.get(P.to);
	for (const [name, v] of [
		[P.from, from],
		[P.to, to],
	] as const) {
		if (v !== null && v !== "" && !isPartialDate(v)) {
			issues.push({
				param: name,
				reason: "not a date (YYYY, YYYY-MM or YYYY-MM-DD)",
			});
		}
	}
	const okFrom = from && isPartialDate(from) ? from : undefined;
	const okTo = to && isPartialDate(to) ? to : undefined;
	if (okFrom || okTo) {
		query.where.time = {
			...(okFrom && { from: okFrom }),
			...(okTo && { to: okTo }),
		};
	}

	const sectors: string[] = [];
	for (const v of params.getAll(P.sector)) {
		if (isUuid(v)) sectors.push(v);
		else issues.push({ param: P.sector, reason: "not a valid id" });
	}
	if (sectors.length) query.where.sectors = [...new Set(sectors)];

	const effects: QueryHumanEffect[] = [];
	for (const v of params.getAll(P.effect)) {
		if ((HUMAN_EFFECTS as readonly string[]).includes(v)) {
			effects.push(v as QueryHumanEffect);
		} else {
			issues.push({ param: P.effect, reason: `unknown effect "${v}"` });
		}
	}
	if (effects.length) query.where.humanEffects = [...new Set(effects)];

	const disasterEventId = uuidParam(P.disasterEvent);
	if (disasterEventId) query.where.disasterEventId = disasterEventId;
	const hazardousEventId = uuidParam(P.hazardousEvent);
	if (hazardousEventId) query.where.hazardousEventId = hazardousEventId;

	return { query, issues };
}

/**
 * Writes delta.query/1 as URL search parameters. Defaults are left out, so
 * the shortest URL reproduces the view; parse(serialise(q)) equals q.
 */
export function serializeDeltaQuery(query: DeltaQuery): URLSearchParams {
	const params = new URLSearchParams();
	if (query.dimension !== DEFAULT_QUERY.dimension) {
		params.set(P.dimension, query.dimension);
	}
	if (query.measure) params.set(P.measure, query.measure);
	if (query.minAttGrade) params.set(P.minAttGrade, query.minAttGrade);
	if (query.scope.basis !== "published") params.set(P.basis, query.scope.basis);
	if (query.scope.asOf) params.set(P.asOf, query.scope.asOf);
	const w = query.where;
	if (w.hazard?.typeId) params.set(P.hazardType, w.hazard.typeId);
	if (w.hazard?.clusterId) params.set(P.hazardCluster, w.hazard.clusterId);
	if (w.hazard?.hazardId) params.set(P.hazard, w.hazard.hazardId);
	if (w.geo?.divisionId) params.set(P.division, w.geo.divisionId);
	if (w.time?.from) params.set(P.from, w.time.from);
	if (w.time?.to) params.set(P.to, w.time.to);
	for (const s of w.sectors ?? []) params.append(P.sector, s);
	for (const e of w.humanEffects ?? []) params.append(P.effect, e);
	if (w.disasterEventId) params.set(P.disasterEvent, w.disasterEventId);
	if (w.hazardousEventId) params.set(P.hazardousEvent, w.hazardousEventId);
	return params;
}

/**
 * Applies filters that an embedding page locks (for example a disaster event
 * page embedding the Disaster impact dashboard). Locked values win over the
 * URL, so an embed cannot be widened by editing the link.
 */
export function withLockedFilters(
	query: DeltaQuery,
	locked: Partial<Pick<DeltaQuery, "dimension">> & {
		where?: Partial<DeltaQuery["where"]>;
	},
): DeltaQuery {
	return {
		...query,
		dimension: locked.dimension ?? query.dimension,
		where: { ...query.where, ...(locked.where ?? {}) },
	};
}
