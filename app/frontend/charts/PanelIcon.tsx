// An OCHA icon drawn as a CSS mask, so it takes the colour of the text or
// of a design token rather than the file's own black. Decorative: the title
// beside it carries the meaning, so the icon is hidden from screen readers.
import { createContext, useContext, type CSSProperties } from "react";
import { iconUrl, type OchaIcon } from "./dashboardIcons";

export function PanelIcon({
	name,
	size = 20,
	colour,
	className = "",
}: {
	name: OchaIcon;
	size?: number;
	/** A CSS colour or var(); defaults to the palette icon colour (--panel-icon, else data.icon). */
	colour?: string;
	className?: string;
}) {
	const url = `url(${iconUrl(name)})`;
	const style: CSSProperties = {
		width: size,
		height: size,
		backgroundColor: colour ?? "var(--panel-icon, var(--delta-data-icon))",
		maskImage: url,
		WebkitMaskImage: url,
		maskRepeat: "no-repeat",
		WebkitMaskRepeat: "no-repeat",
		maskPosition: "center",
		WebkitMaskPosition: "center",
		maskSize: "contain",
		WebkitMaskSize: "contain",
	};
	return <span aria-hidden="true" data-icon={name} className={`inline-block shrink-0 ${className}`} style={style} />;
}

/**
 * The icon of the panel being drawn. The grid sets it per panel, and
 * ChartFrame shows it left of the title, so no panel passes it by hand.
 */
export const PanelIconContext = createContext<OchaIcon | null>(null);

export function usePanelIcon(): OchaIcon | null {
	return useContext(PanelIconContext);
}
