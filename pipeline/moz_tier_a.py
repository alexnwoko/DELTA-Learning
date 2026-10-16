"""Mozambique Tier A pilot: per-district figures from open datasets.

Runs in GitHub Actions (raw data stays on the runner and is discarded).
It downloads each Tier A source, computes per-district figures over the
COD-AB districts, and writes small CSV outputs plus a manifest with the
source URL, licence, size, SHA-256 and status of every input.

Only openly licensed results are written (CC BY, CC0, public domain).
Boundary geometries, display-only or analysis-only layers and ODbL data are
never written. Research: DELTA_Version_2/03_Design_Specs/
Enrichment_Data_Integration/_research/open_dataset_retrieval/.
"""

from __future__ import annotations

import csv
import datetime as dt
import hashlib
import io
import json
import os
import re
import sys
import traceback
import zipfile
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import rasterio
import requests
from exactextract import exact_extract

RAW = Path(os.environ.get("RAW_DIR", "/tmp/raw"))
OUT = Path(os.environ.get("OUT_DIR", "outputs"))
RAW.mkdir(parents=True, exist_ok=True)
OUT.mkdir(parents=True, exist_ok=True)
TODAY = dt.datetime.now(dt.timezone.utc)
BBOX = (29.2, -27.9, 41.9, -9.4)  # Mozambique plus one degree
UA = {"User-Agent": "DELTA-Resilience-pilot (UNDRR; github.com/alexnwoko/DELTA-Learning)"}
MANIFEST: list[dict] = []


def record(source: str, url: str, licence: str, path: Path | None, status: str, note: str = ""):
    size = sha = ""
    if path and path.exists():
        size = str(path.stat().st_size)
        h = hashlib.sha256()
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(1 << 20), b""):
                h.update(chunk)
        sha = h.hexdigest()
    MANIFEST.append(
        {
            "source": source,
            "url": url,
            "licence": licence,
            "retrieved_at": TODAY.isoformat(timespec="seconds"),
            "bytes": size,
            "sha256": sha,
            "status": status,
            "note": note,
        }
    )
    print(f"[{status}] {source}: {note}", flush=True)


def fetch(url: str, name: str, headers: dict | None = None) -> Path:
    path = RAW / name
    with requests.get(url, headers={**UA, **(headers or {})}, stream=True, timeout=600) as r:
        r.raise_for_status()
        with open(path, "wb") as f:
            for chunk in r.iter_content(1 << 20):
                f.write(chunk)
    return path


def listing(url: str, pattern: str) -> list[str]:
    html = requests.get(url, headers=UA, timeout=120).text
    return sorted(set(re.findall(pattern, html)))


def hdx_resources(package: str) -> list[dict]:
    r = requests.get(
        "https://data.humdata.org/api/3/action/package_show",
        params={"id": package},
        headers=UA,
        timeout=120,
    )
    r.raise_for_status()
    return r.json()["result"]["resources"]


def run(step):
    try:
        step()
    except Exception as exc:  # each source is independent
        record(step.__name__, "", "", None, "failed", f"{type(exc).__name__}: {exc}")
        traceback.print_exc()


# --- Districts -------------------------------------------------------------

DISTRICTS: gpd.GeoDataFrame | None = None


def districts():
    """COD-AB Mozambique admin 2 (CC BY-IGO). Used for joins only; never written."""
    global DISTRICTS
    res = hdx_resources("cod-ab-moz")
    cand = [r for r in res if re.search(r"\.(gdb|shp)\.zip$|geojson", (r.get("url") or "").lower())]
    if not cand:
        raise RuntimeError("no COD-AB geometry resource found")
    url = cand[0].get("download_url") or cand[0]["url"]
    path = fetch(url, Path(url.split("?")[0]).name)
    layers = gpd.list_layers(path) if hasattr(gpd, "list_layers") else None
    layer = None
    if layers is not None:
        print(f"COD-AB layers: {list(layers['name'])}", flush=True)
        names = [n for n in layers["name"] if re.search(r"adm(in)?_?2", n, re.I)]
        layer = names[0] if names else None
    gdf = gpd.read_file(path, layer=layer) if layer else gpd.read_file(path)
    gdf = gdf.to_crs(4326)
    cols = list(gdf.columns)
    print(f"COD-AB layer {layer}; columns: {cols}", flush=True)
    pick = lambda pat: next((c for c in cols if re.fullmatch(pat, str(c), re.I)), None)
    pcode = pick(r"adm2_?p_?code") or pick(r".*adm2.*p.?code.*")
    name = pick(r"adm2_(pt|en|name|ref)") or pick(r"adm2_?name.*") or pcode
    p1 = pick(r"adm1_?p_?code") or pick(r".*adm1.*p.?code.*")
    if not pcode:
        raise RuntimeError(f"no admin 2 p-code column in {cols}")
    DISTRICTS = gdf.rename(columns={pcode: "adm2_pcode", name: "adm2_name"})
    DISTRICTS["adm1_pcode"] = gdf[p1] if p1 else ""
    DISTRICTS = DISTRICTS[["adm2_pcode", "adm2_name", "adm1_pcode", "geometry"]]
    record("COD-AB Mozambique admin 2", url, "CC BY-IGO (humanitarian-use caveat open)", path, "ok", f"{len(DISTRICTS)} districts, layer {layer}")


def districts_geoboundaries():
    """Fallback: geoBoundaries gbOpen MOZ ADM2 (CC BY 3.0 IGO). Joins only; never written."""
    global DISTRICTS
    if DISTRICTS is not None:
        return
    meta = requests.get("https://www.geoboundaries.org/api/current/gbOpen/MOZ/ADM2/", headers=UA, timeout=120).json()
    url = meta["simplifiedGeometryGeoJSON"]
    path = fetch(url, "geoBoundaries-MOZ-ADM2.geojson")
    gdf = gpd.read_file(path).to_crs(4326)
    DISTRICTS = gdf.rename(columns={"shapeID": "adm2_pcode", "shapeName": "adm2_name"})
    DISTRICTS["adm1_pcode"] = ""
    DISTRICTS = DISTRICTS[["adm2_pcode", "adm2_name", "adm1_pcode", "geometry"]]
    record("geoBoundaries MOZ ADM2 (fallback)", url, "CC BY 3.0 IGO", path, "ok", f"{len(DISTRICTS)} districts; keys are geoBoundaries shape ids, not COD p-codes")


def zonal(raster: Path | str, ops: list[str], prefix: str) -> pd.DataFrame:
    df = exact_extract(str(raster), DISTRICTS, ops, include_cols=["adm2_pcode"], output="pandas")
    return df.rename(columns={c: f"{prefix}_{c}" for c in df.columns if c != "adm2_pcode"})


def base_table() -> pd.DataFrame:
    return DISTRICTS[["adm2_pcode", "adm2_name", "adm1_pcode"]].copy()


# --- Exposure --------------------------------------------------------------

def worldpop():
    url = "https://data.worldpop.org/GIS/Population/Global_2015_2030/R2025A/2025/MOZ/v1/100m/constrained/moz_pop_2025_CN_100m_R2025A_v1.tif"
    path = fetch(url, "worldpop_moz_2025_100m.tif")
    df = base_table().merge(zonal(path, ["sum"], "pop_2025"), on="adm2_pcode")
    df.to_csv(OUT / "exposure_population_worldpop_2025.csv", index=False)
    record("WorldPop Global2 R2025A 2025 100 m constrained", url, "CC BY 4.0", path, "ok", "sum per district (alpha release, settled population only)")


def grip4():
    url = "https://dataportaal.pbl.nl/downloads/GRIP4/GRIP4_Region3_vector_shp.zip"
    path = fetch(url, "GRIP4_Region3_vector_shp.zip")
    roads = gpd.read_file(f"zip://{path}", bbox=BBOX).to_crs(4326)
    joined = gpd.overlay(roads[["GP_RTP", "geometry"]], DISTRICTS[["adm2_pcode", "geometry"]], how="intersection", keep_geom_type=True)
    joined["km"] = joined.to_crs(6933).length / 1000
    pivot = joined.pivot_table(index="adm2_pcode", columns="GP_RTP", values="km", aggfunc="sum", fill_value=0)
    pivot.columns = [f"road_km_type{int(c)}" for c in pivot.columns]
    pivot["road_km_total"] = pivot.sum(axis=1)
    df = base_table().merge(pivot.reset_index(), on="adm2_pcode", how="left")
    df.to_csv(OUT / "exposure_roads_grip4.csv", index=False)
    record("GRIP4 Region 3 roads", url, "CC BY 4.0 (Zenodo; GLOBIO page says CC0)", path, "ok", "road km per district by GRIP type")


def point_counts(gdf_pts: gpd.GeoDataFrame, column: str) -> pd.DataFrame:
    j = gpd.sjoin(gdf_pts.to_crs(4326), DISTRICTS[["adm2_pcode", "geometry"]], predicate="within")
    counts = j.groupby("adm2_pcode").size().rename(column).reset_index()
    return base_table().merge(counts, on="adm2_pcode", how="left").fillna({column: 0})


def facilities():
    res = hdx_resources("mozambique-health-facilities")
    print("health resources:", [(x.get("name"), x.get("format")) for x in res], flush=True)
    r = next(x for x in res if (x.get("format") or "").lower() in ("xlsx", "xls", "csv") or (x.get("url") or "").lower().split("?")[0].endswith((".xlsx", ".csv")))
    url = r.get("download_url") or r["url"]
    ext = "." + (r.get("format") or "xlsx").lower()
    path = fetch(url, "moz_health_facilities" + ext)
    tbl = pd.read_excel(path) if path.suffix in (".xlsx", ".xls") else pd.read_csv(path)
    print("health columns:", list(tbl.columns), flush=True)
    lat = next(c for c in tbl.columns if re.search(r"lat", str(c), re.I))
    lon = next(c for c in tbl.columns if re.search(r"lon|lng", str(c), re.I))
    tbl = tbl.dropna(subset=[lat, lon])
    pts = gpd.GeoDataFrame(tbl, geometry=gpd.points_from_xy(tbl[lon], tbl[lat]), crs=4326)
    point_counts(pts, "health_facilities").to_csv(OUT / "exposure_health_facilities_count.csv", index=False)
    record("Mozambique Master Health Facility List (HDX)", url, "CC0", path, "ok", f"{len(pts)} geolocated facilities counted per district (list dated 2017)")


def schools():
    res = hdx_resources("mozambique-school-data")
    r = next(x for x in res if (x.get("url") or "").lower().split("?")[0].endswith((".zip", ".csv", ".geojson")))
    url = r.get("download_url") or r["url"]
    path = fetch(url, "moz_schools" + Path(url.split("?")[0]).suffix)
    if path.suffix == ".zip":
        with zipfile.ZipFile(path) as z:
            names = z.namelist()
        print("schools zip:", names[:20], flush=True)
        inner = next(n for n in names if n.lower().endswith((".shp", ".geojson", ".gpkg", ".csv", ".xlsx")))
        if inner.lower().endswith((".csv", ".xlsx")):
            with zipfile.ZipFile(path) as z, z.open(inner) as fh:
                tbl = pd.read_excel(fh) if inner.lower().endswith(".xlsx") else pd.read_csv(fh)
            lat = next(c for c in tbl.columns if re.search(r"lat", str(c), re.I))
            lon = next(c for c in tbl.columns if re.search(r"lon|lng", str(c), re.I))
            tbl = tbl.dropna(subset=[lat, lon])
            pts = gpd.GeoDataFrame(tbl, geometry=gpd.points_from_xy(tbl[lon], tbl[lat]), crs=4326)
        else:
            pts = gpd.read_file(f"/vsizip/{path}/{inner}")
    else:
        pts = gpd.read_file(path)
    point_counts(pts, "schools").to_csv(OUT / "exposure_schools_count.csv", index=False)
    record("Mozambique school facilities (OCHA, HDX)", url, "CC BY", path, "ok", f"{len(pts)} schools counted per district (2022)")


def mapspam():
    record("MapSPAM 2020 v2r2", "https://doi.org/10.7910/DVN/SWPENT", "CC BY 4.0 with IFPRI terms of use", None, "skipped", "Dataverse requires accepting IFPRI terms before download (HTTP 400 when anonymous); waiting for Alex")
    return
    files = {"production": 13827040, "harvested_area": 13827043}
    for kind, fid in files.items():
        url = f"https://dataverse.harvard.edu/api/access/datafile/{fid}"
        path = fetch(url, f"spam2020_{kind}.zip")
        frames = []
        with zipfile.ZipFile(path) as z:
            tifs = [n for n in z.namelist() if n.lower().endswith("_a.tif")]
            for n in tifs:
                crop = re.sub(r".*_([A-Z]{4})_A\.tif$", r"\1", Path(n).name, flags=re.I).lower()
                frames.append(zonal(f"/vsizip/{path}/{n}", ["sum"], f"{kind}_{crop}").set_index("adm2_pcode"))
        df = base_table().merge(pd.concat(frames, axis=1).reset_index(), on="adm2_pcode", how="left")
        df.to_csv(OUT / f"exposure_crops_mapspam2020_{kind}.csv", index=False)
        record(f"MapSPAM 2020 v2r2 {kind}", url, "CC BY 4.0 (IFPRI)", path, "ok", f"{len(tifs)} crops, all technologies, sum per district")


def glw4():
    api = "https://storage.googleapis.com/storage/v1/b/fao-gismgr-glw4-2020-data/o?prefix=DATA/GLW4-2020/MAPSET/N-DA-10KM/"
    items = requests.get(api, headers=UA, timeout=120).json().get("items", [])
    tifs = [i["name"] for i in items if i["name"].endswith(".tif")]
    frames = []
    for name in tifs:
        url = f"https://storage.googleapis.com/fao-gismgr-glw4-2020-data/{name}"
        path = fetch(url, Path(name).name)
        species = Path(name).stem.split(".")[-1].lower()
        frames.append(zonal(path, ["sum"], f"livestock_{species}").set_index("adm2_pcode"))
        record(f"GLW4 2020 10 km {species}", url, "CC BY 4.0 (FAO catalogue record)", path, "ok", "head per district")
    if frames:
        base_table().merge(pd.concat(frames, axis=1).reset_index(), on="adm2_pcode", how="left").to_csv(OUT / "exposure_livestock_glw4_2020.csv", index=False)


# --- Hazard ----------------------------------------------------------------

def chirps_gefs():
    base = "https://data.chc.ucsb.edu/products/CHIRPS-GEFS/v3/15_day/global/data/"
    year = listing(base, r'href="(\d{4})/"')[-1]
    files = listing(f"{base}{year}/", r'href="(c3g_[0-9.]+\.tif)"')
    url = f"{base}{year}/{files[-1]}"
    path = fetch(url, files[-1])
    df = base_table().merge(zonal(path, ["mean", "max"], "rain_15day_mm"), on="adm2_pcode")
    df.insert(3, "forecast_file", files[-1])
    df.to_csv(OUT / "hazard_rainfall_forecast_chirps_gefs_15day.csv", index=False)
    record("CHIRPS-GEFS v3 15-day forecast", url, "CC BY 4.0 / public domain (CHC)", path, "ok", "mean and max per district")


def ecmwf_exceedance():
    for back in range(0, 3):
        day = (TODAY - dt.timedelta(days=back)).strftime("%Y%m%d")
        base = f"https://data.ecmwf.int/forecasts/{day}/00z/ifs/0p25/enfo/{day}000000-240h-enfo-ep"
        r = requests.get(base + ".index", headers=UA, timeout=120)
        if r.status_code == 200:
            break
    else:
        raise RuntimeError("no ECMWF ep index in the last 3 days")
    entries = [json.loads(line) for line in r.text.splitlines() if line.strip()]
    wanted = [e for e in entries if str(e.get("param", "")).startswith("tpg")]
    path = RAW / f"ecmwf_{day}_tpg.grib2"
    with open(path, "wb") as f:
        for e in wanted:
            off, ln = int(e["_offset"]), int(e["_length"])
            part = requests.get(base + ".grib2", headers={**UA, "Range": f"bytes={off}-{off + ln - 1}"}, timeout=300)
            part.raise_for_status()
            f.write(part.content)
    with rasterio.open(path) as src:
        labels = [(src.tags(b).get("GRIB_ELEMENT") or f"band{b}").lower() for b in range(1, src.count + 1)]
    stats = zonal(path, ["mean", "max"], "tpg")
    frames = [stats.set_index("adm2_pcode")]
    df = base_table().merge(pd.concat(frames, axis=1).reset_index(), on="adm2_pcode", how="left")
    df.insert(3, "run", f"{day} 00z")
    df.insert(4, "bands", "|".join(labels))
    df.to_csv(OUT / "hazard_rainfall_exceedance_ecmwf.csv", index=False)
    record("ECMWF IFS ensemble rainfall exceedance probabilities (tpg*)", base + ".grib2", "CC BY 4.0", path, "ok", f"{len(wanted)} messages from run {day} 00z")


def gdo(folder: str, prefix: str, out: str, source: str):
    base = f"https://drought.emergency.copernicus.eu/data/Drought_Observatories_datasets/{folder}/ver3-0-0/"
    files = listing(base, rf'href="({prefix}[^"]+\.nc)"')
    url = base + files[-1]
    path = fetch(url, files[-1])
    import xarray as xr

    ds = xr.open_dataset(path)
    var = next(v for v in ds.data_vars if ds[v].ndim >= 2)
    da = ds[var]
    if "time" in da.dims:
        da = da.isel(time=-1)
        when = str(ds["time"].values[-1])[:10]
    else:
        when = ""
    lat = next(d for d in da.dims if d.lower().startswith("lat"))
    lon = next(d for d in da.dims if d.lower().startswith("lon"))
    da = da.sel({lat: slice(BBOX[3], BBOX[1]) if da[lat][0] > da[lat][-1] else slice(BBOX[1], BBOX[3]), lon: slice(BBOX[0], BBOX[2])})
    tif = RAW / f"{prefix}latest.tif"
    lats, lons = da[lat].values, da[lon].values
    res_y, res_x = abs(lats[1] - lats[0]), abs(lons[1] - lons[0])
    arr = np.squeeze(da.values).astype("float32")
    if lats[0] < lats[-1]:
        arr = arr[::-1]
    transform = rasterio.transform.from_origin(lons.min() - res_x / 2, lats.max() + res_y / 2, res_x, res_y)
    with rasterio.open(tif, "w", driver="GTiff", height=arr.shape[0], width=arr.shape[1], count=1, dtype="float32", crs="EPSG:4326", transform=transform, nodata=np.nan) as dst:
        dst.write(arr, 1)
    df = base_table().merge(zonal(tif, ["mean", "min", "max"], var.lower()), on="adm2_pcode")
    df.insert(3, "date", when)
    df.to_csv(OUT / out, index=False)
    record(source, url, "CC BY 4.0 (Copernicus GDO)", path, "ok", f"variable {var}, last time step {when}")


def gdo_spi():
    gdo("GDO_CHIRPS_Standardized_Precipitation_Index_SPI3", "spc03", "hazard_drought_spi3_gdo.csv", "GDO CHIRPS SPI-3")


def gdo_heat():
    gdo("GDO_ERA5_Warm_Spell_Intensity", "hwi", "hazard_heat_warm_spell_gdo.csv", "GDO ERA5 warm spell intensity")


def ibtracs():
    url = "https://www.ncei.noaa.gov/data/international-best-track-archive-for-climate-stewardship-ibtracs/v04r01/access/csv/ibtracs.SI.list.v04r01.csv"
    path = fetch(url, "ibtracs_SI.csv")
    df = pd.read_csv(path, skiprows=[1], low_memory=False, usecols=["SID", "SEASON", "NAME", "ISO_TIME", "LAT", "LON", "USA_WIND", "WMO_WIND"])
    df = df[(df.LON.between(BBOX[0], BBOX[2] + 3)) & (df.LAT.between(BBOX[1], BBOX[3])) & (pd.to_numeric(df.SEASON, errors="coerce") >= 1980)]
    pts = gpd.GeoDataFrame(df, geometry=gpd.points_from_xy(df.LON, df.LAT), crs=4326)
    hit = gpd.sjoin(pts, DISTRICTS[["adm2_pcode", "geometry"]], predicate="within")
    storms = hit.groupby("adm2_pcode").agg(storm_track_points=("SID", "size"), storms=("SID", "nunique"), last_season=("SEASON", "max")).reset_index()
    base_table().merge(storms, on="adm2_pcode", how="left").to_csv(OUT / "hazard_cyclone_tracks_ibtracs_since1980.csv", index=False)
    df.to_csv(OUT / "hazard_cyclone_track_points_ibtracs_moz_since1980.csv", index=False)
    record("IBTrACS v04r01 South Indian", url, "NOAA NCEI open access (no restriction stated)", path, "ok", f"{df.SID.nunique()} storms near Mozambique since 1980")


def inam_cap():
    url = "https://cap-sources.s3.amazonaws.com/mz-inam-pt/rss.xml"
    path = fetch(url, "inam_rss.xml")
    text = path.read_text(encoding="utf-8", errors="replace")
    items = re.findall(r"<item>(.*?)</item>", text, re.S)
    rows = []
    for it in items:
        get = lambda tag: (re.search(rf"<{tag}>(.*?)</{tag}>", it, re.S) or [None, ""])[1].strip()
        rows.append({"title": get("title"), "link": get("link"), "pubDate": get("pubDate")})
    pd.DataFrame(rows).to_csv(OUT / "hazard_warnings_inam_cap_feed.csv", index=False)
    record("INAM CAP feed (WMO register)", url, "Public domain (stated in the feed)", path, "ok", f"{len(rows)} items")


# --- Context ---------------------------------------------------------------

def ipc():
    res = hdx_resources("mozambique-acute-food-insecurity-country-data")
    r = next(x for x in res if "area_long" in (x.get("name") or "").lower() or "area_long" in (x.get("url") or "").lower())
    url = r.get("download_url") or r["url"]
    path = fetch(url, "ipc_moz_area_long.csv")
    df = pd.read_csv(path, low_memory=False)
    df.to_csv(OUT / "context_food_insecurity_ipc_moz.csv", index=False)
    record("IPC Mozambique area data (HDX)", url, "CC0", path, "ok", f"{len(df)} rows (areas are IPC analysis areas, not districts)")


def needs():
    res = hdx_resources("mozambique-humanitarian-needs")
    rows = []
    for r in res:
        url = r.get("download_url") or r["url"]
        if not url.lower().split("?")[0].endswith(".csv"):
            continue
        path = fetch(url, Path(url.split("?")[0]).name)
        df = pd.read_csv(path, low_memory=False)
        df["source_file"] = path.name
        rows.append(df)
        record("Mozambique humanitarian needs (HDX)", url, "CC0", path, "ok", f"{len(df)} rows")
    if rows:
        pd.concat(rows).to_csv(OUT / "context_humanitarian_needs_moz.csv", index=False)


def main():
    run(districts)
    run(districts_geoboundaries)
    if DISTRICTS is None:
        print("No districts; stopping")
    else:
        for step in (worldpop, grip4, facilities, schools, mapspam, glw4, chirps_gefs, ecmwf_exceedance, gdo_spi, gdo_heat, ibtracs, inam_cap):
            run(step)
    for step in (ipc, needs):
        run(step)
    with open(OUT / "manifest.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(MANIFEST[0].keys()) if MANIFEST else ["source"])
        w.writeheader()
        w.writerows(MANIFEST)
    failed = [m for m in MANIFEST if m["status"] != "ok"]
    print(f"done: {len(MANIFEST) - len(failed)} ok, {len(failed)} failed", flush=True)


if __name__ == "__main__":
    main()
