import type { LoaderFunctionArgs } from "react-router";

import {
	parseTileAddress,
	readTile,
	satelliteTileDir,
} from "~/utils/basemap.server";

// I-3: self-hosted satellite tiles (ESA WorldCover 2021 composite) on the DELTA origin (TR-166, SEC-20).
// Public: tiles carry no tenant data. A missing tile is a 404, which the
// map treats as blank sea or an area outside the rendered extent.
export async function loader({ params, request }: LoaderFunctionArgs) {
	const a = parseTileAddress(params.z, params.x, params.y);
	if (!a) return new Response("Not a tile", { status: 400 });
	const tile = await readTile(a, satelliteTileDir());
	if (!tile) return new Response(null, { status: 404 });
	const etag = `"${a.z}-${a.x}-${a.y}-${Math.round(tile.mtimeMs)}-${tile.body.length}"`;
	if (request.headers.get("If-None-Match") === etag) {
		return new Response(null, { status: 304, headers: { ETag: etag } });
	}
	return new Response(new Uint8Array(tile.body), {
		headers: {
			"Content-Type": tile.type,
			"Content-Length": String(tile.body.length),
			"Cache-Control": "public, max-age=604800",
			ETag: etag,
			"X-Content-Type-Options": "nosniff",
		},
	});
}
