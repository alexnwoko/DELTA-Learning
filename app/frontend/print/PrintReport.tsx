// Printable report with chosen sections (TR-246). The reader ticks the
// sections to include, then prints or saves as PDF. Every report states its
// source, approval basis and date; a report on the reviewer provisional
// basis carries a banner on screen and on paper (AB-01).
import React, { useId, useState } from "react";
import { Checkbox, CheckboxGroup, Label } from "react-aria-components";
import type { ViewContext } from "~/frontend/context";
import { PrintButton } from "./PrintButton";

export interface PrintReportSection {
	id: string;
	/** Already translated. */
	title: string;
	content: React.ReactNode;
}

export interface PrintReportProps {
	ctx: ViewContext;
	/** Already translated. */
	title: string;
	/** For example "DELTA Angola". */
	source: string;
	basis: "published" | "provisional";
	sections: PrintReportSection[];
	/** Sections ticked at first; all of them when omitted. */
	initialSelected?: string[];
	onSelectedChange?: (ids: string[]) => void;
	generatedAt?: Date;
}

export function PrintReport({
	ctx,
	title,
	source,
	basis,
	sections,
	initialSelected,
	onSelectedChange,
	generatedAt = new Date(),
}: PrintReportProps) {
	const titleId = useId();
	const [selected, setSelected] = useState<string[]>(
		initialSelected ?? sections.map((s) => s.id),
	);
	const t = (code: string, msg: string) => ctx.t({ code, msg });
	const date = generatedAt.toISOString().slice(0, 10);
	const basisText =
		basis === "provisional"
			? t(
					"print.basis_provisional",
					"PROVISIONAL: includes unpublished records; not for publication",
				)
			: t("print.basis_published", "Published records");
	const shown = sections.filter((s) => selected.includes(s.id));

	return (
		<div className="flex flex-col gap-4">
			<div
				data-print="hide"
				className="flex flex-wrap items-end justify-between gap-4 rounded border border-brand-border bg-brand-surface-subtle p-3"
			>
				<CheckboxGroup
					value={selected}
					onChange={(ids) => {
						setSelected(ids);
						onSelectedChange?.(ids);
					}}
					className="flex flex-col gap-1"
				>
					<Label className="text-sm font-semibold text-brand-text">
						{t("print.sections", "Sections to include")}
					</Label>
					<div className="flex flex-wrap gap-x-4 gap-y-1">
						{sections.map((s) => (
							<Checkbox
								key={s.id}
								value={s.id}
								className="group flex cursor-pointer items-center gap-2 text-sm text-brand-text data-[focus-visible]:outline data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-brand-focus-ring"
							>
								<span
									aria-hidden="true"
									className="flex h-4 w-4 items-center justify-center rounded border border-brand-border-control bg-brand-surface text-xs leading-none group-data-[selected]:border-brand-interactive group-data-[selected]:bg-brand-interactive group-data-[selected]:text-brand-text-on-interactive"
								>
									{selected.includes(s.id) ? "✓" : ""}
								</span>
								{s.title}
							</Checkbox>
						))}
					</div>
				</CheckboxGroup>
				<PrintButton ctx={ctx} />
			</div>

			<article aria-labelledby={titleId} className="flex flex-col gap-4 text-brand-text">
				<header className="flex flex-col gap-1">
					<h1 id={titleId} className="m-0 text-xl font-semibold">
						{title}
					</h1>
					<p className="m-0 text-sm text-brand-text-muted">
						{source} · {basisText} · {date}
					</p>
				</header>
				{basis === "provisional" && (
					<p
						role="note"
						className="m-0 border-l-4 border-data-notice-provisional-border bg-data-notice-provisional-background px-3 py-2 text-sm"
					>
						{basisText}
					</p>
				)}
				{shown.length === 0 ? (
					<p data-print="hide" className="text-sm text-brand-text-muted">
						{t("print.no_sections", "No section is selected.")}
					</p>
				) : (
					shown.map((s) => (
						<section key={s.id} aria-label={s.title} data-print="keep" className="flex flex-col gap-2">
							<h2 className="m-0 text-lg font-semibold">{s.title}</h2>
							{s.content}
						</section>
					))
				)}
				<footer className="border-t border-brand-border pt-2 text-xs text-brand-text-muted">
					{source} · {basisText} · {t("print.generated", "Generated")} {date}
				</footer>
			</article>
		</div>
	);
}

export default PrintReport;
