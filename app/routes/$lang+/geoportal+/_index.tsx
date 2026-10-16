// Geoportal map page (increment I-2): the three dimensions as filters, one
// measure per map, the table alternative, and the place dossier for the
// selected area. The loader resolves the request exactly as the geo API does
// (resolveGeoRequest), so the page and the API never disagree. Signed-in
// only until the public routes (TR-181, TR-236) land in R1.
import { useEffect, useMemo, useState } from "react";
import { useLoaderData, useNavigate, useParams } from "react-router";
import { sql } from "drizzle-orm";

import { dr } from "~/db.server";
import { MainContainer } from "~/frontend/container";
import { ViewContext } from "~/frontend/context";
import { ClientOnly } from "~/frontend/analytics/sectors/sections/ClientOnly";
import { GeoMap } from "~/frontend/geoportal/GeoMap";
import { GeoLegend } from "~/frontend/geoportal/GeoLegend";
import { GeoTable, type GeoTableRow } from "~/frontend/geoportal/GeoTable";
import {
	GeoFilterBar,
	MEASURE_LABELS,
} from "~/frontend/geoportal/GeoFilterBar";
import { measureFamily, toMapCell } from "~/frontend/geoportal/geoCells";
import {
	GeoRefusalWithMeta,
	resolveGeoRequest,
} from "~/backend.server/handlers/geo";
import {
	getBoundaries,
	getChoropleth,
	refusalBody,
} from "~/backend.server/models/geo/queries";
import { authLoaderWithPerm, hasPermission } from "~/utils/auth";
import { getCountryAccountsIdFromSession } from "~/utils/session";
import { serializeDeltaQuery, type DeltaQuery } from "~/utils/deltaQuery";
import { resolveMapState } from "~/utils/mapState";

async function adminLevels(countryAccountsId: string): Promise<number[]> {
	const res = await dr.execute(sql`
		SELECT DISTINCT admin_level FROM geo.division_geom_cache
		WHERE country_accounts_id = ${countryAccountsId} AND geom_z8 IS NOT NULL
		ORDER BY admin_level
	`);
	return (res.rows as { admin_level: number }[]).map((r) =>
		Number(r.admin_level),
	);
}

export const loader = authLoaderWithPerm("ViewData", async (args) => {
	const countryAccountsId = await getCountryAccountsIdFromSession(args.request);
	if (!countryAccountsId) {
		throw new Response("Unauthorized", { status: 401 });
	}
	const lang = args.params.lang || "en";
	const url = new URL(args.request.url);
	const levels = await adminLevels(countryAccountsId);
	// Roll-ups start at level 1, never at a level-0 country outline.
	const defaultLevel = levels.find((l) => l >= 1) ?? levels[0] ?? 1;
	if (!url.searchParams.get("level")) {
		url.searchParams.set("level", String(defaultLevel));
	}
	const dim = url.searchParams.get("dim") ?? "disaster_impact";
	if (!url.searchParams.get("measure") && dim === "disaster_impact") {
		url.searchParams.set("measure", "records");
	}
	const canReview = await hasPermission(args.request, "ValidateData");

	try {
		const req = await resolveGeoRequest(
			{
				countryAccountsId,
				lang,
				url,
				request: args.request,
				viaApiKey: false,
			},
			{ requireMeasure: true, requireLevel: true, eventDimensions: true },
		);
		const [choropleth, boundaries] = await Promise.all([
			getChoropleth(countryAccountsId, req),
			getBoundaries(countryAccountsId, {
				level: req.level as number,
				z: 8,
				lang,
			}),
		]);
		return {
			query: req.query,
			level: req.level as number,
			levels,
			canReview,
			choropleth,
			boundaries: boundaries as {
				features: { properties: { divisionId: string; name: string } }[];
			},
			refusal: null,
		};
	} catch (err) {
		if (err instanceof GeoRefusalWithMeta) {
			return {
				query: err.meta.query,
				level: Number(url.searchParams.get("level")),
				levels,
				canReview,
				choropleth: null,
				boundaries: null,
				refusal: refusalBody(err.refusal, err.meta),
			};
		}
		throw err;
	}
});

interface DossierSummary {
	division: { name: string | null };
	recurrence: {
		recordCount: number;
		firstYear: number | null;
		lastYear: number | null;
		periodsWithNoReporting: string[];
		note: string;
	};
	cumulative: Record<string, { value: number | null; value_state: string }>;
}

export default function GeoportalPage() {
	const data = useLoaderData<typeof loader>();
	const ctx = new ViewContext();
	const navigate = useNavigate();
	const params = useParams();
	const lang = params.lang || "en";
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const [dossier, setDossier] = useState<DossierSummary | null>(null);

	const query = data.query as DeltaQuery;
	const choropleth = data.choropleth;
	const measure = query.measure ?? "records";

	const mapState = useMemo(() => {
		if (!choropleth) return null;
		return resolveMapState(choropleth.cells.map(toMapCell), {
			family: measureFamily(measure),
			scope: {
				tenant: null,
				fromDate: query.where.time?.from ?? null,
				toDate: query.where.time?.to ?? null,
				hazard: null,
				audience:
					query.scope.basis === "provisional"
						? "reviewer-provisional"
						: "signed-in",
				provisional: choropleth.meta.provisional,
			},
			notApplied: choropleth.meta.notApplied,
		});
	}, [choropleth, measure, query]);

	const rows: GeoTableRow[] = useMemo(() => {
		if (!data.boundaries || !mapState) return [];
		const byId = new Map(mapState.areas.map((a) => [a.areaId, a]));
		return data.boundaries.features
			.map((f) => ({
				id: f.properties.divisionId,
				name: f.properties.name,
				area: byId.get(f.properties.divisionId),
			}))
			.sort((a, b) => a.name.localeCompare(b.name));
	}, [data.boundaries, mapState]);

	const noRecordsAreas = rows.filter((r) => !r.area).length;

	const search = useMemo(() => {
		const p = serializeDeltaQuery(query);
		p.set("level", String(data.level));
		return p;
	}, [query, data.level]);

	useEffect(() => {
		setDossier(null);
		if (!selectedId) return;
		let live = true;
		fetch(`/${lang}/api/geo/place/${selectedId}/dossier?${search}`)
			.then((r) => (r.ok ? r.json() : null))
			.then((d) => live && setDossier(d))
			.catch(() => live && setDossier(null));
		return () => {
			live = false;
		};
	}, [selectedId, search, lang]);

	const onFilters = (next: { query: DeltaQuery; level: number }) => {
		const p = serializeDeltaQuery(next.query);
		p.set("level", String(next.level));
		setSelectedId(null);
		navigate(`?${p.toString()}`);
	};

	const title = ctx.t({ code: "geoportal.title", msg: "Geoportal" });
	const tableId = "geoportal-table";

	return (
		<MainContainer title={title}>
			<GeoFilterBar
				query={query}
				level={data.level}
				levels={data.levels}
				canReview={data.canReview}
				onChange={onFilters}
			/>

			{data.refusal && (
				<div
					role="alert"
					className="border-l-4 border-amber-600 bg-amber-50 p-3 my-2"
				>
					<p className="font-semibold">{data.refusal.error.message}</p>
					<p className="text-sm">{data.refusal.error.resolution}</p>
				</div>
			)}

			{choropleth && mapState && (
				<>
					<p className="text-sm text-gray-700 my-1">{mapState.scope.text}</p>
					{mapState.notApplied.map((n) => (
						<p
							key={n.filter}
							className="text-sm border-l-4 border-gray-400 bg-gray-50 px-2 py-1 my-1"
						>
							{n.text}
						</p>
					))}
					{choropleth.meta.provisional && (
						<p className="text-sm border-l-4 border-amber-600 bg-amber-50 px-2 py-1 my-1">
							{ctx.t({
								code: "geoportal.provisional",
								msg: "Provisional: these figures include records that are not yet published.",
							})}
						</p>
					)}
					{choropleth.cells.length === 0 &&
						choropleth.unattributed.records === 0 && (
							<p className="text-sm border-l-4 border-gray-400 bg-gray-50 px-2 py-1 my-1">
								{query.scope.basis === "provisional"
									? ctx.t({
											code: "geoportal.empty.scope",
											msg: "Nothing in scope for this dimension and these filters.",
										})
									: ctx.t({
											code: "geoportal.empty",
											msg: "No records on this approval basis. Migrated records stay drafts until they are published.",
										})}
							</p>
						)}

					<div className="flex flex-wrap gap-4 my-3">
						<div className="flex-1 min-w-[320px]">
							<ClientOnly fallback={<div style={{ height: 480 }} />}>
								{() => (
									<GeoMap
										boundaries={data.boundaries ?? { features: [] }}
										areas={mapState.areas}
										selectedId={selectedId}
										onSelect={setSelectedId}
										label={`${MEASURE_LABELS[measure] ?? measure}: map`}
										describedBy={tableId}
									/>
								)}
							</ClientOnly>
							<p className="text-xs text-gray-600 mt-1">{choropleth.caption}</p>
						</div>
						<aside className="w-72 space-y-4">
							<GeoLegend
								legend={mapState.legend}
								title={MEASURE_LABELS[measure] ?? measure}
								noRecordsAreas={noRecordsAreas}
							/>
							{choropleth.unattributed.records > 0 && (
								<section className="text-sm">
									<h3 className="font-semibold">
										{ctx.t({
											code: "geoportal.unattributed",
											msg: "Not placed on the map",
										})}
									</h3>
									<p>
										{choropleth.unattributed.records}{" "}
										{ctx.t({
											code: "geoportal.unattributed.note",
											msg: "shown here, never redistributed:",
										})}
									</p>
									<ul>
										{Object.entries(choropleth.unattributed.reasons).map(
											([reason, n]) => (
												<li key={reason}>
													{reason.replaceAll("_", " ")}: {n}
												</li>
											),
										)}
									</ul>
								</section>
							)}
							{dossier && (
								<section aria-live="polite" className="text-sm border-t pt-2">
									<h3 className="font-semibold">{dossier.division.name}</h3>
									<p>
										{dossier.recurrence.recordCount} records
										{dossier.recurrence.firstYear
											? `, ${dossier.recurrence.firstYear} to ${dossier.recurrence.lastYear}`
											: ""}
									</p>
									{dossier.recurrence.periodsWithNoReporting.length > 0 && (
										<p>
											No reporting:{" "}
											{dossier.recurrence.periodsWithNoReporting.join(", ")}
										</p>
									)}
									<ul>
										{Object.entries(dossier.cumulative).map(([m, c]) => (
											<li key={m}>
												{MEASURE_LABELS[m] ?? m}:{" "}
												{c.value === null
													? c.value_state.replaceAll("_", " ")
													: c.value.toLocaleString()}
											</li>
										))}
									</ul>
									<p className="text-xs text-gray-600">
										{dossier.recurrence.note}
									</p>
								</section>
							)}
						</aside>
					</div>

					<GeoTable
						id={tableId}
						label={`${MEASURE_LABELS[measure] ?? measure}: table`}
						rows={rows}
						selectedId={selectedId}
						onSelect={setSelectedId}
					/>
				</>
			)}
		</MainContainer>
	);
}
