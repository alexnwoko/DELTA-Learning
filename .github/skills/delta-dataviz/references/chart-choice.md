# Chart choice, titles and sources

Sources: Financial Times Visual Vocabulary (`Financial-Times/chart-doctor`, MIT, commit `befb9cba`,
categories cited, not copied); vois-dataviz decision tree; Cédric Scherer's `dataviz-principles`
(`third_party/dataviz-principles`); TerminalSkills `recharts` (`third_party/recharts`).

## FT category to DELTA panel to Recharts 3

| FT category | DELTA question it answers | Recharts 3 component | Avoid |
|---|---|---|---|
| Magnitude | How many deaths, affected people, houses damaged? | `BarChart` (horizontal for long hazard or place names) | 3-D, pictorial bars |
| Ranking | Which hazards or provinces had the most impact? | Sorted horizontal `BarChart` | Pie, donut |
| Change over Time | How did human effects change by year? | `BarChart` for counts per year; `LineChart` only for continuous series | Smoothed lines; plotting partial years as complete |
| Part-to-whole | What share of affected people were displaced? | Stacked `BarChart` (two or three parts) | Pie, donut, treemap for comparison |
| Distribution | How are event sizes spread (intensive versus extensive)? | `BarChart` histogram with stated bins | Box plots for non-specialist audiences |
| Deviation | Is this year above or below the baseline? | Diverging `BarChart` around the baseline | Dual axes |
| Correlation | Do deaths rise with affected people? | `ScatterChart` (analyst view only) | Implied causation in titles |
| Spatial | Where did impacts occur? | OpenLayers map panel (see `maps-openlayers.md`) | Choropleth of raw counts |
| Flow | How did events cascade between hazards? | Reference only for now (Sankey after ruling) | Decorative flows |

## Titles

- Title states the question or the takeaway; subtitle states the measure, unit, place and period
  ("Deaths and missing by year, Angola, 2000 to 2024").
- Plain words; Sendai and HIPs names; "human effects and damage" where no money is shown.
- No title says more than the data shows (no causal verbs unless the method supports them).

## Source line (every chart)

"Source: DELTA national database (country), {method}, grade {A to D}, coverage {x of y}, data
as of {date}. Provisional." Keep it on screen and in every export.

## Small multiples

Same scale across panels unless a note says otherwise. Same order of categories everywhere.

## Recharts 3 notes

Read `third_party/recharts/SOURCE.md` for v3 API changes before writing code. Use a shared
DELTA chart wrapper (title, subtitle, states, source line, table twin) rather than raw charts.
