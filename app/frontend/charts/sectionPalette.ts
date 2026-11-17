// Chart colours by page section (Alex, 2026-10-18: "every chart should use
// the colour scheme assigned to its section"; a trial, may change). Each
// ramp runs light to dark, index for index with the old data ramps, so a
// chart's series keep their relative weight. Hex values, not CSS variables,
// so a downloaded SVG or PNG keeps its colours. Hazard identity colours
// stay on the rail (NFR-094); value-state marks keep STATE_ENCODING.
import { dataTokens } from "~/utils/designTokens.generated";

const d = dataTokens.dashboard;
const s = dataTokens.sfm;

/** Main dashboard: tint, border, accent, icon blue, ink. */
export const DASHBOARD_RAMP: readonly string[] = [d.tint, d.border, d.accent, d.icon, d.ink];
/** Sendai section: tint, border, accent, mark, ink. */
export const SFM_RAMP: readonly string[] = [s.tint, s.border, s.accent, s.mark, s.ink];

/** A single-series bar or dot: 3:1 or more on white (WCAG 1.4.11). */
export const DASHBOARD_BAR = d.icon; // 3.31:1
export const SFM_BAR = s.ink; // 8.73:1; sfm.mark is only 2.63:1
