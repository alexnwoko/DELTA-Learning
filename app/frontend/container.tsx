import React from "react";
import { useIsDataEntryPage } from "./PageBrand";

interface MainContainerProps {
	title: string;
	children: React.ReactNode;
	showHeader?: boolean;
	headerExtra?: React.ReactNode;
	headerAfter?: React.ReactNode;
}

export function MainContainer(props: MainContainerProps) {
	const { showHeader = true } = props;
	// On Data Entry pages the section heading is the h1 (root layout), so the
	// page's own title is the second level.
	const Title = useIsDataEntryPage() ? "h2" : "h1";

	return (
		<>
			{showHeader ? (
				<div className="mg-container dts-page-header">
					<header className="dts-page-title">
						<div className="mg-container">
							<Title className="dts-heading-1">{props.title}</Title>
						</div>
					</header>
					{props.headerExtra}
				</div>
			) : null}
			{props.headerAfter}
			<div className="mg-container">{props.children}</div>
		</>
	);
}
