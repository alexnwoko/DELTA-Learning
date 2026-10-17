# Self-hosted basemap: build one country's tiles

The geoportal basemap (I-3, TR-166, SEC-20) is a set of grey raster tiles
served from the DELTA origin by `/tiles/basemap/{z}/{x}/{y}.png`. The app
reads them from the folder named by `BASEMAP_TILE_DIR`. This folder holds
the scripts that build that tile folder for one country. Run them on a
build machine with internet access, then copy the tile folder to the
server (or to removable media for offline sites).

Pipeline (research: `70_Geospatial_and_Geoportal/Geoportal_Build_Spec/_research/DELTA_Basemap_Tile_Pipeline_Research.md`):

1. Cut the country out of a Protomaps daily OpenStreetMap build with the
   `pmtiles` command (go-pmtiles). Only the country area is fetched.
2. Generate a grayscale style with `@protomaps/basemaps` (`make-style.mjs`),
   with labels in the country's language.
3. Render raster tiles with TileServer GL from the cut-out, the style, the
   Noto Sans fonts and the grayscale icons of `protomaps/basemaps-assets`.
4. Request every tile once and write the `z/x/y.png` tree
   (`seed_tiles.py`).

## Versions used for the first build (Mozambique, 2026-10-16)

| Item | Version | Check |
|---|---|---|
| go-pmtiles | 1.31.2 (Darwin arm64) | sha256 `40528f7f616fcbf91207cd48c8fc023d213f6d86c0cbf1f748732803d1880f3d` (GitHub release digest) |
| Protomaps build | `20261015.pmtiles` (format 4.15.2, OSM replication 2026-10-15T04:00Z) | b3sum listed in `build-metadata.protomaps.dev/builds.json` |
| TileServer GL | `maptiler/tileserver-gl:v5.6.0`, linux/arm64 | `sha256:3a9ccdb24820b6814c8119bcc8a4376c39867cb0ffe69d62919ef898b90c2427` |
| `@protomaps/basemaps` | 5.7.2 (BSD-3, design CC0) | npm |
| `protomaps/basemaps-assets` | commit `028c18f` (fonts OFL, icons MIT) | git |

Protomaps keeps daily builds for about a week. Archive the country
cut-out (`*.pmtiles`) with its date so a build can be repeated.

## Steps

```bash
# 1. Cut-out: the tenant extent plus a margin, zoom 0 to 12.
pmtiles extract https://build.protomaps.com/20261015.pmtiles data/moz-20261015-z12.pmtiles \
  --bbox=29.217,-27.856,41.841,-9.480 --maxzoom=12

# 2. Style (labels in Portuguese for Mozambique).
node make-style.mjs <path>/node_modules/@protomaps/basemaps moz pt build/style-moz.json

# 3. Render server, local only.
docker run -d --name delta-tileserver --memory 4g -p 127.0.0.1:8090:8080 \
  -v "$PWD/data":/data/pmtiles:ro \
  -v "<basemaps-assets>/fonts":/data/fonts:ro \
  -v "<basemaps-assets>/sprites/v4":/data/sprites:ro \
  -v "$PWD/build":/data/build:ro \
  maptiler/tileserver-gl:v5.6.0 --config /data/build/config.json

# 4. Seed the tile tree, then stop the render server.
python3 -I seed_tiles.py http://127.0.0.1:8090/styles/moz/256 tiles/moz \
  29.217 -27.856 41.841 -9.480 12 8
docker stop delta-tileserver
```

`tileserver-config.example.json` is the config for step 3. Get the extent
from the tenant's own boundaries (`GET /:lang/api/geo/extent`). Use a
wider margin than one degree if the map should show more of the
neighbouring countries at small zooms.

## Measured (Mozambique, zoom 0 to 12, 2026-10-16)

- Cut-out: 79 MB, 83 MB transferred, 15 s.
- Render: 43,351 tiles in 125 s on an Apple M-series laptop.
- Tiles: 177.9 MB of data (258 MB on disk), mean 4.1 KB, 95th
  percentile 10.0 KB, largest 31.1 KB. None is over the 60 KB budget.

## Serving

Mount the tile folder into the app container read-only and set
`BASEMAP_TILE_DIR` to it. The basemap stays off until the reader turns
it on, and "© OpenStreetMap contributors" shows whenever it is drawn.
One tile set can serve several countries on one instance: the tile grid
is global, so render one set over the union of the hosted countries.

## Open before production

- Boundaries and place names: OpenStreetMap shows them as on the ground,
  which may differ from UN practice. A UNDRR cartography focal point signs
  off before a public release. DELTA draws official boundaries from its own
  data on top.
- Label scripts other than Latin (Ethiopic, Arabic, Devanagari) need a
  rendering test before those countries are built.
