// Print button (TR-246): opens the browser's print dialog, which also saves
// as PDF. Hidden on paper.
import { Button } from "react-aria-components";
import type { ViewContext } from "~/frontend/context";

export function PrintButton({ ctx, label }: { ctx: ViewContext; label?: string }) {
	return (
		<Button
			data-print="hide"
			onPress={() => window.print()}
			className="rounded border border-brand-border-control bg-brand-surface px-3 py-1 text-sm text-brand-interactive data-[hovered]:bg-brand-surface-subtle data-[focus-visible]:outline data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-brand-focus-ring"
		>
			{label ?? ctx.t({ code: "print.print", msg: "Print or save as PDF" })}
		</Button>
	);
}

export default PrintButton;
