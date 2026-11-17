// Card, row and coverage-line styles shared by the place panel blocks
// (Sendai targets, disaster events). Alex, 2026-10-25: "cards should be well
// formatted": one layout everywhere, label left, figure right on the same
// line, coverage in small text beneath.
export const CARD =
	"rounded-[8px] border border-brand-border bg-brand-surface px-3 py-2 space-y-1";
export const ROW =
	"grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 py-1 border-b border-brand-border last:border-b-0";
export const SUB =
	"col-span-2 text-xs text-brand-text-muted text-right leading-tight";
