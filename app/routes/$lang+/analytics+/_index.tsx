// /:lang/analytics: the D1 Analysis dashboard, one page for the three
// dimensions (D1 build brief v0.2). The URL carries delta.query/1, so every
// view has a shareable link; switching the dimension tab rewrites `dim`.
// Disaster impact reads the Analytics loaders for panels 1 to 4 and 5 to
// 16; the two event dimensions follow in D1 steps 3 and 4.
import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { useLoaderData, useSearchParams } from "react-router";
import { approvalAudienceForBasis } from "~/backend.server/approvalAudience.server";
import { getImpactPanels1to4 } from "~/backend.server/models/analytics/dashboard/impactPanels.server";
import {
	getImpactMap,
	getImpactPanels5to16,
} from "~/backend.server/models/analytics/dashboard/impactPanels5to16.server";
import { AboutTheData } from "~/frontend/analytics/dashboard/AboutTheData";
import { DashboardDownload } from "~/frontend/analytics/dashboard/DashboardDownload";
import { DashboardShell, dimensionLabel } from "~/frontend/analytics/dashboard/DashboardShell";
import { ImpactMap } from "~/frontend/analytics/dashboard/panels/impact/ImpactMap";
import { impactDashboardPanels } from "~/frontend/analytics/dashboard/panels/impact/impactDashboardPanels";
import type { DashboardPanel } from "~/frontend/analytics/dashboard/types";
import { ViewContext } from "~/frontend/context";
import { basisIncludesProvisional } from "~/utils/approvalBasis";
import { authLoaderPublicOrWithPerm, hasPermission } from "~/utils/auth";
import type { ImpactPanels1to4 } from "~/utils/dashboard/impactPanels";
import type { ImpactMapPayload } from "~/utils/dashboard/impactMap";
import type { ImpactPanels5to16 } from "~/utils/dashboard/impactPanels5to16";
import {
	parseDeltaQuery,
	serializeDeltaQuery,
	type DeltaQuery,
	type QueryDimension,
} from "~/utils/deltaQuery";
import { htmlTitle } from "~/utils/htmlmeta";
import { getCountryAccountsIdFromSession, getCountrySettingsFromSession } from "~/utils/session";

export const loader = authLoaderPublicOrWithPerm("ViewData", async ({ request }: LoaderFunctionArgs) => {
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
	const countryAccountsId = await getCountryAccountsIdFromSession(request);
	if (!countryAccountsId) throw new Response("No instance selected", { status: 400 });
	const settings = await getCountrySettingsFromSession(request);
	const country = (settings?.countryName as string | undefined) ?? "";
	const ctx = {
		countryAccountsId,
		audience,
		tenantName: country || null,
		provisional: basisIncludesProvisional(audience),
	};
	// Only the chosen dimension is read; the others load when their tab opens.
	const impact =
		query.dimension === "disaster_impact"
			? await Promise.all([
					getImpactPanels1to4(query, ctx),
					getImpactPanels5to16(query, ctx),
					getImpactMap(query, ctx),
				])
			: null;
	return {
		query,
		canReview,
		// The page-level CSV is for signed-in readers (ruling D6).
		signedIn: audience !== "public",
		provisional: ctx.provisional,
		country,
		impact: impact?.[0] ?? null,
		impactMore: impact?.[1] ?? null,
		impactMap: impact?.[2] ?? null,
		audience,
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
	const source = `DELTA ${ld.country}`.trim();
	const impact = ld.impact as ImpactPanels1to4 | null;

	const setQuery = (next: DeltaQuery) =>
		setSearchParams(serializeDeltaQuery(next), { preventScrollReset: true });

	const panels = impact
		? impactDashboardPanels(ctx, impact, source, {
				data: ld.impactMore as ImpactPanels5to16,
				country: ld.country,
			})
		: inBuild(ctx, query.dimension);
	// Until the shared filter bar arrives, the line names the place and basis.
	const summary =
		impact?.scopeText ??
		[ld.country, ld.provisional ? ctx.t({ code: "dashboard.basis_provisional", msg: "Basis: provisional" }) : ctx.t({ code: "dashboard.basis_published", msg: "Basis: published" })]
			.filter(Boolean)
			.join(" · ");

	return (
		<div className="mg-container py-4">
			<DashboardShell
				ctx={ctx}
				dimension={query.dimension}
				onDimensionChange={(dimension) => setQuery({ ...query, dimension })}
				summary={summary}
				provisional={ld.provisional}
				map={
					ld.impactMap ? (
						<ImpactMap
							ctx={ctx}
							map={ld.impactMap as ImpactMapPayload}
							scope={{
								tenant: ld.country || null,
								fromDate: query.where.time?.from ?? null,
								toDate: query.where.time?.to ?? null,
								audience: ld.audience,
								provisional: ld.provisional,
							}}
						/>
					) : undefined
				}
				panels={panels}
				download={
					ld.signedIn && impact ? (
						<DashboardDownload
							ctx={ctx}
							title={`${ctx.t({ code: "dashboard.title", msg: "Analysis" })}: ${dimensionLabel(ctx, query.dimension)}`}
							scopeLine={summary}
							source={source}
							basis={ld.provisional ? "provisional" : "published"}
							panels={panels}
						/>
					) : undefined
				}
				about={
					<AboutTheData
						ctx={ctx}
						country={ld.country}
						dimension={query.dimension}
						provisional={ld.provisional}
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
