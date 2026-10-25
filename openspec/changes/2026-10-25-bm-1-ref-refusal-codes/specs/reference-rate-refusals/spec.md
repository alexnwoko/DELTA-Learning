## ADDED Requirements

### Requirement: Missing denominator uses the PD-05 code

`choosePopulationDenominator` and `ratePer100k` SHALL refuse a rate whose
population denominator is missing with the code `DENOMINATOR_MISSING`.

#### Scenario: no population value covers the year

- **GIVEN** no stored population value covers the requested year
- **WHEN** `choosePopulationDenominator` runs
- **THEN** it returns `ok: false` with `refusal.code` `DENOMINATOR_MISSING`
- **AND** no value

#### Scenario: the rate passes the code through

- **GIVEN** a refused denominator
- **WHEN** `ratePer100k` runs with a reported numerator
- **THEN** it returns `ok: false` with `refusal.code` `DENOMINATOR_MISSING`

### Requirement: Every refusal code is registered

`RATE_REFUSAL_CODES` MUST list each `RateRefusalCode` once, marked `reserved`
when PD-05 reserves it and `extension` otherwise, with a TR or FR-BAS
requirement.

#### Scenario: an unregistered code

- **GIVEN** a new member added to `RateRefusalCode`
- **WHEN** `yarn tsc` runs without a registry entry
- **THEN** type checking fails, because the registry is typed as a complete
  `Record<RateRefusalCode, ...>`
