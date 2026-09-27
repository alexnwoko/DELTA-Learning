// Review queue for records whose source values were flagged as implausible
// during migration (solution pack C30). Values are never changed here: the
// national focal point reviews each record and corrects it through the normal
// record screens if needed.
import { useMemo, useState } from "react";
import { useLoaderData } from "react-router";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Dropdown } from "primereact/dropdown";
import { Paginator } from "primereact/paginator";
import { Tag } from "primereact/tag";

import { MainContainer } from "~/frontend/container";
import { ViewContext } from "~/frontend/context";
import { LangLink } from "~/utils/link";
import { authLoaderWithPerm } from "~/utils/auth";
import { getCountryAccountsIdFromSession } from "~/utils/session";
import {
	getPlausibilityReviewQueue,
	type PlausibilityReviewItem,
} from "~/backend.server/models/analytics/plausibilityReview";
import type { PlausibilityMeasure } from "~/utils/plausibility";

export const loader = authLoaderWithPerm("ViewData", async (loaderArgs) => {
	const countryAccountsId = await getCountryAccountsIdFromSession(
		loaderArgs.request,
	);
	if (!countryAccountsId) {
		throw new Response("Unauthorized", { status: 401 });
	}
	const items = await getPlausibilityReviewQueue(countryAccountsId);
	return { items };
});

const ALL = "__all__";

export default function PlausibilityReviewPage() {
	const { items } = useLoaderData<typeof loader>();
	const ctx = new ViewContext();

	const codeLabel = (code: string) => {
		switch (code) {
			case "IMPLAUSIBLE_MAGNITUDE":
				return ctx.t({
					code: "plausibility.code.implausible_magnitude",
					msg: "Value above a plausible magnitude",
				});
			case "IDENTICAL_ACROSS_FIELDS":
				return ctx.t({
					code: "plausibility.code.identical_across_fields",
					msg: "Same value in unrelated fields",
				});
			case "HAZARD_EFFECT_MISMATCH":
				return ctx.t({
					code: "plausibility.code.hazard_effect_mismatch",
					msg: "Effect implausible for the hazard",
				});
			case "SENTINEL_MAGNITUDE":
				return ctx.t({
					code: "plausibility.code.sentinel_magnitude",
					msg: "Placeholder or sentinel value",
				});
			default:
				return code;
		}
	};

	const measureLabel = (m: PlausibilityMeasure) => {
		switch (m) {
			case "deaths":
				return ctx.t({ code: "plausibility.measure.deaths", msg: "Deaths" });
			case "injured":
				return ctx.t({ code: "plausibility.measure.injured", msg: "Injured" });
			case "missing":
				return ctx.t({ code: "plausibility.measure.missing", msg: "Missing" });
			case "displaced":
				return ctx.t({
					code: "plausibility.measure.displaced",
					msg: "Displaced",
				});
			case "affected_direct":
				return ctx.t({
					code: "plausibility.measure.affected_direct",
					msg: "Affected (direct)",
				});
			case "affected_indirect":
				return ctx.t({
					code: "plausibility.measure.affected_indirect",
					msg: "Affected (indirect)",
				});
			case "houses_destroyed":
				return ctx.t({
					code: "plausibility.measure.houses_destroyed",
					msg: "Houses destroyed",
				});
			case "houses_damaged":
				return ctx.t({
					code: "plausibility.measure.houses_damaged",
					msg: "Houses damaged",
				});
		}
	};

	const [codeFilter, setCodeFilter] = useState<string>(ALL);
	const [measureFilter, setMeasureFilter] = useState<string>(ALL);
	const [first, setFirst] = useState(0);
	const [rows, setRows] = useState(20);

	const codeCounts = useMemo(() => {
		const c = new Map<string, number>();
		for (const it of items) {
			for (const code of new Set(it.flags.map((f) => f.code))) {
				c.set(code, (c.get(code) ?? 0) + 1);
			}
		}
		return [...c.entries()].sort((a, b) => b[1] - a[1]);
	}, [items]);

	const measureCounts = useMemo(() => {
		const c = new Map<PlausibilityMeasure, number>();
		for (const it of items) {
			for (const m of it.measures) c.set(m, (c.get(m) ?? 0) + 1);
		}
		return [...c.entries()].sort((a, b) => b[1] - a[1]);
	}, [items]);

	const filtered = useMemo(
		() =>
			items.filter(
				(it) =>
					(codeFilter === ALL || it.flags.some((f) => f.code === codeFilter)) &&
					(measureFilter === ALL ||
						it.measures.includes(measureFilter as PlausibilityMeasure)),
			),
		[items, codeFilter, measureFilter],
	);
	const page = filtered.slice(first, first + rows);

	const headerClass =
		"bg-gray-100 px-2 py-3 text-left font-medium border-b border-gray-200";
	const bodyClass = "px-2 py-3 border-b border-gray-200 align-top";

	return (
		<MainContainer
			title={ctx.t({
				code: "plausibility.title",
				msg: "Data quality review",
			})}
		>
			<>
				<p className="mb-4 max-w-3xl">
					{ctx.t({
						code: "plausibility.intro",
						msg: "These records carry source values that look implausible, for example the same large number in two unrelated fields. The values have not been changed. Figures that include them are marked 'flagged for review'. Check each record against its source and correct it through the record screens where needed.",
					})}
				</p>

				<div className="mb-4 flex flex-wrap items-end gap-4">
					<div>
						<label className="mb-1 block text-sm font-medium" htmlFor="pr-code">
							{ctx.t({ code: "plausibility.filter.flag", msg: "Flag type" })}
						</label>
						<Dropdown
							inputId="pr-code"
							value={codeFilter}
							onChange={(e) => {
								setCodeFilter(e.value);
								setFirst(0);
							}}
							options={[
								{
									label: ctx.t({ code: "common.all", msg: "All" }),
									value: ALL,
								},
								...codeCounts.map(([code, n]) => ({
									label: `${codeLabel(code)} (${n})`,
									value: code,
								})),
							]}
						/>
					</div>
					<div>
						<label
							className="mb-1 block text-sm font-medium"
							htmlFor="pr-measure"
						>
							{ctx.t({
								code: "plausibility.filter.figure",
								msg: "Figure affected",
							})}
						</label>
						<Dropdown
							inputId="pr-measure"
							value={measureFilter}
							onChange={(e) => {
								setMeasureFilter(e.value);
								setFirst(0);
							}}
							options={[
								{
									label: ctx.t({ code: "common.all", msg: "All" }),
									value: ALL,
								},
								...measureCounts.map(([m, n]) => ({
									label: `${measureLabel(m)} (${n})`,
									value: m,
								})),
							]}
						/>
					</div>
					<p className="text-sm" aria-live="polite">
						{ctx.t(
							{
								code: "plausibility.count",
								msg: "{shown} of {total} flagged records",
							},
							{ shown: filtered.length, total: items.length },
						)}
					</p>
				</div>

				<section className="w-full overflow-x-auto [&_.p-datatable-wrapper]:overflow-visible">
					<DataTable
						value={page}
						dataKey="recordId"
						className="w-full"
						tableClassName="!table min-w-[720px] border-collapse text-sm md:text-base"
						emptyMessage={ctx.t({
							code: "plausibility.empty",
							msg: "No record in this instance carries a plausibility flag.",
						})}
					>
						<Column
							header={ctx.t({ code: "plausibility.col.record", msg: "Record" })}
							body={(it: PlausibilityReviewItem) => (
								<LangLink
									lang={ctx.lang}
									to={`/disaster-record/${it.recordId}`}
								>
									{it.apiImportId ?? it.recordId.slice(0, 8)}
								</LangLink>
							)}
							headerClassName={headerClass}
							bodyClassName={bodyClass}
						/>
						<Column
							header={ctx.t({ code: "plausibility.col.date", msg: "Date" })}
							body={(it: PlausibilityReviewItem) => it.startDate ?? "-"}
							headerClassName={headerClass}
							bodyClassName={bodyClass}
						/>
						<Column
							header={ctx.t({
								code: "plausibility.col.location",
								msg: "Location",
							})}
							body={(it: PlausibilityReviewItem) => it.locationDesc ?? "-"}
							headerClassName={headerClass}
							bodyClassName={bodyClass}
						/>
						<Column
							header={ctx.t({ code: "plausibility.col.status", msg: "Status" })}
							body={(it: PlausibilityReviewItem) => it.approvalStatus}
							headerClassName={headerClass}
							bodyClassName={bodyClass}
						/>
						<Column
							header={ctx.t({ code: "plausibility.col.flags", msg: "Flags" })}
							body={(it: PlausibilityReviewItem) => (
								<ul className="m-0 list-none p-0">
									{it.flags.map((f, i) => (
										<li key={i} className="mb-1">
											<strong>{codeLabel(f.code)}</strong>
											{f.fields.length > 0 && (
												<span className="text-gray-700">
													{" "}
													({f.fields.join(", ")})
												</span>
											)}
											{f.note && (
												<span className="block text-gray-700">{f.note}</span>
											)}
										</li>
									))}
								</ul>
							)}
							headerClassName={headerClass}
							bodyClassName={bodyClass}
						/>
						<Column
							header={ctx.t({
								code: "plausibility.col.figures",
								msg: "Figures affected",
							})}
							body={(it: PlausibilityReviewItem) =>
								it.measures.length ? (
									<span className="flex flex-wrap gap-1">
										{it.measures.map((m) => (
											<Tag key={m} value={measureLabel(m)} severity="warning" />
										))}
									</span>
								) : (
									<span className="text-gray-700">
										{ctx.t({
											code: "plausibility.no_people_figure",
											msg: "No people or housing figure",
										})}
									</span>
								)
							}
							headerClassName={headerClass}
							bodyClassName={bodyClass}
						/>
					</DataTable>
					{filtered.length > rows && (
						<Paginator
							first={first}
							rows={rows}
							totalRecords={filtered.length}
							rowsPerPageOptions={[20, 50, 100]}
							onPageChange={(e) => {
								setFirst(e.first);
								setRows(e.rows);
							}}
							className="mt-4 !justify-end"
						/>
					)}
				</section>
			</>
		</MainContainer>
	);
}
