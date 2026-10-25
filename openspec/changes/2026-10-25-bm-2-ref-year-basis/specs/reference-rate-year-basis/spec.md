## ADDED Requirements

### Requirement: Every denominator states its year basis

`choosePopulationDenominator` SHALL return `yearBasis` on success and on
refusal, `start_year_fallback` when the caller states none.

#### Scenario: caller states no basis

- **GIVEN** a population value for 2024
- **WHEN** the denominator for 2024 is chosen without `yearBasis`
- **THEN** the result carries `yearBasis` `start_year_fallback`

#### Scenario: refusal

- **GIVEN** no population value for 2024
- **WHEN** the denominator is chosen
- **THEN** the refusal carries `yearBasis` `start_year_fallback`

### Requirement: Rates carry the basis

`ratePer100k` SHALL copy the denominator's `yearBasis` into its result.

#### Scenario: computed rate

- **GIVEN** a denominator on `start_year_fallback`
- **WHEN** a reported numerator is divided by it
- **THEN** `rate.denominator.yearBasis` is `start_year_fallback`
