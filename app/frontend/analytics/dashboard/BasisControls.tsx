// The approval basis on the Analysis dashboard (AB-01, ruling D7). Figures
// are drawn from published records by default; reviewers with ValidateData
// may include unpublished ones (basis=provisional), and the server refuses
// that basis to anyone else (403). The switch is the visible way in, so no
// one has to type a URL parameter; the notice says once, at the top, when
// the published basis has nothing to show.
import { Button, Label, Radio, RadioGroup } from "react-aria-components";
import type { ViewContext } from "~/frontend/context";
import type { QueryBasis } from "~/utils/deltaQuery";

const focus =
	"data-[focus-visible]:outline data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-brand-focus-ring";

export function BasisSwitch({
	ctx,
	basis,
	onChange,
}: {
	ctx: ViewContext;
	basis: QueryBasis;
	onChange: (basis: QueryBasis) => void;
}) {
	const t = ctx.t;
	const option = `cursor-pointer px-3 py-1 text-sm text-brand-interactive data-[hovered]:bg-brand-surface-subtle data-[selected]:bg-brand-interactive data-[selected]:text-brand-text-on-interactive ${focus}`;
	return (
		<RadioGroup
			value={basis}
			onChange={(v) => onChange(v as QueryBasis)}
			orientation="horizontal"
			data-print="hide"
			className="flex items-center gap-2"
		>
			<Label className="text-sm text-brand-text-muted">{t({ code: "dashboard.basis", msg: "Basis" })}</Label>
			<div className="flex overflow-hidden rounded border border-brand-border-control">
				<Radio value="published" className={option}>
					{t({ code: "dashboard.basis_published_option", msg: "Published" })}
				</Radio>
				<Radio value="provisional" className={`${option} border-s border-brand-border-control`}>
					{t({ code: "dashboard.basis_provisional_option", msg: "Include unpublished (reviewers)" })}
				</Radio>
			</div>
		</RadioGroup>
	);
}

export interface ApprovalCounts {
	published: number;
	unpublished: number;
}

/**
 * Shown once above the views when the published basis has no record in
 * scope (gap G-00). Null counts, or any published record, show nothing.
 */
export function PublishedBasisNotice({
	ctx,
	counts,
	canReview,
	onShowUnpublished,
}: {
	ctx: ViewContext;
	counts: ApprovalCounts | null;
	canReview: boolean;
	onShowUnpublished: () => void;
}) {
	if (!counts || counts.published > 0) return null;
	const t = ctx.t;
	if (counts.unpublished === 0) {
		return (
			<p role="status" className="m-0 rounded border border-brand-border bg-brand-surface-subtle px-3 py-2 text-sm">
				{t({ code: "dashboard.no_records_scope_filters", msg: "No records in scope for these filters." })}
			</p>
		);
	}
	return (
		<div role="status" className="flex flex-wrap items-center gap-3 rounded border border-brand-warning-border bg-brand-warning-background px-3 py-2 text-sm">
			<span>
				<span className="font-semibold">{t({ code: "dashboard.no_published", msg: "No published records yet." })}</span>{" "}
				{t(
					{ code: "dashboard.all_unpublished", msg: "All {n} records in scope are unpublished." },
					{ n: counts.unpublished.toLocaleString(ctx.lang) },
				)}{" "}
				<span className="text-xs">(G-00)</span>
			</span>
			{canReview ? (
				<Button
					onPress={onShowUnpublished}
					data-print="hide"
					className={`rounded border border-brand-interactive bg-brand-interactive px-3 py-1 text-sm text-brand-text-on-interactive ${focus}`}
				>
					{t({ code: "dashboard.show_unpublished", msg: "Show unpublished records (reviewers)" })}
				</Button>
			) : (
				<span>{t({ code: "dashboard.reviewers_can_view", msg: "Signed-in reviewers can view them." })}</span>
			)}
		</div>
	);
}
