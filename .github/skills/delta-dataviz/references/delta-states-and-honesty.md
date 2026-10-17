# Data states, grades, coverage and refusals

Sources: `delta-data-honesty`; DASH round 1 review (2026-10-16); vois-dataviz DV-HONEST and DV-STATE
rules (`third_party/vois-dataviz`); tastecheck absence states (`third_party/tastecheck-data-viz`).

## Value states (use the code's names)

Every value is a `MeasureValue` with one `valueState` from `app/utils/valueState.ts`:
`reported`, `zero_confirmed`, `not_reported`, `not_applicable`, `suppressed`,
`insufficient_reporting`. Two view states sit on top: "no records match the filters" and
"provisional". Draw each with its design token from `app/styles/tokens/data.css`
(`--delta-data-state-<state>-fill|stroke|dash|pattern`, `--delta-data-map-no-records-*`,
`--delta-data-notice-provisional-*`). Never invent a colour for a state.

| State | Meaning | Chart | Tile | Map | Table |
|---|---|---|---|---|---|
| `reported` | A figure was reported | Normal mark | Value | Class colour or spike | Value |
| `zero_confirmed` | The source confirms zero | Visible zero mark, dashed outline (state token) | "0 (confirmed)" | Outlined, state token | 0 |
| `not_reported` | No figure reported | Gap labelled "Not reported" (state token) | "Not reported" in place of a value | State token fill, legend entry | "Not reported" |
| `insufficient_reporting` | Too few records report it to show a figure | Hatched gap labelled "Insufficient reporting" | "Insufficient reporting" with coverage | Hatched (state token) | "Insufficient reporting" |
| `not_applicable` | The field does not apply | No mark; strip label "Not applicable" | Hidden, with a note | Not drawn; `map-not-applied-note` | "Not applicable" |
| `suppressed` | Hidden to protect small counts (E22) | Crosshatched gap labelled "Suppressed" | "Suppressed" | Crosshatched (state token) | "Suppressed" |
| No records match (view) | Filters return nothing | Message naming the filters | "No records match these filters" | `map-no-records` fill and message | Message row |
| Provisional (view) | Loaded, not yet published | Panel badge (`notice-provisional`) | Badge on tile | Legend badge | Column flag |

Monetary figures use `MonetaryValueState` (`reported` or `not_reported` only) and are refused on
screen until D-04 is ruled.

Rules:

- Never draw "not reported" as 0. Break a line at a gap; do not interpolate across it
  (DV-HONEST-005, DV-HONEST-008).
- Never sum "not reported" into a total. A total over partial data says "at least" and shows
  coverage.
- Tastecheck makes the same point: zero, not observed, suppressed, not applicable and not yet
  reported cannot share a treatment.
- DV-STATE-002's generic empty cases are replaced by the states above.
- `zero_confirmed` and `not_reported` must look different in every view.

## Grade (A to D)

Every derived figure carries the method grade from the data contract. Show it as a small badge
with a text label ("Grade B"), never colour alone. Explain the grade in the tooltip and the table
twin.

## Coverage

Show coverage beside each figure: "Reported by 14 of 21 provinces" or "312 of 410 records report
this field". When coverage is under the panel threshold (ruling pending), the panel says so in its
subtitle.

## Money refusal

Until the monetary convention is ruled, every money figure is replaced by a refusal tile:

- Title: the measure name (for example "Direct economic loss (Target C)").
- Body: "Not shown until the monetary convention is agreed."
- Code: `MONETARY_CONVENTIONS_PENDING`, in small type, for support staff.

## Honesty checks from vois-dataviz (keep)

Bars and areas start at zero; one y-axis per chart; compare like with like; mark partial periods;
no spline smoothing; guard small samples; make comparison periods explicit; log scale only when
labelled (DV-HONEST-001 to 010). Lie factor between 0.95 and 1.05 (tastecheck).
