## ADDED Requirements

### Requirement: Contract and rules agree

CI SHALL refuse a change where the contract schema and the loader rules
disagree on any cross-field rule.

#### Scenario: a rule is removed from the loader
- **GIVEN** the interval-type rule is removed from `referenceValueRules.ts`
- **WHEN** the contract test runs
- **THEN** the case "a bound states its interval type" fails
