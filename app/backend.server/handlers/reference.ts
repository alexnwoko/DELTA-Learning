import type { LoaderFunctionArgs } from "react-router";
import { apiAuth } from "~/backend.server/models/api_key";
import type { RefAudience } from "~/backend.server/models/ref/referenceRead";
import { authLoaderWithPerm } from "~/utils/auth";
import { getCountryAccountsIdFromSession } from "~/utils/session";

// BM-6 (FR-BAS-180; PD-05 reference endpoints; D-BM-01, D-BM-08): one auth
// resolver for /:lang/api/reference/*, as for the geo routes: an X-Auth API
// key or a session with ViewData, both resolving to one tenant. The caller's
// channel decides which licence rules the read model applies.

export interface ReferenceRequestContext {
	countryAccountsId: string;
	audience: RefAudience;
	url: URL;
}

type ReferenceHandler = (ctx: ReferenceRequestContext) => Promise<Response>;

export function referenceLoader(handler: ReferenceHandler) {
	const sessionLoader = authLoaderWithPerm(
		"ViewData",
		async (args: LoaderFunctionArgs) => {
			const countryAccountsId = await getCountryAccountsIdFromSession(
				args.request,
			);
			if (!countryAccountsId) {
				throw new Response("Unauthorized", { status: 401 });
			}
			return handler({
				countryAccountsId,
				audience: "signed_in",
				url: new URL(args.request.url),
			});
		},
	);

	return async (args: LoaderFunctionArgs) => {
		if (args.request.headers.get("X-Auth")) {
			const apiKey = await apiAuth(args.request);
			if (!apiKey.countryAccountsId) {
				throw new Response("Unauthorized", { status: 401 });
			}
			return handler({
				countryAccountsId: apiKey.countryAccountsId,
				audience: "api_key",
				url: new URL(args.request.url),
			});
		}
		return sessionLoader(args);
	};
}
