## ADDED Requirements

### Requirement: Loader honours the source rule

The loader SHALL reject every row of an `excluded` source, and SHALL store each
row's own rule for a `per_resource` source.

#### Scenario: excluded
- **GIVEN** a source registered as `excluded`
- **WHEN** a CSV row names it
- **THEN** the row is rejected and nothing is written

#### Scenario: per resource
- **GIVEN** a source registered as `per_resource`
- **WHEN** two rows name it with `redistribute_share_alike` and `analysis_only`
- **THEN** both load, each value carrying its own rule
