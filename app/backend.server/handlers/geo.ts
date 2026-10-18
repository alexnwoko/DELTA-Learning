import type { LoaderFunctionArgs } from "react-router";
import { sql } from "drizzle-orm";
import { dr } from "~/db.server";
import { approvalAudienceForBasis } from "~/backend.server/approvalAudience.server";
import { apiAuth } from "~/backend.server/models/api_key";
import {
	baseMeta,
	GeoRefusalError,
	refusalBody,
	type GeoMeta,
	type GeoRequest,
} from "~/backend.server/models/geo/queries";
import type { ApprovalAudience } from "~/utils/approvalBasis";
import { authLoaderWithPerm } from "~/utils/auth";
import {
	isMonetaryMeasure,
	parseDeltaQuery,
	QUERY_REFUSALS,
	type DeltaQuery,
	type QueryIssue,
} from "~/utils/deltaQuery";
import { geoMeasuresFor, isGeoMeasure } from "~/utils/geoMeasures";
import { getCountryAccountsIdFromSession } from "~/utils/session";

export interface GeoRequestContext {
	countryAccountsId: string;
	lang: string;
	url: URL;
	request: Request;
	/** True when the caller authenticated with an X-Auth API key. */
	viaApiKey: boolean;
}

type GeoHandler = (
	args: LoaderFunctionArgs,
	ctx: GeoRequestContext,
) => Promise<Response>;

/** Thrown by handlers that already know the meta for their refusal. */
export class GeoRefusalWithMeta extends Error {
	constructor(
		public readonly refusal: GeoRefusalError,
		public readonly meta: GeoMeta,
	) {
		super(refusal.message);
	}
}

/**
 * One auth resolver for every geo endpoint (build spec s5.1, PD-05): an
 * X-Auth API key or a session with ViewData, both resolving to one tenant.
 * The API key path follows authLoaderApi: the tenant comes from the key and a
 * key without one is refused. Refusals return the envelope with their own
 * status (200 semantic, 400 malformed, 422 violation), so the provenance
 * block survives the refusal.
 */
export function geoLoader(handler: GeoHandler) {
	const run = async (
		args: LoaderFunctionArgs,
		countryAccountsId: string,
		viaApiKey: boolean,
	) => {
		const ctx: GeoRequestContext = {
			countryAccountsId,
			lang: args.params.lang || "en",
			url: new URL(args.request.url),
			request: args.request,
			viaApiKey,
		};
		try {
			return await handler(args, ctx);
		} catch (err) {
			if (err instanceof GeoRefusalWithMeta) {
				return Response.json(refusalBody(err.refusal, err.meta), {
					status: err.refusal.status,
				});
			}
			if (err instanceof GeoRefusalError) {
				return Response.json(refusalBody(err, null), { status: err.status });
			}
			throw err;
		}
	};

	const sessionLoader = authLoaderWithPerm(
		"ViewData",
		async (args: LoaderFunctionArgs) => {
			const countryAccountsId = await getCountryAccountsIdFromSession(
				args.request,
			);
			if (!countryAccountsId) {
				throw new Response("Unauthorized", { status: 401 });
			}
			return run(args, countryAccountsId, false);
		},
	);

	return async (args: LoaderFunctionArgs) => {
		if (args.request.headers.get("X-Auth")) {
			const apiKey = await apiAuth(args.request);
			if (!apiKey.countryAccountsId) {
				throw new Response("Unauthorized", { status: 401 });
			}
			return run(args, apiKey.countryAccountsId, true);
		}
		return sessionLoader(args);
	};
}

function malformed(message: string): GeoRefusalError {
	return new GeoRefusalError(
		"MALFORMED_REQUEST",
		message,
		"PD-05 error codes",
		"Correct the request parameters.",
		400,
	);
}

const PARTIAL_DATE_PARTS = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/;

/** A partial date whose parts exist on the calendar ("2015-02-30" does not). */
export function isCalendarPartialDate(v: string): boolean {
	const m = v.match(PARTIAL_DATE_PARTS);
	if (!m) return false;
	const year = Number(m[1]);
	if (year < 1) return false;
	if (m[2] === undefined) return true;
	const month = Number(m[2]);
	if (month < 1 || month > 12) return false;
	if (m[3] === undefined) return true;
	const day = Number(m[3]);
	const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
	return day >= 1 && day <= last;
}

/** Parameters that refuse the request when rejected: dropping them changes the figure. */
const REFUSING_PARAMS = new Set([
	"division",
	"region",
	"measure",
	"basis",
	"from",
	"to",
	"minAttGrade",
]);

/**
 * Resolves delta.query/1 and the geo view state for one request.
 *
 * - A rejected division, measure, basis, date or grade floor refuses the
 *   request; a dropped division would silently widen the view.
 * - Any other rejected or unsupported filter is named in meta.notApplied.
 * - basis=provisional is for signed-in reviewers with ValidateData only (AB-01);
 *   API keys and everyone else get 403, never a silent downgrade.
 */
export async function resolveGeoRequest(
	ctx: GeoRequestContext,
	opts: {
		requireMeasure: boolean;
		requireLevel: boolean;
		/** The view serves the two event dimensions as well as disaster impact. */
		eventDimensions?: boolean;
		/** The view applies the RG-1 region facet; others name it in notApplied. */
		region?: boolean;
	},
): Promise<GeoRequest> {
	const { query, issues } = parseDeltaQuery(ctx.url.searchParams);
	const notApplied: string[] = [];
	try {
		return await resolveParsed(ctx, opts, query, issues, notApplied);
	} catch (err) {
		if (err instanceof GeoRefusalError) {
			// The refusal keeps its provenance block: the query as requested.
			const level = Number(ctx.url.searchParams.get("level"));
			const meta = await baseMeta(ctx.countryAccountsId, {
				query,
				level: Number.isInteger(level) ? level : undefined,
				audience:
					query.scope.basis === "provisional"
						? "reviewer-provisional"
						: "signed-in",
				notApplied,
			});
			throw new GeoRefusalWithMeta(err, meta);
		}
		throw err;
	}
}

async function resolveParsed(
	ctx: GeoRequestContext,
	opts: {
		requireMeasure: boolean;
		requireLevel: boolean;
		/** The view serves the two event dimensions as well as disaster impact. */
		eventDimensions?: boolean;
		region?: boolean;
	},
	query: DeltaQuery,
	issues: QueryIssue[],
	notApplied: string[],
): Promise<GeoRequest> {
	const params = ctx.url.searchParams;

	for (const issue of issues) {
		if (issue.reason === QUERY_REFUSALS.multiSeries) {
			throw new GeoRefusalError(
				QUERY_REFUSALS.multiSeries,
				"A choropleth shows one measure. Several were requested.",
				"TR-167",
				"Request one measure per map, or use the table view to compare measures.",
			);
		}
		if (issue.reason === QUERY_REFUSALS.attD) {
			throw new GeoRefusalError(
				QUERY_REFUSALS.attD,
				"Figures attributed by downward split (ATT-D) are excluded from geoportal figures.",
				"VIS-Q05; pack decision 13",
				"Use minAttGrade A, B or C.",
			);
		}
		if (issue.refusal === QUERY_REFUSALS.regionAndDivision) {
			throw new GeoRefusalError(
				QUERY_REFUSALS.regionAndDivision,
				"A request can filter by a division or by a region, not both.",
				"RG-1; delta.query/1 place facet",
				"Remove division or region.",
				422,
			);
		}
		if (issue.refusal) {
			// A refusal the parser names must refuse, never serve without it.
			throw new GeoRefusalError(
				issue.refusal,
				`${issue.param}: ${issue.reason}.`,
				"delta.query/1",
				"Correct the request parameters.",
				422,
			);
		}
		if (REFUSING_PARAMS.has(issue.param)) {
			throw malformed(`${issue.param}: ${issue.reason}.`);
		}
		notApplied.push(`${issue.param}: ${issue.reason}`);
	}

	for (const key of ["from", "to"] as const) {
		const v = query.where.time?.[key];
		if (v && !isCalendarPartialDate(v)) {
			throw malformed(`${key}: ${v} is not a calendar date.`);
		}
	}

	const isEventDim = query.dimension !== "disaster_impact";
	if (isEventDim && !opts.eventDimensions) {
		notApplied.push(`dim: this view shows disaster impacts`);
		query.dimension = "disaster_impact";
	}
	if (!query.measure && query.dimension !== "disaster_impact") {
		query.measure = "events";
	}
	if (query.measure) {
		if (isMonetaryMeasure(query.measure)) {
			throw new GeoRefusalError(
				QUERY_REFUSALS.monetaryPending,
				"Monetary figures are not totalled until the money conventions are confirmed.",
				"TR-167; PD-05 refusal table",
				"Show human effects or disaster impact counts, or wait for the currency and deflator ruling.",
			);
		}
		if (!isGeoMeasure(query.measure, query.dimension)) {
			throw new GeoRefusalError(
				QUERY_REFUSALS.measureNotAvailable,
				`The measure "${query.measure}" is not available for the ${query.dimension} dimension.`,
				"TR-260",
				`Use one of: ${geoMeasuresFor(query.dimension).join(", ")}.`,
			);
		}
	} else if (opts.requireMeasure) {
		throw malformed("measure is required.");
	}

	let level: number | undefined;
	const levelParam = params.get("level");
	if (opts.requireLevel || levelParam) {
		const n = Number(levelParam);
		if (!levelParam || !Number.isInteger(n) || n < 0) {
			throw malformed("level must be a non-negative integer.");
		}
		level = n;
	}

	const w = query.where;
	if (w.sectors?.length) notApplied.push("sector: not in the read model");
	if (w.humanEffects?.length) {
		notApplied.push("effect: the map shows one measure; use measure");
	}
	if (w.disasterEventId) {
		notApplied.push("disasterEvent: not in the read model");
	}
	if (w.hazardousEventId) {
		notApplied.push("hazardousEvent: not in the read model");
	}
	if (query.scope.asOf) {
		notApplied.push("asOf: the read model holds the current state only");
	}

	if (w.geo?.divisionId) {
		const res = await dr.execute(sql`
			SELECT 1 FROM geo.division_geom_cache
			WHERE division_id = ${w.geo.divisionId}
				AND country_accounts_id = ${ctx.countryAccountsId}
		`);
		if (res.rows.length === 0) {
			// Another tenant's division is not revealed (SEC-22).
			throw new Response("Division not found", { status: 404 });
		}
	}

	// RG-1 place facet (delta.query/1 where.region, URL key "region"). The
	// parser refuses it together with a division; a view without region
	// support names it in notApplied and drops it from the query, so the
	// provenance block never claims a filter that was not applied.
	if (w.region) {
		if (!opts.region) {
			notApplied.push("region: this view does not apply regions yet");
			delete w.region;
		} else {
			const res = await dr.execute(sql`
				SELECT 1 FROM geo.region
				WHERE region_id = ${w.region.regionId}
					AND country_accounts_id = ${ctx.countryAccountsId}
			`);
			if (res.rows.length === 0) {
				// Another tenant's region is not revealed (SEC-22).
				throw new Response("Region not found", { status: 404 });
			}
		}
	}

	let audience: ApprovalAudience;
	if (ctx.viaApiKey) {
		if (query.scope.basis === "provisional") {
			throw new Response(
				"The provisional basis is for signed-in reviewers only",
				{ status: 403 },
			);
		}
		audience = "signed-in";
	} else {
		audience = await approvalAudienceForBasis(ctx.request, query.scope.basis);
	}

	return { query, level, audience, notApplied };
}

/** Weak ETag from the tenant, the read-model refresh time and the request. */
export function geoEtag(
	countryAccountsId: string,
	refreshedAt: string | null,
	url: URL,
): string {
	const basis = `${countryAccountsId}|${refreshedAt ?? "none"}|${url.pathname}|${url.searchParams.toString()}`;
	let h1 = 0x811c9dc5;
	let h2 = 0;
	for (let i = 0; i < basis.length; i++) {
		const c = basis.charCodeAt(i);
		h1 = Math.imul(h1 ^ c, 0x01000193);
		h2 = (Math.imul(31, h2) + c) | 0;
	}
	return `W/"geo-${(h1 >>> 0).toString(16)}${(h2 >>> 0).toString(16)}"`;
}

/** True when an If-None-Match header names this ETag, or is "*". */
/**
 * Cache-Control for geometry (NFR-113). A URL that carries the current map
 * data version (`v`) never changes content, so the browser keeps it for a
 * year without asking again; any other URL revalidates with its ETag.
 * Always private: geometry is read under the user's session.
 */
export function geometryCacheControl(url: URL, version: string | null): string {
	return version !== null && url.searchParams.get("v") === version
		? "private, max-age=31536000, immutable"
		: "private, no-cache";
}

export function etagMatches(request: Request, etag: string): boolean {
	const header = request.headers.get("If-None-Match");
	if (!header) return false;
	return header
		.split(",")
		.map((s) => s.trim())
		.some((s) => s === "*" || s === etag);
}
