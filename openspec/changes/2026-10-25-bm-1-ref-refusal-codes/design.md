## Context

Before this change, `choosePopulationDenominator` refused with `POPULATION_MISSING_FOR_YEAR` or
`BOUNDARY_VINTAGE_MISMATCH`; `ratePer100k` added `DENOMINATOR_ZERO` and
`NUMERATOR_INVALID`. PD-05 reserves `DENOMINATOR_MISSING` and states that the
code list is extensible.

## Decisions

1. Rename the missing-denominator code to `DENOMINATOR_MISSING` rather than map
   it at the API edge: the analytics panels, the geoportal API and the tests
   then share one code (FR-BAS-210 "in the API and in every panel").
2. Keep the other three codes as named extensions (decision log D-BM-02). Each
   names a distinct cause; the registry records it so the PD-05 table can be
   extended by the PMO.

## Types

- `DenominatorRefusalCode` (changed member).
- `RATE_REFUSAL_CODES: Record<RateRefusalCode, { pd05; requirement }>` (new).

## Tests

Unit tests only; no database needed for the rule. The real-DB tests change
their expected string.
