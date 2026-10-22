// One control style for the Analysis page (FE-Proposal-03, Alex 2026-10-19):
// 8 px radius, 40 px high, bold blue text, a tint fill and a #0095fd
// border on hover (data.dashboard.hover, the same in every theme), the light blue fill when pressed, and the brand focus ring. The
// 14 px root makes min-h-10 only 35 px, so heights are in px.
export const FOCUS_RING =
	"outline-none data-[focus-visible]:outline data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-brand-focus-ring focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-focus-ring";

const SECONDARY_BASE =
	"inline-flex items-center gap-1.5 rounded-lg border border-brand-border-control bg-data-dashboard-surface px-3.5 text-sm font-bold text-brand-interactive no-underline transition-colors duration-150 motion-reduce:transition-none data-[hovered]:border-data-dashboard-hover data-[hovered]:bg-data-dashboard-tint hover:border-data-dashboard-hover hover:bg-data-dashboard-tint data-[pressed]:bg-data-dashboard-border";

/** Header and panel buttons: 40 px high. */
export const SECONDARY_BUTTON = `${SECONDARY_BASE} min-h-[40px] ${FOCUS_RING}`;

/** Compact buttons inside cards (Download): 32 px high, still past WCAG 2.5.8. */
export const SECONDARY_BUTTON_SM = `${SECONDARY_BASE} min-h-[32px] ${FOCUS_RING}`;
