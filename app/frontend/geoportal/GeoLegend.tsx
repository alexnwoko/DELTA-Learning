// Legend for the geoportal map: ramp classes, then every off-ramp state on
// the map, each with its own encoding (TR-169), then areas with no records.
import {
	bubbleRadiusPx,
	OFF_RAMP_STATES,
	PLAUSIBILITY_MARKER,
	STATE_ENCODING,
	type MapLegend,
} from "~/utils/mapState";
import { NO_RECORDS_STYLE } from "~/frontend/geoportal/geoCells";
import { dataTokens } from "~/utils/designTokens.generated";
import {
	boundaryText,
	fmt,
	plainT,
	type GeoT,
} from "~/frontend/geoportal/i18n";

function Swatch(props: {
	fill: string;
	stroke: string;
	dash?: string | null;
	pattern?: string;
}) {
	const id = `p-${props.pattern}-${props.fill.slice(1)}-${props.stroke.slice(1)}`;
	return (
		<svg width="20" height="14" aria-hidden="true" focusable="false">
			{props.pattern && props.pattern !== "none" && (
				<defs>
					<pattern id={id} width="6" height="6" patternUnits="userSpaceOnUse">
						<rect width="6" height="6" fill={props.fill} />
						{props.pattern === "dots" ? (
							<circle cx="3" cy="3" r="1" fill={props.stroke} />
						) : (
							<path d="M0,6 L6,0" stroke={props.stroke} strokeWidth="1" />
						)}
						{props.pattern === "crosshatch" && (
							<path d="M0,0 L6,6" stroke={props.stroke} strokeWidth="1" />
						)}
					</pattern>
				</defs>
			)}
			<rect
				x="1"
				y="1"
				width="18"
				height="12"
				fill={
					props.pattern && props.pattern !== "none" ? `url(#${id})` : props.fill
				}
				stroke={props.stroke}
				strokeDasharray={props.dash ?? undefined}
			/>
		</svg>
	);
}

export interface GeoLegendProvenance {
	/** Read-model refresh time (ISO), or null when never refreshed. */
	refreshedAt: string | null;
	/** Boundary version (vintage) of the areas drawn (TR-168, GP-6). */
	boundaryVersion: string;
}

/**
 * The legend as the map's layer card (review R03): what is shown, for which
 * period and level, how classes were made, every state on the map with its
 * encoding (TR-169), areas with nothing in scope, flagged areas, and where
 * the figures come from. Counts in brackets are written out as areas.
 */
export function GeoLegend(props: {
	legend: MapLegend;
	title: string;
	/** "Admin level 1 · all dates" style line. */
	subtitle?: string;
	/** One extra line, for example the TR-060 note on sub-national figures. */
	note?: string;
	noRecordsAreas: number;
	provenance?: GeoLegendProvenance;
	t?: GeoT;
}) {
	const { legend } = props;
	const t = props.t ?? plainT;
	const areas = (n: number) =>
		n === 1
			? t({ code: "geoportal.legend.one_area", msg: "1 area" })
			: t(
					{ code: "geoportal.legend.n_areas", msg: "{n} areas" },
					{ n: fmt(n) },
				);
	const method =
		legend.mode === "bubbles"
			? t({
					code: "geoportal.legend.method_bubbles",
					msg: "Bubble area is proportional to the value",
				})
			: legend.mode === "bars"
				? t({
						code: "geoportal.legend.method_bars",
						msg: "Bar length is proportional to the value; parts are not added",
					})
				: legend.mode === "classes"
					? t(
							{
								code: "geoportal.legend.method_quantile",
								msg: "Quantile classes, {n}",
							},
							{ n: legend.classes.length },
						)
					: legend.mode === "single_tone"
						? t({
								code: "geoportal.legend.method_single",
								msg: "One colour: too few areas for classes",
							})
						: null;
	return (
		<section
			aria-label={props.title}
			className="geo-legend text-[7.7pt] bg-brand-surface/95 border border-brand-border rounded shadow-sm p-2 max-w-[17rem]"
		>
			<h2 className="text-[7.7pt] font-semibold leading-tight">{props.title}</h2>
			{props.subtitle && (
				<p className="text-[6.5pt] text-brand-text-muted">{props.subtitle}</p>
			)}
			{props.note && (
				<p className="text-[6.5pt] text-brand-text-muted">{props.note}</p>
			)}
			{method && <p className="text-[6.5pt] text-brand-text-muted mb-1">{method}</p>}
			<ul className="space-y-1">
				{legend.symbols?.kind === "bubble" &&
					legend.symbols?.references.map((r) => {
						const rad = bubbleRadiusPx(r.ratio, 14);
						const size = Math.ceil(rad * 2 + 2);
						return (
							<li key={`bubble-${r.value}`} className="flex items-center gap-2">
								<svg width={32} height={size} aria-hidden="true">
									<circle
										cx={16}
										cy={size / 2}
										r={rad}
										fill={legend.symbols!.color}
										fillOpacity={0.75}
										stroke="#ffffff"
									/>
								</svg>
								<span>{fmt(r.value)}</span>
							</li>
						);
					})}
				{legend.symbols?.kind === "bubble" && (
					<li className="text-[6.5pt]">
						{t({
							code: "geoportal.legend.bubble_ring",
							msg: "Ring: share of records that report this figure",
						})}
					</li>
				)}
				{legend.symbols?.kind === "bubble" &&
					legend.symbols?.outliers.map((o) => (
						<li key={`outlier-${o.areaId}`} className="text-[6.5pt]">
							{t(
								{
									code: "geoportal.legend.bubble_outlier",
									msg: "Drawn at the cap, above the scale: {value}",
								},
								{ value: fmt(o.value) },
							)}
							{o.flagged
								? ` ${t({ code: "geoportal.legend.flagged_short", msg: "(flagged for review)" })}`
								: ""}
						</li>
					))}
				{legend.symbols?.kind === "bars" &&
					legend.symbols?.parts.map((p, i) => (
						<li key={`part-${p.key}`} className="flex items-center gap-2">
							<svg width={14} height={14} aria-hidden="true">
								<path
									d="M3,13 V5 a4,4 0 0 1 8,0 V13 Z"
									fill={legend.symbols!.color}
									fillOpacity={1 - i * 0.3}
								/>
							</svg>
							<span>{p.label}</span>
						</li>
					))}
				{legend.symbols?.kind === "bars" && (
					<li className="text-[6.5pt]">
						{t(
							{
								code: "geoportal.legend.bars_scale",
								msg: "Longest bar: {value}. A dashed slot is not reported.",
							},
							{ value: fmt(legend.symbols.scaleMax) },
						)}
					</li>
				)}
				{legend.symbols?.maxFlagged && (
					<li className="text-[6.5pt]">
						{t({
							code: "geoportal.legend.symbol_max_flagged",
							msg: "Largest symbol includes figures flagged for review",
						})}
					</li>
				)}
				{legend.mode === "classes" &&
					legend.classes.map((c) => (
						<li key={c.index} className="flex items-center gap-2">
							<Swatch
								fill={c.color}
								stroke={dataTokens.map.areaBoundary.stroke}
							/>
							<span>
								{c.lower === c.upper
									? fmt(c.lower)
									: t(
											{
												code: "geoportal.legend.range",
												msg: "{lower} to {upper}",
											},
											{ lower: fmt(c.lower), upper: fmt(c.upper) },
										)}{" "}
								<span className="text-brand-text-muted">
									({areas(c.areas)})
								</span>
							</span>
						</li>
					))}
				{legend.mode === "single_tone" && legend.singleTone && (
					<li className="flex items-center gap-2">
						<Swatch
							fill={legend.singleTone.color}
							stroke={dataTokens.map.areaBoundary.stroke}
						/>
						<span>
							{t({ code: "geoportal.legend.reported", msg: "Reported" })}{" "}
							<span className="text-brand-text-muted">
								({areas(legend.singleTone.areasShaded)})
							</span>
						</span>
					</li>
				)}
				{legend.states.map((s) => {
					const enc = STATE_ENCODING[s.state];
					return (
						<li key={s.state} className="flex items-center gap-2">
							<Swatch
								fill={enc.fill}
								stroke={enc.stroke}
								dash={enc.dashArray}
								pattern={enc.pattern}
							/>
							<span>
								{enc.label}{" "}
								<span className="text-brand-text-muted">
									({areas(s.areas)})
								</span>
							</span>
						</li>
					);
				})}
				{props.noRecordsAreas > 0 && (
					<li className="flex items-center gap-2">
						<Swatch
							fill={NO_RECORDS_STYLE.fill}
							stroke={NO_RECORDS_STYLE.stroke}
						/>
						<span>
							{t({
								code: "geoportal.legend.nothing",
								msg: NO_RECORDS_STYLE.label,
							})}{" "}
							<span className="text-brand-text-muted">
								({areas(props.noRecordsAreas)})
							</span>
						</span>
					</li>
				)}
				{legend.flaggedAreas > 0 && (
					<li className="flex items-center gap-2">
						<Swatch fill="none" stroke={PLAUSIBILITY_MARKER.stroke} />
						<span>
							{PLAUSIBILITY_MARKER.label}{" "}
							<span className="text-brand-text-muted">
								({areas(legend.flaggedAreas)})
							</span>
						</span>
					</li>
				)}
			</ul>
			{props.provenance && (
				<p className="text-[6.5pt] text-brand-text-muted border-t border-brand-border mt-2 pt-1">
					{boundaryText(props.provenance.boundaryVersion, t)}
					{props.provenance.refreshedAt && (
						<>
							<br />
							{t(
								{ code: "geoportal.legend.as_of", msg: "Figures as of {date}" },
								{
									date: new Date(props.provenance.refreshedAt)
										.toISOString()
										.slice(0, 10),
								},
							)}
						</>
					)}
				</p>
			)}
		</section>
	);
}

export { OFF_RAMP_STATES };
