import {
	etagMatches,
	geoEtag,
	geoLoader,
	geometryCacheControl,
} from "~/backend.server/handlers/geo";
import {
	admin0Version,
	worldBoundaries,
} from "~/backend.server/models/geo/tenantExtent";

// World admin-0 reference layer (Alex, 2026-10-18): every country's border
// and name, the same for every tenant. Signed in or API key, like every geo
// route. Cached for a year on a URL that carries the admin-0 version (`v`),
// so a browser downloads it once per reload of geo.admin0, not per refresh.
export const loader = geoLoader(async ({ request }, { url }) => {
	const version = await admin0Version();
	const etag = geoEtag("world", version, url);
	const cacheControl = geometryCacheControl(url, version);
	if (etagMatches(request, etag)) {
		return new Response(null, {
			status: 304,
			headers: { ETag: etag, "Cache-Control": cacheControl },
		});
	}
	return Response.json(await worldBoundaries(), {
		headers: { ETag: etag, "Cache-Control": cacheControl },
	});
});
