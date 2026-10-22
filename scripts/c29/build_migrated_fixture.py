#!/usr/bin/env python3
"""
C29 (solution pack): build the migrated-record fixture and its expected ledgers.

Reads (read-only):
  DV2/50_Data_Migration/_pilot_output/by_country/AGO/delta_ready.jsonl        (current Angola output)
  DV2/50_Data_Migration/_pilot_output/by_country/AGO/delta_ready_pre_hipcode_fix_*.jsonl  (GH0101 row)
  DV2/50_Data_Migration/_pilot_output/by_country/ECU/delta_ready.jsonl        (volcanic, C04 rows)
  DV2/50_Data_Migration/_scripts/delta_loader.py                             (imported, never edited)

Writes (under ~/DELTA):
  tests/fixtures/migrated/ago_fixture.jsonl         scrubbed, pseudonymised delta_ready rows
  tests/fixtures/migrated/ago_fixture_load.json     loader payloads per record + fixture divisions
  tests/fixtures/migrated/ago_fixture_ledger.json   expected ledger for the fixture
  tests/fixtures/migrated/ago_fixture_selection.csv how each row was chosen
  tests/fixtures/migrated/ago_realload_ledger.json  expected ledger for the full Angola load (exit gate)

The expected ledgers use the loader's own he_measure_state and compute_plausibility_flags (the
Backend Migration functions), so the fixture cannot drift from what the loader writes. Record
payloads come from build_disaster_record_payload and human_effects_jobs, with the division and
HIPs ids left for the test to resolve against its database.

Usage:  python3 scripts/c29/build_migrated_fixture.py [--dv2 <path to DELTA_Version_2>]
"""

from __future__ import annotations

import argparse
import csv
import glob
import hashlib
import json
import os
import sys
import uuid
from collections import defaultdict
from pathlib import Path

DEFAULT_DV2 = (Path.home() / "Library/CloudStorage/OneDrive-UnitedNations/Documents/My DELTA/"
               "DELTA_Product_Development/DELTA_Version_2")
REPO = Path(__file__).resolve().parents[2]
OUT = REPO / "tests" / "fixtures" / "migrated"

FIXTURE_RUN_ID = "c29-fixture-v1"
FIXTURE_LOADED_AT = "2026-09-30T00:00:00"
MEASURES = ["deaths", "injured", "missing", "displaced", "affected_direct", "affected_indirect"]
# DEC-008 source fields per measure, as in ~/DELTA app/utils/plausibility.ts.
MEASURE_FIELDS = {
    "deaths": ["muertos"], "injured": ["heridos"], "missing": ["desaparece"],
    "affected_direct": ["damnificados"], "affected_indirect": ["afectados"],
    "displaced": ["evacuados", "reubicados"],
}
# Provisional V-5 coverage rule, as in ~/DELTA app/utils/valueState.ts PROVISIONAL_ZERO_COVERAGE.
COVERAGE_MIN_SHARE = 0.25
COVERAGE_MIN_RECORDS = 1

# C07 scrub: free-text and collector fields. Numbers, codes, dates and admin names stay.
SCRUB_TOP = ["location_desc", "data_collector", "primary_data_source", "glide"]
SCRUB_LEGACY = ["lugar", "otros", "fuentes", "fechapor", "causa", "descausa", "di_comments",
                "magnitud2", "glide", "clave"]
REMOVED = "[removed, C07 scrub]"
# Keys whose string values are controlled vocabulary or codes, not free text.
SAFE_STRING_KEYS = {
    "api_import_id", "country_iso3", "national_disaster_id", "other_id_desinventar", "source_uuid",
    "admin1_name", "admin2_name", "admin3_name", "admin1_pcode", "admin2_pcode", "admin3_pcode",
    "start_date", "source_event", "matched_term", "hip_hazard_id", "hip_hazard_name", "hip_cluster",
    "hip_type", "confidence_grade", "match_method", "match_score", "review_flag", "decision_ref",
    "bucket", "grade", "method", "matched_code", "matched_name", "sfm_indicator", "field",
    "desinventar_en_label", "definition_source", "confidence", "note", "displaced_subtype",
    "delta_timing", "delta_duration", "sector", "flag_field", "asset", "unit", "source_field",
    "migration_status", "serial", "level0", "level1", "level2", "name0", "name1", "name2", "evento",
    "uu_id", "fechafec", "c29_note", "c29_cluster_of",
}


def load_loader(dv2: Path):
    sys.dont_write_bytecode = True           # import read-only: no __pycache__ in the DV2 tree
    sys.path.insert(0, str(dv2 / "50_Data_Migration" / "_scripts"))
    import delta_loader as L                 # noqa: E402  (Backend Migration's module, not edited)
    data = dv2 / "50_Data_Migration" / "_data"
    L.NATIONAL_POP = L.load_national_pop(data / "national_population.csv")
    L.ADMIN_POP = L.load_admin_pop(data / "admin_unit_population.csv")
    return L


def read_jsonl(path: Path, pred=None, limit=None):
    out = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            r = json.loads(line)
            if pred is None or pred(r):
                out.append(r)
                if limit and len(out) >= limit:
                    break
    return out


def serial_key(r):
    s = str((r.get("legacy_data") or {}).get("serial") or r["api_import_id"])
    return (0, int(s)) if s.isdigit() else (1, s)


def he_state(L, row, m):
    return L.he_measure_state((row.get("human_effects") or {}).get(m))


def flagged_measures(L, row):
    fields = {f for fl in L.compute_plausibility_flags(row) for f in fl.get("fields", [])}
    return {m for m, fs in MEASURE_FIELDS.items() if fields & set(fs)}


# ------------------------------------------------------------------------------------------
# Selection
# ------------------------------------------------------------------------------------------
def select_rows(L, ago, ago_prefix, ecu_rows):
    chosen = []          # (row, stratum, rule, source_file)
    taken = set()

    def take(row, stratum, rule, src="AGO delta_ready.jsonl"):
        taken.add(row["api_import_id"])
        chosen.append((row, stratum, rule, src))

    def is_benguela(r):
        return (r.get("admin1_name") or "") == "Benguela"

    def first(pred, stratum, rule, allow_benguela=False):
        for r in sorted(ago, key=serial_key):
            if r["api_import_id"] in taken or (is_benguela(r) and not allow_benguela):
                continue
            if pred(r):
                take(r, stratum, rule)
                return r
        raise SystemExit(f"no Angola row for stratum {stratum}")

    # 1. The insufficient_reporting municipality: every Benguela / Lobito record (9). No other
    #    other Benguela record enters the fixture except the C30 stratum below, so the level-1
    #    (province) aggregate is Lobito plus at most that record.
    lob = [r for r in sorted(ago, key=serial_key)
           if is_benguela(r) and (r.get("admin2_name") or "") == "Lobito"]
    assert len(lob) == 9, len(lob)
    for r in lob:
        take(r, "lobito_municipality", "every Benguela / Lobito record (missing: 1 confirmed zero of 9)")

    # 2. Not reported: no measure reported at all (outside Benguela as well).
    first(lambda r: all(he_state(L, r, m) == "not_reported" for m in MEASURES),
          "not_reported_all", "first record with all six measures not reported")
    # 3. Confirmed zero with the flag set and an explicit 0, one per measure.
    for m in MEASURES:
        if any(he_state(L, r, m) == "zero_confirmed" for r, *_ in chosen):
            continue
        first(lambda r, m=m: he_state(L, r, m) == "zero_confirmed",
              f"zero_confirmed_{m}", f"first record with {m} zero_confirmed (flag set, explicit 0)")
    # 4. Affected: indirect only, direct only.
    first(lambda r: he_state(L, r, "affected_indirect") == "reported"
          and he_state(L, r, "affected_direct") == "not_reported",
          "affected_indirect_only", "first record: affected_indirect reported, affected_direct not reported")
    first(lambda r: he_state(L, r, "affected_direct") == "reported"
          and he_state(L, r, "affected_indirect") == "not_reported",
          "affected_direct_only", "first record: affected_direct reported, affected_indirect not reported")
    # 5. GEO grades A to D and U.
    for g in ["A", "B", "C", "D", "U"]:
        first(lambda r, g=g: (r.get("geolocation") or {}).get("grade") == g,
              f"geo_grade_{g}", f"first record with geolocation grade {g}")
    # 6. Dates: year only, year-month, and a date that loads as NULL (review precision).
    for prec, label in (("year", "year only (YYYY-00-00)"), ("month", "year-month (YYYY-MM-00)"),
                        ("review", "invalid calendar date, loads as NULL")):
        first(lambda r, p=prec: L.normalise_start_date(r.get("start_date"))[1] == p,
              f"date_{prec}", f"first record with start date {label}")
    # 7. Unmatched hazard.
    first(lambda r: (r.get("hazard") or {}).get("bucket") == "UNMATCHED_HAZARD",
          "hazard_unmatched", "first UNMATCHED_HAZARD record (loads unclassified)")
    # 8. Earthquake: one current GH0201, and one card as it stood before the hip-code fix (GH0101),
    #    corrected at load by the loader's apply_geo_code_fix (DEC-004).
    first(lambda r: (r.get("hazard") or {}).get("hip_hazard_id") == "GH0201",
          "hazard_earthquake_current", "first Earthquake record (GH0201 in the current output)")
    stale = [r for r in sorted(ago_prefix, key=serial_key)
             if (r.get("hazard") or {}).get("hip_hazard_id") == "GH0101"
             and r["api_import_id"] not in taken and not is_benguela(r)]
    assert stale, "no GH0101 row in the pre-fix file"
    take(stale[0], "hazard_gh0101_to_gh0201",
         "first Earthquake card in the pre-hip-code-fix file (GH0101), corrected to GH0201 at load",
         "AGO delta_ready_pre_hipcode_fix_*.jsonl")
    # 9. One record per C30 flag code present in Angola.
    codes = sorted({f["code"] for r in ago for f in L.compute_plausibility_flags(r)})
    for code in codes:
        if any(code in {f["code"] for f in L.compute_plausibility_flags(r)} for r, *_ in chosen):
            continue
        # Angola's only SENTINEL_MAGNITUDE record sits in Benguela municipality, so this stratum
        # may take a Benguela record (the province then holds Lobito plus this one record).
        first(lambda r, c=code: c in {f["code"] for f in L.compute_plausibility_flags(r)},
              f"c30_{code}", f"first record carrying C30 flag {code}", allow_benguela=True)

    # 10. ECU: two volcanic records (no volcanic code exists in Angola) and one C04 case.
    for code, kw, stratum in (("GH0201", "lava", "volcanic_lava_ecu"),
                              ("GH0204", "lahar", "volcanic_lahar_ecu")):
        cands = [r for r in ecu_rows if (r.get("hazard") or {}).get("hip_hazard_id") == code
                 and kw in str((r.get("hazard") or {}).get("hip_hazard_name") or "").lower()]
        take(sorted(cands, key=lambda r: r["api_import_id"])[0], stratum,
             f"first ECU record by id with {code} ({kw}); corrected at load by apply_geo_code_fix",
             "ECU delta_ready.jsonl")
    c04 = [r for r in ecu_rows if r.get("c29_c04")]
    take(sorted(c04, key=lambda r: r["api_import_id"])[0], "c04_ticked_blank_ecu",
         "first ECU record by id with a ticked flag and a blank source value (C04: not_reported)",
         "ECU delta_ready.jsonl")
    return chosen


def synthetic_rows(base_row):
    """Two SYNTHETIC rows the migration cannot produce, built on a copy of an Angola card with its
    measures reset. They are labelled SYNTHETIC in their ids, legacy_data and the selection table."""
    def blank(row, sid):
        r = json.loads(json.dumps(row))
        r["api_import_id"] = sid
        for m, cat in (r.get("human_effects") or {}).items():
            cat["total"] = 0
            cat["present"] = False
            for s in cat.get("sources") or []:
                s["value"] = 0
                s["presence_flag"] = False
        for f in ("muertos", "heridos", "desaparece", "afectados", "damnificados", "evacuados",
                  "reubicados", "vivdest", "vivafec"):
            r["legacy_data"][f] = "0"
        for k in list(r["legacy_data"]):
            if k.startswith("hay_"):
                r["legacy_data"][k] = "0"
        r["sector_damage"] = []
        r["sectors_affected"] = []
        return r

    native = blank(base_row, "SYNTHETIC:native-no")
    native["legacy_data"]["c29_note"] = "SYNTHETIC native DELTA entry: Deaths answered No, no count"
    native["c29_native_presence"] = {"Deaths": {"deaths": False}}

    cluster = blank(base_row, "SYNTHETIC:cluster-only-volcanic")
    cluster["hazard"] = {"source_event": "ACTIVIDAD VOLCANICA", "matched_term": "", "hip_hazard_id": "",
                         "hip_hazard_name": "", "hip_cluster": "", "hip_type": "",
                         "confidence_grade": "U", "match_method": "synthetic", "match_score": "0",
                         "review_flag": "CLUSTER_ONLY", "decision_ref": "C13", "bucket": "CLUSTER_ONLY"}
    cluster["legacy_data"]["c29_note"] = ("SYNTHETIC cluster-only outcome (C13 not built): the volcanic "
                                          "cluster of GH0202, no specific hazard")
    cluster["c29_cluster_of"] = "GH0202"
    cluster["human_effects"]["affected_indirect"]["total"] = 40
    cluster["human_effects"]["affected_indirect"]["present"] = True
    cluster["human_effects"]["affected_indirect"]["sources"][0]["value"] = 40
    cluster["human_effects"]["affected_indirect"]["sources"][0]["presence_flag"] = True
    cluster["legacy_data"]["afectados"] = "40"
    cluster["legacy_data"]["hay_afectados"] = "-1"
    return [(native, "native_no_synthetic", "SYNTHETIC: native DELTA 'No' for deaths (OP-33 option a)",
             "synthetic"),
            (cluster, "cluster_only_synthetic", "SYNTHETIC: volcanic cluster-only hazard (C13 outcome)",
             "synthetic")]


# ------------------------------------------------------------------------------------------
# C07 scrub and pseudonymisation
# ------------------------------------------------------------------------------------------
def pseudonym(prefix: str, n: int) -> str:
    return f"C29FIX:{prefix}:{n:03d}"


def scrub(row: dict, fid: str) -> dict:
    r = json.loads(json.dumps(row))
    r.pop("c29_c04", None)
    src_id = r["api_import_id"]
    r["api_import_id"] = fid
    for k in ("national_disaster_id", "other_id_desinventar"):
        if r.get(k):
            r[k] = fid.rsplit(":", 1)[1]
    if r.get("source_uuid"):
        r["source_uuid"] = str(uuid.uuid5(uuid.NAMESPACE_URL, "c29:" + src_id))
    for k in SCRUB_TOP:
        if r.get(k):
            r[k] = REMOVED if k != "glide" else ""
    geo = r.get("geolocation") or {}
    for k in ("lon", "lat"):
        if isinstance(geo.get(k), (int, float)):
            geo[k] = round(geo[k], 2)
    ld = r.get("legacy_data") or {}
    for k in SCRUB_LEGACY:
        if ld.get(k):
            ld[k] = REMOVED if k not in ("glide", "clave") else ""
    if ld.get("serial"):
        ld["serial"] = fid.rsplit(":", 1)[1]
    if ld.get("uu_id"):
        ld["uu_id"] = r.get("source_uuid") or ""
    for k in ("latitude", "longitude"):
        try:
            ld[k] = str(round(float(ld[k]), 2))
        except (KeyError, TypeError, ValueError):
            pass
    ext = r.get("ext_unmapped_fields") or {}
    for k in list(ext):
        ext[k] = REMOVED
    return r


def free_text_left(obj, path=""):
    """C07 named-entity check: every string value left must sit under a known code or vocabulary key
    or be the scrub marker. Returns the offending paths (empty means the check passes)."""
    bad = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            if isinstance(v, str):
                if v and v != REMOVED and k not in SAFE_STRING_KEYS and not k.startswith("hay_") \
                        and not v.replace(".", "", 1).replace("-", "", 1).isdigit():
                    bad.append(f"{path}.{k}={v[:40]}")
            else:
                bad.extend(free_text_left(v, f"{path}.{k}"))
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            bad.extend(free_text_left(v, f"{path}[{i}]"))
    return bad


# ------------------------------------------------------------------------------------------
# Ledgers
# ------------------------------------------------------------------------------------------
def value_state(reported, zero, total):
    if reported > 0:
        return "reported"
    if zero > 0:
        share = zero / total if total else 0
        if share < COVERAGE_MIN_SHARE or zero < COVERAGE_MIN_RECORDS:
            return "insufficient_reporting"
        return "zero_confirmed"
    return "not_reported"


def measure_ledger(L, rows, native_zero=None, native_records=0):
    """Per measure: sum, record counts by state, flagged count and the national value state.
    native_zero: {measure: count} of native explicit-No records (OP-33 option a: zero_confirmed)."""
    native_zero = native_zero or {}
    out = {}
    for m in MEASURES:
        rep = zero = nrep = flagged = 0
        s = 0
        for r in rows:
            st = he_state(L, r, m)
            if st == "reported":
                rep += 1
                s += L._int_or_none((r["human_effects"].get(m) or {}).get("total")) or 0
            elif st == "zero_confirmed":
                zero += 1
            else:
                nrep += 1
            if m in flagged_measures(L, r):
                flagged += 1
        # Native explicit-No records: zero_confirmed on the answered measure, not reported on the rest.
        zero += native_zero.get(m, 0)
        nrep += native_records - native_zero.get(m, 0)
        total = rep + zero + nrep
        out[m] = {"sum": s if rep else None, "reported": rep, "zero_confirmed": zero,
                  "not_reported": nrep, "records_total": total, "flagged": flagged,
                  "value_state": value_state(rep, zero, total)}
    return out


def deaths_by_level1(L, rows_with_div, native_ids):
    groups = defaultdict(list)
    for r, level1 in rows_with_div:
        groups[level1].append(r)
    out = {}
    for level1, rs in sorted(groups.items()):
        rep = zero = flagged = 0
        s = 0
        for r in rs:
            st = he_state(L, r, "deaths")
            if r["api_import_id"] in native_ids:
                st = "zero_confirmed"
            if st == "reported":
                rep += 1
                s += L._int_or_none(r["human_effects"]["deaths"]["total"]) or 0
            elif st == "zero_confirmed":
                zero += 1
            if "deaths" in flagged_measures(L, r):
                flagged += 1
        out[level1] = {"sum": s if rep else None, "reported": rep, "zero_confirmed": zero,
                       "records_total": len(rs), "flagged": flagged,
                       "value_state": value_state(rep, zero, len(rs))}
    return out


# ------------------------------------------------------------------------------------------
def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--dv2", default=os.environ.get("DV2", str(DEFAULT_DV2)))
    args = ap.parse_args(argv)
    dv2 = Path(args.dv2)
    L = load_loader(dv2)
    base = dv2 / "50_Data_Migration" / "_pilot_output" / "by_country"

    ago = read_jsonl(base / "AGO" / "delta_ready.jsonl")
    prefix_file = sorted(glob.glob(str(base / "AGO" / "delta_ready_pre_hipcode_fix_*.jsonl")))[-1]
    ago_prefix = read_jsonl(Path(prefix_file))

    # ECU is 400 MB: stream it and keep only candidate rows.
    def ecu_pred(r):
        h = r.get("hazard") or {}
        name = str(h.get("hip_hazard_name") or "").lower()
        if (h.get("hip_hazard_id") == "GH0201" and "lava" in name) or \
                (h.get("hip_hazard_id") == "GH0204" and "lahar" in name):
            return True
        for c in (r.get("human_effects") or {}).values():
            if c.get("present") is True and not (c.get("total") or 0) and \
                    any(s.get("value") in (None, "") for s in c.get("sources") or []):
                r["c29_c04"] = True
                return True
        return False
    ecu_rows = read_jsonl(base / "ECU" / "delta_ready.jsonl", ecu_pred)

    chosen = select_rows(L, ago, ago_prefix, ecu_rows)
    luanda = next(r for r in sorted(ago, key=serial_key)
                  if r.get("admin1_name") == "Luanda" and r.get("admin3_pcode"))
    chosen.extend(synthetic_rows(luanda))

    # Pseudonymise and scrub.
    fixture, selection = [], []
    for i, (row, stratum, rule, src) in enumerate(chosen, 1):
        iso = (row.get("country_iso3") or "ago").lower()
        fid = pseudonym("syn" if src == "synthetic" else iso, i)
        clean = scrub(row, fid)
        left = free_text_left(clean)
        if left:
            raise SystemExit(f"C07 scrub check failed for {fid}: {left[:5]}")
        fixture.append(clean)
        selection.append({
            "fixture_id": fid, "stratum": stratum, "rule": rule, "source_file": src,
            "source_id": row["api_import_id"], "admin1": row.get("admin1_name") or "",
            "admin2": row.get("admin2_name") or "",
            "geo_grade": (row.get("geolocation") or {}).get("grade") or "",
            "hip_code_source": (row.get("hazard") or {}).get("hip_hazard_id") or "",
            "start_date": row.get("start_date") or "",
            "c30_flags": ";".join(sorted({f["code"] for f in L.compute_plausibility_flags(row)})),
            "synthetic": "yes" if src == "synthetic" else "no",
        })

    # Fixture divisions: the Angola admin tree under the fixture rows. Geometry is a small synthetic
    # square per division; the analytics under test read the tree, not the shapes.
    divisions = {}
    for r in fixture:
        if r["country_iso3"].lower() != "ago":
            continue
        parent = None
        for lvl in (1, 2, 3):
            pc, nm = r.get(f"admin{lvl}_pcode"), r.get(f"admin{lvl}_name")
            if not pc:
                break
            divisions.setdefault(pc, {"importId": pc, "parentImportId": parent, "level": lvl,
                                      "name": nm})
            parent = pc

    run_stamp = {"run_id": FIXTURE_RUN_ID, "register_version": L._decision_register_version(),
                 "loaded_at": FIXTURE_LOADED_AT}
    records, rows_with_div, native_ids = [], [], set()
    for r in fixture:
        is_ago = r["country_iso3"].lower() == "ago"
        div_import = None
        if is_ago:
            for k in ("admin3_pcode", "admin2_pcode", "admin1_pcode"):
                if r.get(k) and r[k] in divisions:
                    div_import = r[k]
                    break
        haz = r.get("hazard") or {}
        code = (haz.get("hip_hazard_id") or "").strip()
        code = L.apply_geo_code_fix(r, code) if code else ""
        payload = L.build_disaster_record_payload(r, "__DIVISION__" if div_import else None,
                                                  None, run_stamp)
        if div_import:
            payload["spatialFootprint"][0]["id"] = str(uuid.uuid5(uuid.NAMESPACE_URL,
                                                                  "c29-footprint:" + r["api_import_id"]))
        jobs = L.human_effects_jobs(r)
        native = r.pop("c29_native_presence", None)
        if native:
            native_ids.add(r["api_import_id"])
            jobs = [{"table": t, "columns": L.HE_TABLES[t], "presence": p, "has_data": False,
                     "body": None} for t, p in native.items()]
        cluster_of = r.pop("c29_cluster_of", None)
        records.append({
            "apiImportId": r["api_import_id"],
            "hipCode": code or None,
            "hipClusterOfCode": cluster_of,
            "divisionImportId": div_import,
            "payload": payload,
            "humanEffects": [{"table": j["table"], "presence": j["presence"],
                              "hasData": j["has_data"], "body": j["body"]} for j in jobs],
        })
        if div_import:
            rows_with_div.append((r, r["admin1_pcode"]))

    native_zero = {"deaths": len(native_ids)}
    migrated = [r for r in fixture if r["api_import_id"] not in native_ids]
    ledger = measure_ledger(L, migrated, native_zero, len(native_ids))
    lobito_rows = [r for r in fixture if r.get("admin2_name") == "Lobito"]
    benguela_pcode = lobito_rows[0]["admin1_pcode"]
    fixture_ledger = {
        "generated_by": "scripts/c29/build_migrated_fixture.py",
        "ledger_functions": "delta_loader.he_measure_state, delta_loader.compute_plausibility_flags "
                            "(Backend Migration; imported read-only)",
        "run_id": FIXTURE_RUN_ID,
        "records": len(fixture),
        "records_with_division": len(rows_with_div),
        "coverage_rule": {"min_share": COVERAGE_MIN_SHARE, "min_records": COVERAGE_MIN_RECORDS},
        "native_rule": "a native explicit No counts as zero_confirmed (grading standard OP-33 option a, "
                       "the analytics rule); the loader never writes one",
        "national": ledger,
        "deaths_by_level1": deaths_by_level1(L, rows_with_div, native_ids),
        "benguela_lobito": {"level2_import_id": lobito_rows[0]["admin2_pcode"],
                            "measures": measure_ledger(L, lobito_rows)},
        "benguela_province": {"level1_import_id": benguela_pcode,
                              "measures": measure_ledger(
                                  L, [r for r in fixture if r.get("admin1_pcode") == benguela_pcode
                                      and r["country_iso3"].lower() == "ago"])},
        "flag_codes": sorted({f["code"] for r in fixture for f in L.compute_plausibility_flags(r)}),
        "records_flagged": sum(1 for r in fixture if L.compute_plausibility_flags(r)),
    }

    # Exit-gate ledger: the full Angola output, same functions.
    run_ids = json.load(open(base / "AGO" / "load_manifest_ago_load.json", encoding="utf-8"))
    real_ledger = {
        "generated_by": "scripts/c29/build_migrated_fixture.py",
        "ledger_functions": fixture_ledger["ledger_functions"],
        "source": "50_Data_Migration/_pilot_output/by_country/AGO/delta_ready.jsonl",
        "tenant": "31038250-8612-489a-a7a2-47921321e9ef",
        "run_id": run_ids["run_id"],
        "records": len(ago),
        "records_flagged": sum(1 for r in ago if L.compute_plausibility_flags(r)),
        "manifest_measure_ledger": {m: run_ids["measure_ledger"][m] for m in MEASURES},
        "national": measure_ledger(L, ago),
    }
    for m in MEASURES:
        mine = real_ledger["national"][m]
        man = real_ledger["manifest_measure_ledger"][m]
        assert (mine["reported"], mine["zero_confirmed"], mine["not_reported"]) == \
            (man["reported"], man["zero_confirmed"], man["not_reported"]), (m, mine, man)

    OUT.mkdir(parents=True, exist_ok=True)
    with open(OUT / "ago_fixture.jsonl", "w", encoding="utf-8") as f:
        for r in fixture:
            f.write(json.dumps(r, ensure_ascii=False, sort_keys=True) + "\n")
    with open(OUT / "ago_fixture_load.json", "w", encoding="utf-8") as f:
        json.dump({"runId": FIXTURE_RUN_ID, "divisions": list(divisions.values()),
                   "records": records}, f, ensure_ascii=False, indent=1, sort_keys=True)
        f.write("\n")
    for name, obj in (("ago_fixture_ledger.json", fixture_ledger),
                      ("ago_realload_ledger.json", real_ledger)):
        with open(OUT / name, "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False, indent=1, sort_keys=True)
            f.write("\n")
    with open(OUT / "ago_fixture_selection.csv", "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(selection[0].keys()), lineterminator="\n")
        w.writeheader()
        w.writerows(selection)
    digest = hashlib.sha1((OUT / "ago_fixture.jsonl").read_bytes()).hexdigest()[:10]
    print(f"fixture: {len(fixture)} records, {len(divisions)} divisions, sha1 {digest}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
