# DELTA Resilience: Mozambique Tier A open-data pilot

This branch holds only a data pilot. It shares no history with the DELTA code.

A GitHub Actions workflow (`.github/workflows/moz-tier-a.yml`) downloads open
datasets on GitHub's runner, computes per-district figures for Mozambique over
the COD-AB districts, and commits small CSV outputs to `outputs/moz/`. Raw
inputs never leave the runner. `outputs/moz/manifest.csv` records every
input's URL, licence, retrieval time, size, SHA-256 and status.

Only openly licensed results are published (CC BY, CC0, public domain).
District boundaries are used for the joins but not republished.
Display-only, analysis-only and ODbL sources are not used here.

Purpose: prototype the per-area hazard and exposure statistics of DELTA's
forecast integration layer (FM-4 to FM-6). Research and source choices are
in the DELTA product documentation (`03_Design_Specs/Enrichment_Data_Integration/_research/open_dataset_retrieval/`).

## Attribution

- WorldPop Global2 R2025A (CC BY 4.0), www.worldpop.org.
- GRIP4, Meijer et al. 2018, PBL (CC BY 4.0).
- MapSPAM 2020 v2r2, IFPRI (CC BY 4.0), adapted to district sums.
- GLW4 2020, FAO (CC BY 4.0).
- CHIRPS-GEFS v3, Climate Hazards Center, UC Santa Barbara.
- ECMWF open data (CC BY 4.0).
- Copernicus Global Drought Observatory, European Commission JRC (CC BY 4.0).
- IBTrACS v04r01, NOAA NCEI.
- INAM CAP feed (public domain).
- IPC Mozambique and humanitarian needs, via HDX (CC0).
- Mozambique health facilities (CC0) and school facilities (CC BY), via HDX.
- District joins use COD-AB Mozambique (CC BY-IGO), OCHA, via HDX.

Figures are pilot outputs, not official statistics.
