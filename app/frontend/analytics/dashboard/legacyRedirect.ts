// The three old analysis pages now live on the one Analysis dashboard
// (Alex, 2026-10-17). Each old route redirects there, keeping the filters
// its link carried, so bookmarks and shared links keep working.
import { redirect, type LoaderFunctionArgs } from "react-router";
import { legacyAnalyticsTarget } from "./views";

export function legacyAnalyticsLoader(page: "sectors" | "hazards" | "disaster-events") {
	return ({ request, params }: LoaderFunctionArgs) => {
		const url = new URL(request.url);
		const target = legacyAnalyticsTarget(page, url.searchParams) ?? "/analytics";
		// 301: the page moved for good; the language prefix stays.
		return redirect(`/${params.lang ?? "en"}${target}`, 301);
	};
}
