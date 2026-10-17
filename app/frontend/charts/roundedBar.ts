// Rounded bar ends (Alex, 2026-10-17: "keep all of them as rounded bar
// graph, at least at the top or right end of the bar"). Only the far end
// is rounded; the baseline stays flat, so bar lengths stay comparable.
// Pure module, for hand-drawn SVG bars; Recharts bars use `radius`.

/** The radius used across the dashboard, as on the Analytics charts. */
export const BAR_RADIUS = 6;

/**
 * An SVG path for a bar with its far end rounded: the top for a column
 * ("up"), the right for a horizontal bar ("right"; "left" in right-to-left
 * layouts). The radius shrinks to fit a short or thin bar.
 */
export function roundedBarPath(
	x: number,
	y: number,
	width: number,
	height: number,
	end: "up" | "right" | "left",
	radius = BAR_RADIUS,
): string {
	if (width <= 0 || height <= 0) return "";
	const along = end === "up" ? height : width;
	const across = end === "up" ? width : height;
	const r = Math.max(0, Math.min(radius, across / 2, along));
	const x2 = x + width;
	const y2 = y + height;
	if (end === "up") {
		return `M${x},${y2}V${y + r}Q${x},${y} ${x + r},${y}H${x2 - r}Q${x2},${y} ${x2},${y + r}V${y2}Z`;
	}
	if (end === "right") {
		return `M${x},${y}H${x2 - r}Q${x2},${y} ${x2},${y + r}V${y2 - r}Q${x2},${y2} ${x2 - r},${y2}H${x}Z`;
	}
	return `M${x2},${y}H${x + r}Q${x},${y} ${x},${y + r}V${y2 - r}Q${x},${y2} ${x + r},${y2}H${x2}Z`;
}
