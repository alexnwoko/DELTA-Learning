## ADDED Requirements

### Requirement: Licence-filtered reference values

`GET /:lang/api/reference/values` SHALL return only values the caller's
channel may receive and SHALL state how many were withheld and why.

#### Scenario: API key
- **GIVEN** values under display_and_redistribute, display_only,
  signed_in_only and analysis_only sources
- **WHEN** an API-key caller lists them
- **THEN** only the display_and_redistribute value is returned
- **AND** `meta.withheld` counts 3 under the other three rules

#### Scenario: malformed request
- **WHEN** the indicator parameter is missing
- **THEN** the response is 400 with `MALFORMED_REQUEST`
