import type { DContext } from "~/utils/dcontext";
import type { ImpactHeadlineMeasure } from "~/utils/dashboard/impactPanels";

/** Human-effect names as the dashboard shows them ("human effects", D8). */
export function impactMeasureLabel(ctx: DContext, measure: ImpactHeadlineMeasure): string {
	switch (measure) {
		case "deaths":
			return ctx.t({ code: "dashboard.measure_deaths", msg: "Deaths" });
		case "missing":
			return ctx.t({ code: "dashboard.measure_missing", msg: "Missing" });
		case "injured":
			return ctx.t({ code: "dashboard.measure_injured", msg: "Injured or ill" });
		case "affected_direct":
			return ctx.t({ code: "dashboard.measure_affected_direct", msg: "Directly affected" });
		case "displaced":
			return ctx.t({ code: "dashboard.measure_displaced", msg: "Displaced" });
	}
}
