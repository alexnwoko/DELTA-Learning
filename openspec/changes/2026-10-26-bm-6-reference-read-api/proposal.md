## Why

PD-05 specifies reference endpoints and FR-BAS-180 (R1) asks for a read API
that returns every value with its state, grade, method, vintage, period,
source, release and licence. SEC-19 and FR-BAS-120 require licence rules in
every API response: analysis-only data never leaves the server.

## What Changes

- `referenceRead.ts`: read model for values, sources and indicators. Licence
  rules applied in the read model by caller channel (decision D-BM-08);
  withheld values counted and named (`REDISTRIBUTION_NOT_PERMITTED`); newest
  release by default (FR-BAS-700); excluded sources never shown.
- `handlers/reference.ts`: session with ViewData or X-Auth API key, one
  tenant, as for the geo routes.
- Routes `GET /:lang/api/reference/values`, `/sources`, `/indicators`
  (decision D-BM-01). OpenAPI 3.1 in DV2
  `03_Design_Specs/Baseline_Module/DELTA_Baseline_Module_API.openapi.yaml`.
- Not yet: `/drivers`, `POST /values` (FR-BAS-190), public routes (wait for
  the public tenant path, A11).

## Impact

- **DB migration**: none.
- **Test approach**: unit (rules and parsing); real DB (read model).
- **Security**: security-sensitive (auth wrapper, licence filtering). Tenant
  scope from session or API key; all input parameterised.
- **Product definition**: FR-BAS-120, FR-BAS-130 (attribution carried),
  FR-BAS-180, FR-BAS-700; PD-05; TR-151, TR-162, TR-222; SEC-19; RS-5,
  RS-11. R1.
