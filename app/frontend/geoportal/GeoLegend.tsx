// Legend for the geoportal map: ramp classes, then every off-ramp state on
// the map, each with its own encoding (TR-169), then areas with no records.
import {
	OFF_RAMP_STATES,
	PLAUSIBILITY_MARKER,
	STATE_ENCODING,
	type MapLegend,
} from "~/utils/mapState";
import { NO_RECORDS_STYLE } from "~/frontend/geoportal/GeoMap";

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

const fmt = (n: number) => n.toLocaleString();

export function GeoLegend(props: {
	legend: MapLegend;
	title: string;
	noRecordsAreas: number;
}) {
	const { legend } = props;
	return (
		<section aria-label={props.title} className="geo-legend text-sm">
			<h3 className="font-semibold mb-1">{props.title}</h3>
			<ul className="space-y-1">
				{legend.mode === "classes" &&
					legend.classes.map((c) => (
						<li key={c.index} className="flex items-center gap-2">
							<Swatch fill={c.color} stroke="#ffffff" />
							<span>
								{fmt(c.lower)} to {fmt(c.upper)} ({c.areas})
							</span>
						</li>
					))}
				{legend.mode === "single_tone" && legend.singleTone && (
					<li className="flex items-center gap-2">
						<Swatch fill={legend.singleTone.color} stroke="#ffffff" />
						<span>
							Reported ({legend.singleTone.areasShaded}); too few areas for
							classes
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
								{enc.label} ({s.areas})
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
							{NO_RECORDS_STYLE.label} ({props.noRecordsAreas})
						</span>
					</li>
				)}
				{legend.flaggedAreas > 0 && (
					<li className="flex items-center gap-2">
						<Swatch fill="#ffffff" stroke={PLAUSIBILITY_MARKER.stroke} />
						<span>
							{PLAUSIBILITY_MARKER.label} ({legend.flaggedAreas})
						</span>
					</li>
				)}
			</ul>
		</section>
	);
}

export { OFF_RAMP_STATES };
