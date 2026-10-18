import type { LoaderFunctionArgs } from "react-router";
import { translationsScript } from "~/backend.server/translationsScript.server";
import { getLanguage } from "~/utils/lang.backend";

// The translation dictionary for one language, as a script the root page
// loads in its head. Public: interface strings only, no tenant data. The
// versioned URL (?v=<hash>) is cached for a year; any other URL is
// revalidated, so a changed string reaches readers on their next page.
export async function loader({ params, request }: LoaderFunctionArgs) {
	const lang = getLanguage({ params }); // 404 for an unknown language
	const { body, version } = translationsScript(lang);
	const etag = `"${version}"`;
	const pinned = new URL(request.url).searchParams.get("v") === version;
	const headers = {
		"Content-Type": "text/javascript; charset=utf-8",
		"Cache-Control": pinned ? "public, max-age=31536000, immutable" : "no-cache",
		ETag: etag,
		"X-Content-Type-Options": "nosniff",
	};
	if (request.headers.get("If-None-Match") === etag) {
		return new Response(null, { status: 304, headers });
	}
	return new Response(body, { headers });
}
