# Accessibility, language and right-to-left

Sources: Community-Access `accessibility-agents` (`third_party/community-access`, MIT); vois-dataviz
DV-A11Y rules; DELTA A10 (axe 0 serious or critical; RTL check); WCAG 2.2 AA.

## Every chart

- **Table twin.** A visible "Show as table" toggle renders the same data in a React Aria table,
  with the same states and labels.
- **Text alternative.** The chart figure has a title, a one-sentence summary of the takeaway, and
  the source line, reachable by screen readers.
- **Keyboard.** Tab to the chart; arrow keys move between points; Enter opens the tooltip; Escape
  closes it; focus is visible (3:1). In right-to-left, left and right arrows reverse.
- **Colour.** Never the only carrier of meaning: use labels, patterns or position as well. Marks
  and focus rings at 3:1 contrast against the surface; text at 4.5:1.
- **Motion.** Respect `prefers-reduced-motion`; no animated count-ups.
- **Recharts 3.** `accessibilityLayer` defaults to true (3.10.1 types). Test keyboard and screen
  reader output before relying on it.

## Colour (use DELTA tokens first)

- Quantities: the single-hue ramps in `app/styles/tokens/data.css`: `--delta-data-ramp-people-1..5`,
  `-housing-1..5`, `-events-1..5` (`-money-*` stays unused while money is refused).
- Hazards: one colour per HIPs 2025 type: `--delta-data-hazard-meteorological-hydrological`,
  `-geological`, `-biological`, `-environmental`, `-chemical`, `-technological`, `-societal`,
  `-extraterrestrial`, `-unclassified`.
- States: the state tokens (see `delta-states-and-honesty.md`).
- Fallback categorical palette only where no token fits (Wong, colour-vision safe, from the
  Community-Access knowledge base): `#E69F00`, `#56B4E9`, `#009E73`, `#F0E442`, `#0072B2`,
  `#D55E00`, `#CC79A7`. Propose a new token instead of hard-coding.

## Right-to-left and long labels

- Set `dir` and `lang` on the chart container; use CSS logical properties.
- In RTL, mirror category axes and legends; keep numbers left-to-right inside `<bdi>`.
- Horizontal bars for long labels (Russian, Tajik); wrap at word boundaries; never truncate a place
  or hazard name without a tooltip and the table twin.
- Format numbers with the locale (`Intl.NumberFormat`); do not mix locale formats in one view.
