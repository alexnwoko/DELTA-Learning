import {
	etagMatches,
	geoEtag,
	geoLoader,
	GeoRefusalWithMeta,
	resolveGeoRequest,
} from "~/backend.server/handlers/geo";
import {
	baseMeta,
	GeoRefusalError,
	getChoropleth,
	readModelRefreshedAt,
} from "~/backend.server/models/geo/queries";

// G2 (PD-05): one measure aggregated by division at one level.
export const loader = geoLoader(async (_args, ctx) => {
	const req = await resolveGeoRequest(ctx, {
		requireMeasure: true,
		requireLevel: true,
	});
	const etag = geoEtag(
		ctx.countryAccountsId,
		await readModelRefreshedAt(ctx.countryAccountsId),
		ctx.url,
	);
	if (etagMatches(ctx.request, etag)) {
		return new Response(null, { status: 304, headers: { ETag: etag } });
	}
	try {
		const body = await getChoropleth(ctx.countryAccountsId, req);
		return Response.json(body, {
			headers: { ETag: etag, "Cache-Control": "private, no-cache" },
		});
	} catch (err) {
		if (err instanceof GeoRefusalError) {
			throw new GeoRefusalWithMeta(
				err,
				await baseMeta(ctx.countryAccountsId, req),
			);
		}
		throw err;
	}
});
