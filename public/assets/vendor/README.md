# Vendored map libraries

These files are served from DELTA's own origin, so maps work offline and under
a Content Security Policy with no third-party script origins (NFR-041, ADR-02).
They are copied from the npm packages below without edits; Git stores
`leaflet.css` and Leaflet's `LICENSE` with LF line endings (CRLF upstream). Only the `dist` files
the app loads are kept; source maps and sources are left out.

| Package | Version | Licence | npm integrity (sha512) |
|---|---|---|---|
| `leaflet` | 1.9.4 | BSD-2-Clause | `nxS1ynzJOmOlHp+iL3FyWqK89GtNL8U8rvlMOsQdTTssxZwCXh8N2NB3GDQOL+YR3XnWyZAxwQixURb+FA74PA==` |
| `leaflet-draw` | 1.0.4 | MIT | `rsQ6saQO5ST5Aj6XRFylr5zvarWgzWnrg46zQ1MEOEIHsppdC/8hnN8qMoFvACsPvTioAuysya/TVtog15tyAQ==` |

The app refers to these files only through `app/utils/leafletAssets.ts`.
To upgrade, add a new version folder, update that module, and record the new
integrity here. Leaflet is being retired in favour of OpenLayers view by view
(ADR-02); delete these folders when the last Leaflet map is gone.
