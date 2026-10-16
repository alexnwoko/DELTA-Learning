# DELTA design tokens

Design tokens for DELTA's screens, maps and charts (ADR-19, TR-250). Two layers:

- **Data layer** (`data/`): value states (TR-076), map states and the measure-family
  ramps. Owned by DELTA. Names and values were agreed with the Analytics and
  Geoportal lanes in FE-Tokens-01. `data.map.no-records` and
  `data.state.not-reported` are different things and are never merged.
- **Brand layer** (`brand/`): colours and focus geometry for controls and
  surfaces. `neutral.json` is Mangrove's brand-neutral base and is the
  default. `delta.json` is Mangrove's DELTA theme and applies under
  `[data-brand="delta"]`. Until UNDRR Communications rules on brand use by
  national instances, self-hosted deployments use the neutral layer.

Both are DTCG files. Style Dictionary builds them (`yarn build:tokens`) into:

| Output | Used by |
|---|---|
| `app/styles/tokens/data.css`, `brand.css` | Every screen, as CSS variables `--delta-*` |
| `app/styles/tokens/theme.css` | Tailwind v4 utilities, for example `bg-brand-interactive` |
| `app/utils/designTokens.generated.js` and `.d.ts` | `mapState.ts`, OpenLayers and charts, which need plain values |

The outputs are committed, so building the app does not run Style Dictionary.
Edit the JSON, run `yarn build:tokens`, and commit both. The unit tests fail
if an output and its JSON disagree.

## Where the brand values come from

`brand/mangrove-v2.1.0/` holds three files from
github.com/unisdr/undrr-mangrove at tag `v2.1.0` (commit `7b9d5369`),
unchanged (Apache-2.0, see its `LICENSE`; the README of that repository adds
that "The UNDRR look and feel is proprietary"):

| File | Bytes | SHA-256 (first 16) |
|---|---|---|
| `mangrove.yaml` | 24113 | `9436450a2116d264` |
| `undrr.yaml` | 5150 | `7514567babda3ea4` |
| `delta.yaml` | 7102 | `731060b5fcc33fa3` |

Mangrove's files borrow DTCG vocabulary but, by their own header, are not
DTCG, so Style Dictionary does not read them. Each brand token in
`brand/*.json` names its Mangrove path in `$extensions`. A unit test resolves
that path in the vendored files (`scripts/mangroveResolve.mjs`) and fails if the
values differ. To upgrade Mangrove: add a new release folder, point the test
at it, and fix the values the test reports.
