// Readout for the area under the pointer, or the area chosen from the list
// (review R04). It shows what mapState already resolved: the value with its
// unit or the state name, how many disaster impacts reported it, grades and
// precision. Never a number for a state that has none (TR-076).
import type { MapArea } from "~/utils/mapState";
import { stateLabel } from "~/frontend/geoportal/GeoTable";
import { fmt, plainT, type GeoT } from "~/frontend/geoportal/i18n";

export function GeoReadout(props: {
	name: string;
	area: MapArea | undefined;
	unit: string;
	/** Unit of the bar parts when they differ from the shading (layered map). */
	partsUnit?: string;
	/** Show the area's own value above the parts (layered map); default true. */
	showValue?: boolean;
	/** Noun for what reports the value: "disaster impacts" or "events". */
	reportedNoun: string;
	selected: boolean;
	t?: GeoT;
}) {
	const t = props.t ?? plainT;
	const { area } = props;
	const tip = area?.tooltip;
	const value =
		area?.state === "shaded" && typeof area.value === "number"
			? `${fmt(area.value)} ${props.unit}`.trim()
			: stateLabel(area, t);
	return (
		<div
			className="geo-readout bg-brand-surface/95 border border-brand-border rounded shadow-sm p-2 text-sm max-w-[16rem]"
			aria-hidden="true"
		>
			<p className="font-semibold leading-tight">{props.name}</p>
			{(props.showValue ?? true) && <p className="text-base">{value}</p>}
			{area?.symbol?.kind === "bars" && (
				<ul className="text-sm">
					{area.symbol.bars.map((b) => (
						<li key={b.key}>
							{b.label}:{" "}
							{b.valueState === "reported" && typeof b.value === "number"
								? `${fmt(b.value)} ${props.partsUnit ?? props.unit}`.trim()
								: t({
										code: "geoportal.readout.part_not_reported",
										msg: "not reported",
									})}
						</li>
					))}
				</ul>
			)}
			{tip && tip.stateDetail && (
				<p className="text-xs text-brand-text-muted">{tip.stateDetail}</p>
			)}
			{tip && (
				<p className="text-xs text-brand-text-muted">
					{t(
						{
							code: "geoportal.readout.reported_by",
							msg: "Reported by {n} of {m} {noun}",
						},
						{
							n: fmt(tip.reportedBy.n),
							m: fmt(tip.reportedBy.of),
							noun: props.reportedNoun,
						},
					)}
				</p>
			)}
			{tip?.gradeDistribution && tip.gradeDistribution.length > 0 && (
				<p className="text-xs text-brand-text-muted">
					{t({ code: "geoportal.readout.grades", msg: "Attribution grades" })}:{" "}
					{tip.gradeDistribution
						.map((g) => `${g.grade} ${fmt(g.records)}`)
						.join(", ")}
				</p>
			)}
			{tip?.precision && (
				<p className="text-xs text-brand-text-muted">
					{t({
						code: "geoportal.readout.precision",
						msg: "Location precision",
					})}
					: {tip.precision}
				</p>
			)}
			{!props.selected && (
				<p className="text-xs text-brand-interactive mt-1">
					{t({
						code: "geoportal.readout.select",
						msg: "Select for place details",
					})}
				</p>
			)}
		</div>
	);
}
