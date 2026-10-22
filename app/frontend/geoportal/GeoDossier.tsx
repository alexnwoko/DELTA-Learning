// Place dossier (G3, TR-171, review R06): the selected area's headline
// figures with units, its recurrence with silent years shown as gaps, its
// hazard mix and attribution grades. A figure no disaster impact reported
// shows its state name, never 0 (TR-076).
import { STATE_ENCODING } from "~/utils/mapState";
import { dataTokens } from "~/utils/designTokens.generated";
import { GEO_MEASURE_INFO, type GeoHumanMeasure } from "~/utils/geoMeasures";
import {
	boundaryText,
	fmt,
	plainT,
	type GeoT,
} from "~/frontend/geoportal/i18n";

export interface DossierCell {
	value: number | null;
	value_state: string;
	records_reported: number;
	records_total: number;
}

export interface DossierData {
	division: {
		id: string;
		name: string | null;
		level: number;
		parent: { id: string; name: string | null } | null;
	};
	recurrence: {
		recordCount: number;
		firstYear: number | null;
		lastYear: number | null;
		undatedRecordCount: number;
		periodsWithNoReporting: string[];
		gradeDistribution: Record<string, number>;
		note: string;
	};
	hazardMix: { hipTypeId: string | null; recordCount: number }[];
	byYear: { year: number; recordCount: number }[];
	cumulative: Record<string, DossierCell>;
	meta: { boundaryVersion: string; provisional: boolean };
	/** Records per event and event identity (gap review step 4). */
	events?: {
		records: number;
		linkedRecords: number;
		events: number;
		glideEvents: number;
		nationalCodeEvents: number;
		top: {
			id: string;
			name: string | null;
			glide: string | null;
			nationalId: string | null;
			records: number;
		}[];
	};
}

const TILES: GeoHumanMeasure[] = ["deaths", "affected_direct", "displaced"];
const MORE: GeoHumanMeasure[] = ["injured", "missing", "affected_indirect"];

export function cellText(c: DossierCell | undefined, t: GeoT): string {
	if (!c) return STATE_ENCODING.not_reported.label;
	if (c.value === null) {
		const enc = (STATE_ENCODING as Record<string, { label: string }>)[
			c.value_state
		];
		return enc?.label ?? STATE_ENCODING.not_reported.label;
	}
	if (c.value_state === "zero_confirmed") {
		return t({
			code: "geoportal.dossier.zero_confirmed",
			msg: "0 (confirmed)",
		});
	}
	return fmt(c.value);
}

/** Year strip: one bar per year, silent years hatched as no reporting. */
export function YearStrip(props: {
	byYear: { year: number; recordCount: number }[];
	firstYear: number;
	lastYear: number;
	label: string;
}) {
	const counts = new Map(props.byYear.map((b) => [b.year, b.recordCount]));
	const years: number[] = [];
	for (let y = props.firstYear; y <= props.lastYear; y++) years.push(y);
	const max = Math.max(1, ...props.byYear.map((b) => b.recordCount));
	const w = 6;
	const h = 32;
	return (
		<svg
			role="img"
			aria-label={props.label}
			width={Math.max(years.length * w, 40)}
			height={h + 2}
			className="block max-w-full"
			preserveAspectRatio="none"
			viewBox={`0 0 ${Math.max(years.length * w, 40)} ${h + 2}`}
		>
			<defs>
				<pattern
					id="geo-gap"
					width="4"
					height="4"
					patternUnits="userSpaceOnUse"
				>
					<path
						d="M0,4 L4,0"
						stroke={dataTokens.state.notReported.stroke}
						strokeWidth="1"
					/>
				</pattern>
			</defs>
			{years.map((y, i) => {
				const n = counts.get(y);
				if (n === undefined) {
					return (
						<rect
							key={y}
							x={i * w}
							y={0}
							width={w - 1}
							height={h}
							fill="url(#geo-gap)"
						>
							<title>{`${y}`}</title>
						</rect>
					);
				}
				const bh = Math.max(2, (n / max) * h);
				return (
					<rect
						key={y}
						x={i * w}
						y={h - bh}
						width={w - 1}
						height={bh}
						fill={dataTokens.ramp.events[3]}
					>
						<title>{`${y}: ${fmt(n)}`}</title>
					</rect>
				);
			})}
			<line
				x1={0}
				x2={years.length * w}
				y1={h + 1}
				y2={h + 1}
				stroke={dataTokens.chart.axis}
			/>
		</svg>
	);
}

export function GeoDossier(props: {
	data: DossierData;
	/** Names of hazard types, by id, from the hazard tree. */
	hazardTypeNames: Record<string, string>;
	/** Shown above the name when the page chose the area itself. */
	autoNote?: string | null;
	onSelectParent?: (id: string) => void;
	t?: GeoT;
}) {
	const t = props.t ?? plainT;
	const { division, recurrence, cumulative } = props.data;
	const ev = props.data.events;
	const tile = (label: string, unit: string, text: string) => (
		<div className="border border-brand-border rounded p-2 min-w-0">
			<p className="text-xs text-brand-text-muted">
				{label} <span className="text-brand-text-muted">[{unit}]</span>
			</p>
			<p className="text-lg font-semibold tabular-nums leading-tight">{text}</p>
		</div>
	);
	const grades = Object.entries(recurrence.gradeDistribution)
		.filter(([, n]) => Number(n) > 0)
		.map(([g, n]) => `${g} ${fmt(Number(n))}`)
		.join(", ");
	const gapText =
		recurrence.periodsWithNoReporting.length > 0
			? t(
					{
						code: "geoportal.dossier.no_reporting",
						msg: "No reporting: {periods}",
					},
					{ periods: recurrence.periodsWithNoReporting.join(", ") },
				)
			: null;
	return (
		<section
			aria-live="polite"
			aria-label={division.name ?? ""}
			className="geo-dossier text-sm space-y-3"
		>
			<header>
				{props.autoNote && (
					<p className="text-xs text-brand-text-muted">{props.autoNote}</p>
				)}
				<h2 className="text-lg font-semibold leading-tight">{division.name}</h2>
				<p className="text-xs text-brand-text-muted">
					{division.id === "country"
						? t({
								code: "geoportal.dossier.whole_country",
								msg: "Whole country",
							})
						: t(
								{ code: "geoportal.dossier.level", msg: "Admin level {n}" },
								{ n: division.level },
							)}
					{division.parent && (
						<>
							{" · "}
							{t({ code: "geoportal.dossier.in", msg: "in" })}{" "}
							{props.onSelectParent ? (
								<button
									type="button"
									className="underline text-brand-interactive"
									onClick={() => props.onSelectParent?.(division.parent!.id)}
								>
									{division.parent.name}
								</button>
							) : (
								division.parent.name
							)}
						</>
					)}
				</p>
				<p className="text-xs text-brand-text-muted">
					{boundaryText(props.data.meta.boundaryVersion, t)}
				</p>
			</header>

			<div className="grid grid-cols-2 gap-2">
				{tile(
					t({ code: "geoportal.dossier.impacts", msg: "Disaster impacts" }),
					t({ code: "geoportal.unit.count", msg: "count" }),
					fmt(recurrence.recordCount),
				)}
				{TILES.map((m) => (
					<div key={m}>
						{tile(
							t(GEO_MEASURE_INFO[m].label),
							t(GEO_MEASURE_INFO[m].unit),
							cellText(cumulative[m], t),
						)}
					</div>
				))}
			</div>
			<ul className="text-xs text-brand-text">
				{MORE.map((m) => (
					<li key={m}>
						{t(GEO_MEASURE_INFO[m].label)}: {cellText(cumulative[m], t)}
					</li>
				))}
			</ul>

			<div>
				<h3 className="font-semibold">
					{t({ code: "geoportal.dossier.recurrence", msg: "Over time" })}
				</h3>
				{recurrence.firstYear !== null && recurrence.lastYear !== null ? (
					<>
						<p className="text-xs text-brand-text-muted">
							{t(
								{ code: "geoportal.dossier.span", msg: "{first} to {last}" },
								{ first: recurrence.firstYear, last: recurrence.lastYear },
							)}
						</p>
						<YearStrip
							byYear={props.data.byYear}
							firstYear={recurrence.firstYear}
							lastYear={recurrence.lastYear}
							label={[
								t(
									{
										code: "geoportal.dossier.strip_label",
										msg: "Disaster impacts by year, {first} to {last}",
									},
									{ first: recurrence.firstYear, last: recurrence.lastYear },
								),
								gapText,
							]
								.filter(Boolean)
								.join(". ")}
						/>
						{gapText && (
							<p className="text-xs text-brand-text-muted">{gapText}</p>
						)}
					</>
				) : (
					<p className="text-xs text-brand-text-muted">
						{t({
							code: "geoportal.dossier.no_dates",
							msg: "No dated disaster impacts.",
						})}
					</p>
				)}
				{recurrence.undatedRecordCount > 0 && (
					<p className="text-xs text-brand-text-muted">
						{t(
							{ code: "geoportal.dossier.undated", msg: "{n} without a date" },
							{ n: fmt(recurrence.undatedRecordCount) },
						)}
					</p>
				)}
			</div>

			{props.data.hazardMix.length > 0 && (
				<div>
					<h3 className="font-semibold">
						{t({ code: "geoportal.dossier.hazards", msg: "Hazard types" })}
					</h3>
					<ul className="text-xs">
						{props.data.hazardMix.map((h) => (
							<li
								key={h.hipTypeId ?? "none"}
								className="flex justify-between gap-2"
							>
								<span>
									{h.hipTypeId
										? (props.hazardTypeNames[h.hipTypeId] ?? h.hipTypeId)
										: t({
												code: "geoportal.dossier.unclassified",
												msg: "No hazard recorded",
											})}
								</span>
								<span className="tabular-nums">{fmt(h.recordCount)}</span>
							</li>
						))}
					</ul>
				</div>
			)}

			{ev && ev.records > 0 && (
				<div>
					<h3 className="font-semibold">
						{t({ code: "geoportal.dossier.events", msg: "Disaster events" })}
					</h3>
					{ev.events > 0 ? (
						<p className="text-xs">
							{t(
								{
									code: "geoportal.dossier.events.per_event",
									msg: "{linked} disaster records belong to {events} disaster events, {per} records per event on average.",
								},
								{
									linked: fmt(ev.linkedRecords),
									events: fmt(ev.events),
									per: (ev.linkedRecords / ev.events).toLocaleString(undefined, {
										maximumFractionDigits: 1,
									}),
								},
							)}
						</p>
					) : null}
					<p className="text-xs text-brand-text-muted">
						{t(
							{
								code: "geoportal.dossier.events.unlinked",
								msg: "{n} of {total} disaster records ({pct}%) belong to no disaster event, so event counts here are not a count of every disaster.",
							},
							{
								n: fmt(ev.records - ev.linkedRecords),
								total: fmt(ev.records),
								pct: Math.round(
									(100 * (ev.records - ev.linkedRecords)) / ev.records,
								),
							},
						)}
					</p>
					{ev.events > 0 && (
						<p className="text-xs text-brand-text-muted">
							{t(
								{
									code: "geoportal.dossier.events.codes",
									msg: "Event codes: GLIDE number on {glide} of {events} events, national code on {national}.",
								},
								{
									glide: fmt(ev.glideEvents),
									events: fmt(ev.events),
									national: fmt(ev.nationalCodeEvents),
								},
							)}
						</p>
					)}
					{ev.top.length > 0 && (
						<ul className="text-xs mt-1">
							{ev.top.map((e) => (
								<li key={e.id} className="flex justify-between gap-2">
									<span className="min-w-0">
										<span className="block truncate">
											{e.name ??
												t({
													code: "geoportal.dossier.events.unnamed",
													msg: "Unnamed event",
												})}
										</span>
										{((e.glide && e.glide !== e.name) || e.nationalId) && (
											<span className="block text-brand-text-muted">
												{[
													// Migrated events are often named by their GLIDE number.
													e.glide && e.glide !== e.name && `GLIDE ${e.glide}`,
													e.nationalId &&
														t(
															{
																code: "geoportal.dossier.events.national",
																msg: "National code {code}",
															},
															{ code: e.nationalId },
														),
												]
													.filter(Boolean)
													.join(" · ")}
											</span>
										)}
									</span>
									<span className="tabular-nums shrink-0">{fmt(e.records)}</span>
								</li>
							))}
						</ul>
					)}
				</div>
			)}

			{grades && (
				<p className="text-xs text-brand-text-muted">
					{t({ code: "geoportal.readout.grades", msg: "Attribution grades" })}:{" "}
					{grades}
				</p>
			)}
			<p className="text-xs text-brand-text-muted">{recurrence.note}</p>
		</section>
	);
}
