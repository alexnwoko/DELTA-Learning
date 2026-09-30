import type { DContext } from "~/utils/dcontext";

// C23 methodology condition: when the approval basis admits records below
// published (a D-04 ruling for signed-in views), the figures can include
// provisional migrated records and must say so. Renders nothing otherwise.
export function ProvisionalFiguresNotice(props: {
	ctx: DContext;
	show: boolean | undefined;
}) {
	if (!props.show) return null;
	return (
		<p
			className="dts-provisional-notice"
			role="note"
			style={{ fontWeight: 600, color: "#8a4b00" }}
		>
			{props.ctx.t({
				code: "analysis.provisional_not_for_citation",
				desc: "Label on analytics figures that include provisional (unpublished, migrated) records",
				msg: "Provisional, not for citation",
			})}
		</p>
	);
}

// C23 item 4: a migrated record that is not yet published.
export function ProvisionalBadge(props: {
	ctx: DContext;
	show: boolean | undefined;
}) {
	if (!props.show) return null;
	return (
		<span
			className="dts-provisional-badge"
			style={{
				marginLeft: "0.5rem",
				padding: "0 0.4rem",
				border: "1px solid #8a4b00",
				borderRadius: "4px",
				color: "#8a4b00",
				fontSize: "0.85em",
			}}
			title={props.ctx.t({
				code: "record.provisional_tooltip",
				desc: "Tooltip on the Provisional label of a migrated record that is not yet published",
				msg: "Migrated record, not yet published",
			})}
		>
			{props.ctx.t({
				code: "record.provisional",
				desc: "Label for a migrated record that is not yet published",
				msg: "Provisional",
			})}
		</span>
	);
}
