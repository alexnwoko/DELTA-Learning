// /:lang/analytics: the D1 Analysis dashboard, one page for the three
// dimensions (D1 build brief v0.2). The URL carries delta.query/1, so every
// view has a shareable link; switching the dimension tab rewrites `dim`.
//
// Until the Analytics loader (getImpactPanels1to4) and the shared filter
// bar (GeoFilterBar) reach this branch, the page draws the labelled example
// payload, and only outside production: invented figures never reach a
// live instance.
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData, useSearchParams } from "react-router";
import { approvalAudienceForBasis } from "~/backend.server/approvalAudience.server";
import { AboutTheData } from "~/frontend/analytics/dashboard/AboutTheData";
import { DashboardDownload } from "~/frontend/analytics/dashboard/DashboardDownload";
import { DashboardShell, dimensionLabel } from "~/frontend/analytics/dashboard/DashboardShell";
import { impactDashboardPanels } from "~/frontend/analytics/dashboard/panels/impact/impactDashboardPanels";
import type { DashboardPanel } from "~/frontend/analytics/dashboard/types";
import { ViewContext } from "~/frontend/context";
import { authLoaderPublicOrWithPerm, hasPermission } from "~/utils/auth";
import { IMPACT_PANELS_FIXTURE } from "~/utils/dashboard/impactPanels";
import {
	parseDeltaQuery,
	serializeDeltaQuery,
	type DeltaQuery,
	type QueryDimension,
} from "~/utils/deltaQuery";
import { htmlTitle } from "~/utils/htmlmeta";

export const loader = authLoaderPublicOrWithPerm("ViewData", async ({ request }: LoaderFunctionArgs) => {
	if (process.env.NODE_ENV === "production") {
		throw new Response("Not found", { status: 404 });
	}
	const { query, issues } = parseDeltaQuery(new URL(request.url).searchParams);
	// A filter that cannot be applied is refused, never silently dropped.
	if (issues.length > 0) {
		throw new Response(JSON.stringify({ refused: issues }), {
			status: 422,
			headers: { "Content-Type": "application/json" },
		});
	}
	// 403 for the provisional basis without ValidateData (AB-01, D7).
	const audience = await approvalAudienceForBasis(request, query.scope.basis);
	const canReview = audience !== "public" && (await hasPermission(request, "ValidateData"));
	return {
		query,
		canReview,
		// The page-level CSV is for signed-in readers (ruling D6).
		signedIn: audience !== "public",
		example: true,
		impact: { ...IMPACT_PANELS_FIXTURE, query },
		country: "Example country",
	};
});

/** Panels for a dimension whose set is still being built (D1 steps 3 and 4). */
function inBuild(ctx: ViewContext, dimension: QueryDimension): DashboardPanel[] {
	return [
		{
			id: `${dimension}-in-build`,
			n: 1,
			title: dimensionLabel(ctx, dimension),
			gap: {
				code: dimension === "disaster_event" ? "D1 step 3" : "D1 step 4",
				text: ctx.t({
					code: "dashboard.dimension_in_build",
					msg: "The panels for this dimension are being built.",
				}),
			},
		},
	];
}

export default function AnalysisDashboard() {
	const ld = useLoaderData<typeof loader>();
	const ctx = new ViewContext();
	const [, setSearchParams] = useSearchParams();
	const query = ld.query as DeltaQuery;
	const source = ld.example ? "EXAMPLE DATA" : `DELTA ${ld.country}`;

	const setQuery = (next: DeltaQuery) =>
		setSearchParams(serializeDeltaQuery(next), { preventScrollReset: true });

	const panels =
		query.dimension === "disaster_impact"
			? impactDashboardPanels(ctx, ld.impact as typeof IMPACT_PANELS_FIXTURE, source)
			: inBuild(ctx, query.dimension);

	return (
		<div className="mg-container py-4">
			<DashboardShell
				ctx={ctx}
				dimension={query.dimension}
				onDimensionChange={(dimension) => setQuery({ ...query, dimension })}
				summary={ld.impact.scopeText}
				provisional={query.scope.basis === "provisional"}
				panels={panels}
				download={
					ld.signedIn ? (
						<DashboardDownload
							ctx={ctx}
							title={`${ctx.t({ code: "dashboard.title", msg: "Analysis" })}: ${dimensionLabel(ctx, query.dimension)}`}
							scopeLine={ld.impact.scopeText}
							source={source}
							basis={query.scope.basis}
							panels={panels}
						/>
					) : undefined
				}
				about={
					<AboutTheData
						ctx={ctx}
						country={ld.country}
						dimension={query.dimension}
						provisional={query.scope.basis === "provisional"}
					/>
				}
			/>
		</div>
	);
}

export const meta: MetaFunction = ({ params }) => {
	const ctx = new ViewContext({ lang: params.lang || "en" });
	const title = ctx.t({ code: "meta.analysis_dashboard", msg: "Analysis" });
	return [{ title: htmlTitle(ctx, title) }, { name: "description", content: title }];
};
