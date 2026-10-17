# DELTA dataviz review gate

Run this on every Analytics pull request and every new panel. Combines DELTA rules with the tufte
checklist (`third_party/tufte/checklist.md`, `kill-list.md`) and the vois-dataviz review checklist
(`third_party/vois-dataviz/data/review-checklist.json`). A "no" on any DELTA item blocks the merge.

## DELTA items (blocking)

- [ ] The panel answers one stated question and names its DELTA item.
- [ ] No "not reported" value is drawn, summed or tabulated as 0.
- [ ] Reported zero, not reported, not applied, no records match, suppressed and provisional each
      have a distinct treatment in chart, tile, map and table.
- [ ] Every figure shows grade and coverage; provisional data carries the badge.
- [ ] No money figure is shown; refusal tiles carry `MONETARY_CONVENTIONS_PENDING`.
- [ ] Wording: "human effects and damage" where no money is shown; Sendai and HIPs names.
- [ ] Table twin exists and matches the chart.
- [ ] Keyboard, contrast (3:1 marks, 4.5:1 text), colour independence, RTL mirroring checked;
      axe reports 0 serious or critical.
- [ ] Maps: counts as spikes; choropleth only with a denominator; no-data hatched grey.
- [ ] Filters come only from `delta.query/1`.
- [ ] Source line present on screen and in export.

## Quality items (fix before release)

- [ ] Bars start at zero; one y-axis; no smoothing; partial periods marked.
- [ ] Sorted bars instead of pies and donuts.
- [ ] Direct labels where possible; no non-data ink (tufte kill list).
- [ ] Same scales across small multiples.
- [ ] Detector clean: `node .claude/skills/delta-dataviz/third_party/vois-dataviz/scripts/detect.mjs <files>`
      (heuristic; a finding is a prompt to look, not a verdict).
