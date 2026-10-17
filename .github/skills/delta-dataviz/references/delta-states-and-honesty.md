# Data states, grades, coverage and refusals

Sources: `delta-data-honesty`; DASH round 1 review (2026-10-16); vois-dataviz DV-HONEST and DV-STATE
rules (`third_party/vois-dataviz`); tastecheck absence states (`third_party/tastecheck-data-viz`).

## The seven states

Every value shown on a DELTA chart, tile, map or table is in exactly one state.

| State | Meaning | Chart | Tile | Map | Table |
|---|---|---|---|---|---|
| Reported value | A figure was reported | Normal mark | Value | Class colour or spike | Value |
| Reported zero | The source says zero | A visible zero mark (bar stub or point at 0) | "0" | Lightest class, outlined | 0 |
| Not reported | No figure was reported | Gap with the label "Not reported" | "Not reported" in place of a value | Hatched grey, legend entry | "Not reported" |
| Not applied | The field does not apply to this record or hazard | No mark; strip label "Not applied" | Hidden, with a note | Not drawn; legend note | "Not applied" |
| No records match | The filters return nothing | Empty-state message naming the filters | "No records match these filters" | Plain basemap and message | Message row |
| Suppressed | Hidden to protect small counts (E22) | Gap labelled "Suppressed" | "Suppressed" | Hatched, legend entry | "Suppressed" |
| Provisional | Loaded, not yet published | Normal mark plus "Provisional" badge on the panel | Badge on tile | Badge in legend | Column flag |

Rules:

- Never draw "not reported" as 0. Break a line at a gap; do not interpolate across it
  (DV-HONEST-005, DV-HONEST-008).
- Never sum "not reported" into a total. A total over partial data says "at least" and shows
  coverage.
- "Reported zero" and "not reported" must look different in every view (tastecheck: zero, not
  observed, suppressed, not applicable and not yet reported cannot share a treatment).
- DV-STATE-002's generic empty cases are replaced by the states above.

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
