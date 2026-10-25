## ADDED Requirements

### Requirement: Seven redistribution rules

`ref.source.redistribution_rule` SHALL accept the seven SEC-19 rules, and the
database MUST refuse any `ref.value` row whose source is `excluded`.

#### Scenario: excluded source
- **GIVEN** a source with rule `excluded`
- **WHEN** a value is inserted on its release
- **THEN** the insert fails with a check violation

#### Scenario: per-resource source
- **GIVEN** a source with rule `per_resource`
- **WHEN** a value is inserted without a resolved rule
- **THEN** the insert fails
- **AND** it succeeds with `redistribute_share_alike`

### Requirement: Contract v0.3 cross-field rules

The database SHALL enforce PD-04 rules 3 to 6 on `ref.value`.

#### Scenario: coarse grid
- **GIVEN** a value graded REF-C
- **WHEN** `quality_flags` is set to `coarse_grid`
- **THEN** the update fails until the grade is REF-D
