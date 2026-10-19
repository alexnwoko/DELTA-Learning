// Print button (TR-246): opens the browser's print dialog, which also saves
// as PDF. Hidden on paper.
import { Button } from "react-aria-components";
import type { ViewContext } from "~/frontend/context";
import { SECONDARY_BUTTON } from "~/frontend/buttonStyles";

export function PrintButton({ ctx, label }: { ctx: ViewContext; label?: string }) {
	return (
		<Button
			data-print="hide"
			onPress={() => window.print()}
			className={SECONDARY_BUTTON}
		>
			{label ?? ctx.t({ code: "print.print", msg: "Print or save as PDF" })}
		</Button>
	);
}

export default PrintButton;
