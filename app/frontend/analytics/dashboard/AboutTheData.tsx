// "About the data" block of the D1 dashboard: disclaimer, partners and
// contact, inside <main> so it prints (print.css hides the site footer).
// Wording from DELTA_Dashboard_Disclaimer_Partners_Contact.md v0.3,
// sections 3.1, 4 and 5. The "not the official Sendai Framework Monitor
// submission" sentence and the contact address await UNDRR clearance.
// Partners show as text only: no logo until written permission is held.
import { useId } from "react";
import { SECTION_ICONS } from "~/frontend/charts/dashboardIcons";
import { PanelIcon } from "~/frontend/charts/PanelIcon";
import type { ViewContext } from "~/frontend/context";
import type { QueryDimension } from "~/utils/deltaQuery";

export interface FocalPoint {
	institution: string;
	unit?: string;
	email: string;
	webPage?: string;
}

export interface AboutTheDataProps {
	ctx: ViewContext;
	/** Country name of the instance. */
	country: string;
	dimension: QueryDimension;
	provisional: boolean;
	/** "[national agency], via COD-AB [version], [licence]"; omitted until set. */
	boundarySource?: string | null;
	/** The active basemap's attribution, for example "© OpenStreetMap contributors". */
	basemapAttribution?: string | null;
	/** The national focal point (tenant setting); all fields needed to go live. */
	focalPoint?: FocalPoint | null;
	/** The national warning service, named on Hazardous events pages. */
	warningService?: { name: string; url: string } | null;
}

const LEADS = [
	"United Nations Office for Disaster Risk Reduction (UNDRR)",
	"United Nations Development Programme (UNDP)",
	"World Meteorological Organization (WMO)",
];

// Order of the UNDRR DELTA page (P-A); UNESCO is on the partners page only.
const CONTRIBUTORS = [
	"United Nations University Institute for Environment and Human Security (UNU-EHS)",
	"United Nations Environment Programme (UNEP)",
	"International Organization for Migration (IOM)",
	"Food and Agriculture Organization of the United Nations (FAO)",
	"ITC Faculty of Geo-Information Science and Earth Observation, University of Twente",
	"510, an initiative of the Netherlands Red Cross",
	"Pacific Disaster Center (PDC)",
	"CIMA Research Foundation",
	"World Food Programme (WFP)",
	"Youth Innovation Lab",
	"United Nations Educational, Scientific and Cultural Organization (UNESCO)",
	"United Nations Office of Information and Communications Technology (OICT)",
	"United Nations International Computing Centre (UNICC)",
];

const UNDRR_CONTACT = "undrr-bonn@un.org";
const DELTA_PAGE =
	"https://www.undrr.org/building-risk-knowledge/disaster-losses-and-damages-tracking-system-delta-resilience";

export function AboutTheData({
	ctx,
	country,
	dimension,
	provisional,
	boundarySource,
	basemapAttribution,
	focalPoint,
	warningService,
}: AboutTheDataProps) {
	const headingId = useId();
	const t = ctx.t;
	const link =
		"text-brand-interactive underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-focus-ring";

	return (
		<section
			aria-labelledby={headingId}
			data-print="keep"
			className="flex flex-col gap-3 border-t border-brand-border pt-4 text-sm text-brand-text"
		>
			<h2 id={headingId} className="m-0 flex items-center gap-2 text-lg font-semibold">
				<PanelIcon name={SECTION_ICONS.about} size={20} />
				{t({ code: "dashboard.about_the_data", msg: "About the data" })}
			</h2>
			{provisional && (
				<p
					role="note"
					className="m-0 border-s-4 border-data-notice-provisional-border bg-data-notice-provisional-background px-3 py-2"
				>
					{t({
						code: "dashboard.disclaimer_provisional",
						msg: "Provisional: includes records not yet validated or published. Not for publication.",
					})}
				</p>
			)}
			{dimension === "hazardous_event" && (
				<p className="m-0">
					{t({ code: "dashboard.no_warnings", msg: "DELTA Resilience issues no warnings." })}{" "}
					{warningService ? (
						<>
							{t({ code: "dashboard.consult_warnings", msg: "For current warnings, consult" })}{" "}
							<a className={link} href={warningService.url} rel="noopener noreferrer">
								{warningService.name}
							</a>
							.
						</>
					) : (
						t({
							code: "dashboard.warning_service_not_set",
							msg: "National warning service link: not configured.",
						})
					)}
				</p>
			)}
			<p className="m-0">
				{t(
					{
						code: "dashboard.disclaimer_public",
						msg: "Figures are computed by DELTA Resilience from the disaster records held for {country} in this instance. They cover reported records only and are not the official Sendai Framework Monitor submission of {country}. Provided as is, without warranty; UNDRR accepts no liability for their use. The boundaries and names shown and the designations used on this map do not imply official endorsement or acceptance by the United Nations.",
					},
					{ country },
				)}{" "}
				{boundarySource &&
					t({ code: "dashboard.boundaries", msg: "Boundaries: {source}." }, { source: boundarySource })}{" "}
				{basemapAttribution &&
					t({ code: "dashboard.basemap", msg: "Basemap: {attribution}." }, { attribution: basemapAttribution })}
			</p>

			<div className="grid grid-cols-1 gap-4 md:grid-cols-2 print:grid-cols-1">
				<div>
					<h3 className="m-0 mb-1 text-base font-semibold">
						{t({ code: "dashboard.partners", msg: "Partners" })}
					</h3>
					<p className="m-0">
						<span className="font-semibold">{t({ code: "dashboard.led_by", msg: "Led by:" })}</span>{" "}
						{LEADS.join("; ")}
					</p>
					<p className="m-0 mt-1 text-brand-text-muted">
						<span className="font-semibold text-brand-text">
							{t({ code: "dashboard.contributions_from", msg: "With contributions from:" })}
						</span>{" "}
						{CONTRIBUTORS.join("; ")}
					</p>
				</div>
				<div>
					<h3 className="m-0 mb-1 text-base font-semibold">
						{t({ code: "dashboard.contact", msg: "Contact" })}
					</h3>
					<p className="m-0">
						<span className="font-semibold">
							{t({ code: "dashboard.contact_country", msg: "About the data for {country}:" }, { country })}
						</span>{" "}
						{focalPoint ? (
							<>
								{[focalPoint.institution, focalPoint.unit].filter(Boolean).join(", ")},{" "}
								<a className={link} href={`mailto:${focalPoint.email}`}>
									{focalPoint.email}
								</a>
								{focalPoint.webPage && (
									<>
										,{" "}
										<a className={link} href={focalPoint.webPage} rel="noopener noreferrer">
											{focalPoint.webPage}
										</a>
									</>
								)}
							</>
						) : (
							t({ code: "dashboard.contact_not_set", msg: "Contact details not yet set" })
						)}
					</p>
					{focalPoint && (
						<p className="m-0 mt-1 text-brand-text-muted">
							{t(
								{
									code: "dashboard.contact_figures",
									msg: "Questions about these figures should go to {institution}. UNDRR does not hold or correct national records.",
								},
								{ institution: focalPoint.institution },
							)}
						</p>
					)}
					<p className="m-0 mt-1">
						<span className="font-semibold">
							{t({ code: "dashboard.contact_delta", msg: "About DELTA Resilience:" })}
						</span>{" "}
						{t({ code: "dashboard.undrr_bonn", msg: "UNDRR Office in Bonn" })},{" "}
						<a className={link} href={`mailto:${UNDRR_CONTACT}`}>
							{UNDRR_CONTACT}
						</a>
						,{" "}
						<a className={link} href={DELTA_PAGE} rel="noopener noreferrer">
							{t({ code: "dashboard.delta_page", msg: "DELTA Resilience at UNDRR" })}
						</a>
					</p>
				</div>
			</div>
		</section>
	);
}

export default AboutTheData;
