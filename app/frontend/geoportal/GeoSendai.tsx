// Sendai Framework block of the place panel (Geoportal I-5). It shows the
// inputs to Targets A and B that DELTA records hold for the selected place,
// each in its own value state and never added; Target C is refused while the
// money conventions are open; Target D waits for disruption data. Charts by
// year, by hazard and for completeness live in the one Analysis dashboard:
// the link carries the same delta.query/1 there (no second chart stack).
import { fmt, plainT, type GeoT } from "~/frontend/geoportal/i18n";
import { cellText, type DossierCell } from "~/frontend/geoportal/GeoDossier";

type Row = { key: string; label: string; cell: DossierCell | undefined };

export type GeoSendaiRate = {
	value: number | null;
	valueState: string;
	refusal: { code: string; reason: string } | null;
};
export type GeoSendaiRates = {
	year: number;
	a1: GeoSendaiRate;
	affectedDirect: GeoSendaiRate;
	denominator: { value: number; source: string; release: string; year: number } | null;
};

export function GeoSendai(props: {
	cumulative: Record<string, DossierCell>;
	/** Admin level of the place; above 0 the figures are sub-national (TR-060). */
	level: number;
	/** Link to the Analysis dashboard with the same filters and place. */
	analysisHref: string;
	/** When the page is filtered to a region: the same link for the whole region. */
	region?: { name: string; href: string } | null;
	/** National rates for a one-year period (whole country only). */
	rates?: GeoSendaiRates | null;
	t?: GeoT;
}) {
	const t = props.t ?? plainT;
	const c = props.cumulative;
	const rates = props.rates;
	// Rates: national and annual only. Say why when there is none.
	const rateLine = (r: GeoSendaiRate | undefined, name: string) => {
		if (props.level >= 1) {
			return (
				<p className="text-xs text-brand-text-muted">
					{t({
						code: "geoportal.sendai.rate_subnational",
						msg: "Rates per 100,000 are national: sub-national population is not loaded.",
					})}
				</p>
			);
		}
		if (!rates || !r) {
			return (
				<p className="text-xs text-brand-text-muted">
					{t({
						code: "geoportal.sendai.rate_one_year",
						msg: "Rates per 100,000 are annual: set From and To to the same year to see them.",
					})}
				</p>
			);
		}
		return (
			<p className="text-xs">
				{name}, {rates.year}:{" "}
				<span className="tabular-nums font-semibold">
					{r.value !== null
						? r.value.toLocaleString(undefined, { maximumFractionDigits: 2 })
						: r.refusal
							? t({
									code: "geoportal.sendai.rate_refused",
									msg: "not formed ({reason})",
								},
								{ reason: r.refusal.code })
							: cellText(undefined, t)}
				</span>
				{rates.denominator && (
					<span className="block text-brand-text-muted">
						{t(
							{
								code: "geoportal.sendai.population",
								msg: "Population {value} ({source}, {release}).",
							},
							{
								value: fmt(rates.denominator.value),
								source: rates.denominator.source,
								release: rates.denominator.release,
							},
						)}
					</span>
				)}
			</p>
		);
	};
	const row = (r: Row) => (
		<li key={r.key} className="flex flex-wrap justify-between gap-x-3">
			<span>{r.label}</span>
			<span className="tabular-nums font-semibold">
				{cellText(r.cell, t)}
				{r.cell && r.cell.records_total > 0 && (
					<span className="font-normal text-brand-text-muted">
						{" "}
						{t(
							{
								code: "geoportal.sendai.reported_by",
								msg: "(reported by {n} of {m})",
							},
							{
								n: fmt(r.cell.records_reported),
								m: fmt(r.cell.records_total),
							},
						)}
					</span>
				)}
			</span>
		</li>
	);
	const label = (code: string, msg: string) => t({ code, msg });
	return (
		<section
			aria-labelledby="geo-sendai-h"
			className="geo-sendai border border-brand-border rounded p-2 space-y-2 text-sm"
		>
			<h3 id="geo-sendai-h" className="text-sm font-semibold">
				{label("geoportal.sendai.title", "Sendai Framework targets")}
			</h3>
			<p className="text-xs text-brand-text-muted">
				{label(
					"geoportal.sendai.source",
					"Computed from DELTA records, not the official Sendai Framework submission.",
				)}
				{props.level >= 1 &&
					` ${label(
						"geoportal.legend.not_sendai",
						"Sub-national figures. Not a Sendai indicator value.",
					)}`}
			</p>
			<div>
				<p className="font-semibold">
					{label("geoportal.sendai.a", "Target A: mortality")}
				</p>
				<ul className="space-y-0.5">
					{[
						{
							key: "deaths",
							label: label("geoportal.sendai.deaths", "Deaths (A-2)"),
							cell: c.deaths,
						},
						{
							key: "missing",
							label: label("geoportal.sendai.missing", "Missing (A-3)"),
							cell: c.missing,
						},
					].map(row)}
				</ul>
				{rateLine(
					rates?.a1,
					label("geoportal.sendai.a1", "Deaths and missing per 100,000 (A-1)"),
				)}
				<p className="text-xs text-brand-text-muted">
					{label(
						"geoportal.sendai.a_note",
						"Deaths and missing are shown apart; only the A-1 rate adds them, as the Sendai guidance does.",
					)}
				</p>
			</div>
			<div>
				<p className="font-semibold">
					{label("geoportal.sendai.b", "Target B: people affected")}
				</p>
				<ul className="space-y-0.5">
					{[
						{
							key: "injured",
							label: label("geoportal.sendai.injured", "Injured or ill (B-2)"),
							cell: c.injured,
						},
						{
							key: "houses_damaged",
							label: label(
								"geoportal.sendai.houses_damaged",
								"Dwellings damaged (input to B-3)",
							),
							cell: c.houses_damaged,
						},
						{
							key: "houses_destroyed",
							label: label(
								"geoportal.sendai.houses_destroyed",
								"Dwellings destroyed (input to B-4)",
							),
							cell: c.houses_destroyed,
						},
					].map(row)}
				</ul>
				<p className="text-xs text-brand-text-muted">
					{label(
						"geoportal.sendai.b_note",
						"No B-1 total is formed: it also needs people per household and livelihoods (B-5). Dwelling counts are inputs, not people.",
					)}
				</p>
			</div>
			<div>
				<p className="font-semibold">
					{label("geoportal.sendai.recorded", "Also recorded (no Sendai indicator code)")}
				</p>
				<ul className="space-y-0.5">
					{[
						{
							key: "affected_direct",
							label: label(
								"geoportal.sendai.affected_direct",
								"Directly affected, as recorded",
							),
							cell: c.affected_direct,
						},
						{
							key: "displaced",
							label: label("geoportal.sendai.displaced", "Displaced"),
							cell: c.displaced,
						},
					].map(row)}
				</ul>
				{rateLine(
					rates?.affectedDirect,
					label(
						"geoportal.sendai.affected_rate",
						"Directly affected per 100,000 (DELTA rate, not Sendai B-1)",
					),
				)}
				<p className="text-xs text-brand-text-muted">
					{label(
						"geoportal.sendai.recorded_note",
						"Displaced, evacuated and relocated people are not part of Sendai Target B.",
					)}
				</p>
			</div>
			<div>
				<p className="font-semibold">
					{label("geoportal.sendai.c", "Target C: economic loss")}
				</p>
				<p>
					{label(
						"geoportal.sendai.c_refused",
						"Not shown: money is not totalled until the monetary conventions are ruled (MONETARY_CONVENTIONS_PENDING).",
					)}
				</p>
			</div>
			<div>
				<p className="font-semibold">
					{label("geoportal.sendai.d", "Target D: infrastructure and services")}
				</p>
				<p>
					{label(
						"geoportal.sendai.d_waits",
						"Not shown yet: DELTA holds no service-disruption records to compute it from.",
					)}
				</p>
			</div>
			<a
				href={props.analysisHref}
				className="inline-block underline text-brand-interactive"
			>
				{label(
					"geoportal.sendai.open_analysis",
					"Open this place in Analysis: by year, by hazard and completeness",
				)}
			</a>
			{props.region && (
				<a
					href={props.region.href}
					className="block underline text-brand-interactive"
				>
					{t(
						{
							code: "geoportal.sendai.open_region",
							msg: "Open the region {name} in Analysis",
						},
						{ name: props.region.name },
					)}
				</a>
			)}
		</section>
	);
}
