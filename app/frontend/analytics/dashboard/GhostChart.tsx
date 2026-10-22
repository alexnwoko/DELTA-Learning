// A grey placeholder in the shape a panel's chart will take, for a panel
// with no data yet (Alex, 2026-10-18: the Hazardous events view shows the
// analyses it will carry instead of an empty page). The shapes are fixed
// drawings, not figures: no axis, no number, no value is implied, and the
// drawing is hidden from screen readers; the panel's text says why it is
// empty.
import type { ViewContext } from "~/frontend/context";

export type GhostShape =
	| "tiles"
	| "bars"
	| "columns"
	| "line"
	| "heatmap"
	| "map"
	| "table"
	| "flow"
	| "boxes"
	| "boxplot"
	| "dots";

const W = 320;
const H = 150;

function shapes(shape: GhostShape): React.ReactNode {
	switch (shape) {
		case "tiles":
			return [0, 1, 2, 3].map((i) => (
				<g key={i}>
					<rect
						x={8 + i * 78}
						y={30}
						width={70}
						height={90}
						rx={6}
						className="fill-current opacity-40"
					/>
					<rect
						x={18 + i * 78}
						y={50}
						width={40}
						height={14}
						rx={3}
						className="fill-current"
					/>
					<rect
						x={18 + i * 78}
						y={76}
						width={50}
						height={8}
						rx={3}
						className="fill-current opacity-60"
					/>
				</g>
			));
		case "bars":
			return [0.92, 0.74, 0.6, 0.45, 0.33, 0.2].map((f, i) => (
				<g key={i}>
					<rect
						x={8}
						y={12 + i * 22}
						width={56}
						height={10}
						rx={3}
						className="fill-current opacity-50"
					/>
					<rect
						x={72}
						y={10 + i * 22}
						width={(W - 84) * f}
						height={14}
						rx={3}
						className="fill-current"
					/>
				</g>
			));
		case "columns":
			return [
				0.3, 0.45, 0.4, 0.62, 0.5, 0.75, 0.58, 0.85, 0.66, 0.9, 0.7, 0.55,
			].map((f, i) => (
				<rect
					key={i}
					x={10 + i * 25.5}
					y={H - 12 - (H - 30) * f}
					width={18}
					height={(H - 30) * f}
					rx={2}
					className="fill-current"
				/>
			));
		case "line":
			return (
				<>
					<path
						d="M10 120 L60 100 L110 108 L160 70 L210 82 L260 48 L310 60"
						className="fill-none stroke-current"
						strokeWidth={4}
						strokeLinecap="round"
						strokeLinejoin="round"
					/>
					<path
						d="M10 132 L60 124 L110 118 L160 112 L210 100 L260 96 L310 88"
						className="fill-none stroke-current opacity-50"
						strokeWidth={4}
						strokeLinecap="round"
						strokeLinejoin="round"
					/>
					<line
						x1={10}
						y1={140}
						x2={310}
						y2={140}
						className="stroke-current opacity-40"
						strokeWidth={2}
					/>
				</>
			);
		case "heatmap":
			return Array.from({ length: 6 }, (_, r) =>
				Array.from({ length: 12 }, (_, c) => (
					<rect
						key={`${r}-${c}`}
						x={10 + c * 25.5}
						y={8 + r * 23}
						width={22}
						height={20}
						rx={2}
						className="fill-current"
						opacity={0.15 + (((r * 7 + c * 5) % 9) / 9) * 0.75}
					/>
				)),
			);
		case "map":
			return (
				<>
					<path
						d="M60 20 L150 12 L210 30 L260 22 L290 60 L270 110 L220 138 L150 132 L100 140 L50 110 L40 60 Z"
						className="fill-current opacity-30 stroke-current"
						strokeWidth={2}
					/>
					<path
						d="M150 12 L160 70 L100 140 M160 70 L290 60 M160 70 L220 138 M40 60 L160 70"
						className="fill-none stroke-current opacity-60"
						strokeWidth={2}
					/>
					<circle cx={110} cy={60} r={14} className="fill-current opacity-70" />
					<circle cx={215} cy={60} r={9} className="fill-current opacity-70" />
					<circle
						cx={190}
						cy={110}
						r={18}
						className="fill-current opacity-70"
					/>
					<circle cx={90} cy={112} r={7} className="fill-current opacity-70" />
				</>
			);
		case "table":
			return Array.from({ length: 6 }, (_, r) => (
				<g key={r}>
					<rect
						x={8}
						y={8 + r * 23}
						width={W - 16}
						height={18}
						rx={2}
						className="fill-current"
						opacity={r === 0 ? 0.7 : 0.2}
					/>
					{r > 0 && (
						<rect
							x={16}
							y={14 + r * 23}
							width={90}
							height={6}
							rx={2}
							className="fill-current opacity-60"
						/>
					)}
					{r > 0 && (
						<rect
							x={190}
							y={14 + r * 23}
							width={40}
							height={6}
							rx={2}
							className="fill-current opacity-60"
						/>
					)}
					{r > 0 && (
						<rect
							x={250}
							y={14 + r * 23}
							width={50}
							height={6}
							rx={2}
							className="fill-current opacity-60"
						/>
					)}
				</g>
			));
		case "flow":
			return (
				<>
					{[0, 1, 2].map((i) => (
						<rect
							key={`l${i}`}
							x={10}
							y={12 + i * 46}
							width={24}
							height={36}
							rx={3}
							className="fill-current"
						/>
					))}
					{[0, 1].map((i) => (
						<rect
							key={`r${i}`}
							x={W - 34}
							y={24 + i * 62}
							width={24}
							height={44}
							rx={3}
							className="fill-current"
						/>
					))}
					<path
						d="M34 30 C160 30 160 46 286 46 M34 76 C160 76 160 50 286 50 M34 122 C160 122 160 108 286 108"
						className="fill-none stroke-current opacity-40"
						strokeWidth={14}
					/>
				</>
			);
		case "boxes":
			return (
				<>
					<rect
						x={8}
						y={8}
						width={170}
						height={134}
						rx={3}
						className="fill-current opacity-70"
					/>
					<rect
						x={182}
						y={8}
						width={130}
						height={70}
						rx={3}
						className="fill-current opacity-50"
					/>
					<rect
						x={182}
						y={82}
						width={70}
						height={60}
						rx={3}
						className="fill-current opacity-35"
					/>
					<rect
						x={256}
						y={82}
						width={56}
						height={60}
						rx={3}
						className="fill-current opacity-25"
					/>
				</>
			);
		case "boxplot":
			return [0, 1, 2, 3].map((i) => {
				const x = 30 + i * 76;
				const top = 30 + ((i * 17) % 30);
				return (
					<g key={i}>
						<line
							x1={x + 16}
							y1={top - 18}
							x2={x + 16}
							y2={top + 80}
							className="stroke-current opacity-50"
							strokeWidth={2}
						/>
						<rect
							x={x}
							y={top}
							width={32}
							height={50}
							rx={3}
							className="fill-current"
						/>
						<line
							x1={x}
							y1={top + 24}
							x2={x + 32}
							y2={top + 24}
							className="stroke-current"
							strokeWidth={3}
						/>
					</g>
				);
			});
		case "dots":
			return Array.from({ length: 28 }, (_, i) => (
				<circle
					key={i}
					cx={20 + ((i * 53) % 280)}
					cy={20 + ((i * 37) % 110)}
					r={4 + (i % 4)}
					className="fill-current opacity-60"
				/>
			));
	}
}

export function GhostChart({
	ctx,
	shape,
}: {
	ctx: ViewContext;
	shape: GhostShape;
}) {
	return (
		<div className="relative mx-auto w-full max-w-sm">
			<svg
				viewBox={`0 0 ${W} ${H}`}
				role="presentation"
				aria-hidden="true"
				focusable="false"
				className="mx-auto block h-auto w-full max-w-sm text-brand-border-control opacity-70"
			>
				{shapes(shape)}
			</svg>
			<span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded border border-brand-border-control bg-brand-surface px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-brand-text-muted">
				{ctx.t({ code: "dashboard.no_data_yet", msg: "No data yet" })}
			</span>
		</div>
	);
}

export default GhostChart;
