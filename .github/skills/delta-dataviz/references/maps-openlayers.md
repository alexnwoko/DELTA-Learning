# Map panels (OpenLayers)

Sources: `muend/geoai-skills` `cartography-geoviz` (`third_party/cartography-geoviz`, MIT); DASH
round 1 GEO findings (RV-5, RV-6, RV-7); Geoportal Build Spec.

## Three questions first (from cartography-geoviz)

1. **What is the message?** One map, one message.
2. **Is it normalised?** A choropleth of raw counts is a population map. Without a population
   denominator, show counts as proportional spikes or symbols, not area colour (RV-5).
3. **Static or interactive?** Interactive in the Analytics shell; print follows
   `infographic-and-export.md`.

## Rules

- Counts: spikes or proportional symbols at the area centroid, with a size legend.
- Rates (per 100,000): choropleth, only with a stated population source and year.
- Classes: fixed, defined breaks for any map series; 5 plus or minus 2 classes; state the method.
- No data: hatched grey with a legend entry "Not reported", never the lowest class colour.
- Places: join on COD-AB p-codes; hazards on HIPs codes (RV-6 pending). Show the boundary vintage.
- Clicking an area sets the place filter in `delta.query/1`; the whole dashboard follows.
- Basemaps on public pages are self-hosted (RV-7).
- Keyboard: areas reachable by keyboard; the same data in the table twin.
