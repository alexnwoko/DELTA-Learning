import type { LoaderFunctionArgs } from "react-router";
import { apiAuth } from "~/backend.server/models/api_key";
import {
	baseMeta,
	GeoRefusalError,
	refusalBody,
	type GeoQuery,
} from "~/backend.server/models/geo/queries";
import { authLoaderWithPerm } from "~/utils/auth";
import { getCountryAccountsIdFromSession } from "~/utils/session";

export interface GeoRequestContext {
	countryAccountsId: string;
	lang: string;
	url: URL;
}

type GeoHandler = (
	args: LoaderFunctionArgs,
	ctx: GeoRequestContext,
) => Promise<Response>;

/**
 * One auth resolver for every geo endpoint (build spec s5.1): an X-Auth API
 * key or a session with ViewData, both resolving to one tenant. Refusals are
 * returned as the envelope with their own status (200 semantic, 422
 * violation, 400 malformed), so the provenance block survives the refusal.
 */
export function geoLoader(handler: GeoHandler) {
	const run = async (args: LoaderFunctionArgs, countryAccountsId: string) => {
		const url = new URL(args.request.url);
		const ctx: GeoRequestContext = {
			countryAccountsId,
			lang: args.params.lang || "en",
			url,
		};
		try {
			return await handler(args, ctx);
		} catch (err) {
			if (err instanceof GeoRefusalError) {
				const meta = await baseMeta(countryAccountsId, {} as GeoQuery);
				return Response.json(refusalBody(err, meta), { status: err.status });
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
			return run(args, countryAccountsId);
		},
	);

	return async (args: LoaderFunctionArgs) => {
		if (args.request.headers.get("X-Auth")) {
			const apiKey = await apiAuth(args.request);
			if (!apiKey.countryAccountsId) {
				throw new Response("Unauthorized", { status: 401 });
			}
			return run(args, apiKey.countryAccountsId);
		}
		return sessionLoader(args);
	};
}

/** Weak ETag from the read-model refresh time and the request query. */
export function geoEtag(refreshedAt: string | null, url: URL): string {
	const basis = `${refreshedAt ?? "none"}|${url.pathname}|${url.searchParams.toString()}`;
	let h = 0;
	for (let i = 0; i < basis.length; i++) {
		h = (Math.imul(31, h) + basis.charCodeAt(i)) | 0;
	}
	return `W/"geo-${(h >>> 0).toString(16)}"`;
}
