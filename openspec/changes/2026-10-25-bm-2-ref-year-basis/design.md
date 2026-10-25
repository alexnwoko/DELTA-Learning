## Decisions

1. The fallback year is the record start year (decision log D-BM-04): it is
   the date nearest to the effect that DELTA holds.
2. `yearBasis` is optional on input and required on output, so existing
   callers keep compiling and every result states its basis.
3. Display of the label in the Analysis and Geoportal panels belongs to those
   lanes; `YEAR_BASIS_LABELS` gives them the wording.

## Types

`YearBasis`, `YEAR_BASIS_LABELS` (new); `PopulationDenominatorOptions`,
`DenominatorRefusal`, `DenominatorResult`, `RateResult`, `SendaiNumerators`
(new member).
