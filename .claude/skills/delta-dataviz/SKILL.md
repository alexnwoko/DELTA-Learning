---
name: delta-dataviz
description:
  "Design, build and review DELTA Resilience Analytics charts, KPI tiles, dashboards, map panels,
  icon arrays and infographics. Use whenever a DELTA screen or export shows disaster human effects,
  damage or losses as a chart, tile, map or infographic, when choosing a chart type, colours or
  empty states, or when reviewing an Analytics pull request. Encodes DELTA's data-honesty, Sendai
  and accessibility rules on top of pinned third-party chart rules."
---

# DELTA dataviz

DELTA charts answer one question each, for national data officers and decision makers, without
overstating what the data says. This skill sits on top of `delta-data-honesty` and
`delta-house-style`; where they conflict with any third-party rule below, the DELTA skills win.

## Stack (decided; do not reopen)

- Charts: Recharts 3 (`accessibilityLayer` is on by default in 3.10.1; test what it gives).
  No second chart stack: no D3 by hand, no ECharts, no Vega.
- Maps: OpenLayers. Components: PrimeReact + Tailwind 4 with headless React Aria (D-06).
- One Analytics shell, one filter bar, one query object `delta.query/1` in the URL (D1 to D11).
- Icons for people and housing: OCHA Humanitarian Icons 2026 (CC BY 4.0), self-hosted, credited.

## Workflow (every chart, tile, map or infographic)

1. **Question.** Write the one question the panel answers and the DELTA item it serves (epic or
   MVP ID). Title it as the question or the takeaway (`references/chart-choice.md`).
2. **Form.** Pick the form from the FT Visual Vocabulary category, then the Recharts 3 component
   (`references/chart-choice.md`). Walk `third_party/vois-dataviz/data/decision-tree.json` when
   unsure.
3. **Data states.** Map every value to one DELTA state and give each state its own treatment
   (`references/delta-states-and-honesty.md`). This step is not optional.
4. **Context.** Every figure shows its grade (A to D), coverage, provisional label where it
   applies, and a source line with method and date.
5. **Accessibility and language.** Keyboard model, table twin, contrast, colour independence,
   right-to-left and long labels (`references/accessibility-and-rtl.md`).
6. **Maps.** Spikes for counts; choropleth only with a denominator (`references/maps-openlayers.md`).
7. **Infographic or export.** One-page hierarchy and print rules
   (`references/infographic-and-export.md`).
8. **Review.** Run the DELTA gate in `references/review-checklist.md`, and the detector:
   `node .claude/skills/delta-dataviz/third_party/vois-dataviz/scripts/detect.mjs <files>`.

## DELTA rules that override everything below them

1. **Null is not zero.** "Not reported" is never drawn as 0, never summed as 0 and never hidden.
   A real reported zero is a mark; a missing value is a gap with a label.
2. **States are distinct.** Reported value, reported zero, not reported, not applied, no records
   match the filters, suppressed and provisional never share one mark, line, cell or colour.
3. **Grade and coverage travel with the figure.** A KPI tile shows value, grade badge and coverage
   ("reported by 14 of 21 provinces"). A chart's source line carries method, grade and date.
4. **Money is refused** until the monetary convention is ruled. The tile shows the refusal with the
   code `MONETARY_CONVENTIONS_PENDING` and a one-line reason. Never compact money (overrides
   DV-HONEST-007's "$4.2M" example).
5. **Words.** "Human effects and damage" where no money is shown. "Disaster impact" for the record
   dimension. Sendai Framework Targets A to D names; HIPs 2025 hazard names. Count unit "disaster
   records" unless ruled otherwise (RV-4).
6. **No donuts or pies for comparison.** Sorted bars. Part-to-whole only for two or three parts,
   and as a stacked bar.
7. **Filters.** `delta.query/1` is the single source; per-card pickers are not allowed. Clicking
   the map filters the dashboard.
8. **Self-hosted only** on public pages: fonts, icons, basemaps (RV-7). No hosted chart renderers.

## Sendai Framework panels (reference set)

| Target | Indicator family | Default form | Note |
|---|---|---|---|
| A | Deaths, missing | Bar by year or hazard; icon array for one event | Deaths and missing kept separate; per-100,000 only with a population denominator |
| B | Directly affected, injured, displaced, relocated, evacuated | Bar; stacked bar for components | B-1 composite only per TR-216 coverage rule (RV-3) |
| C | Direct economic loss | Refusal tile | Money refused until ruled |
| D | Damage to infrastructure and services | Bar of units damaged and destroyed | Counts only; no valuation |

## Files

- `references/delta-states-and-honesty.md`: states, grades, coverage, provisional, money refusal.
- `references/chart-choice.md`: FT Visual Vocabulary to Recharts 3 map; titles and sources.
- `references/accessibility-and-rtl.md`: keyboard, table twin, palette, contrast, RTL, long labels.
- `references/maps-openlayers.md`: spikes, choropleth, classes, p-codes, no-data grey.
- `references/infographic-and-export.md`: one-page fact sheet, icon arrays, print and PDF.
- `references/review-checklist.md`: the DELTA review gate.
- `third_party/`: pinned sources with licences; see `NOTICE`. Read them for depth; DELTA rules win.
