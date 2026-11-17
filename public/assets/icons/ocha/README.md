# OCHA Humanitarian Icons (subset)

Icons beside the data-point titles of the Analysis dashboard.

- **Source:** OCHA Humanitarian Icons v2.1 (2020), created by the United Nations Office for the Coordination of Humanitarian Affairs (OCHA), packaged by MapAction: https://github.com/mapaction/ocha-humanitarian-icons-for-gis. Local copy: `DELTA_Version_2/80_Frontend_and_Design_System/icons/humanitarian-icons-v2-1/`.
- **Credit:** "Source: OCHA", as OCHA's icon pages ask.
- **Licence:** The MapAction repository states no licence. A LibreOffice extension that packages the set lists it as public domain (and CC0 for its package). UNDRR should confirm the terms with OCHA before a public release.
- **Change from the source:** The GIS `param(...)` prefixes in the `fill`, `stroke` and `stroke-width` attributes are removed. The shapes are unchanged. The dashboard draws each file as a CSS mask, so it takes a design-token colour.
- **Which icon goes with which title:** `app/frontend/charts/dashboardIcons.ts`. That file also lists the titles that have no OCHA icon (`MISSING_ICONS`).
