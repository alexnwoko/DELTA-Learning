"""Seed raster tiles from a local TileServer GL into a z/x/y.png tree.

Usage: python3 seed_tiles.py BASE_URL OUT_DIR MINLON MINLAT MAXLON MAXLAT MAXZOOM [THREADS]
Skips tiles already written, so a stopped run can resume. Writes
sizes.tsv (z, x, y, bytes) and prints progress and a summary.
"""
import math, os, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

base, out = sys.argv[1], sys.argv[2]
minlon, minlat, maxlon, maxlat = map(float, sys.argv[3:7])
maxzoom = int(sys.argv[7])
threads = int(sys.argv[8]) if len(sys.argv) > 8 else 6

def tile(lon, lat, z):
    n = 2 ** z
    x = int((lon + 180) / 360 * n)
    y = int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)
    return min(max(x, 0), n - 1), min(max(y, 0), n - 1)

jobs = []
for z in range(0, maxzoom + 1):
    x0, y0 = tile(minlon, maxlat, z)
    x1, y1 = tile(maxlon, minlat, z)
    for x in range(x0, x1 + 1):
        for y in range(y0, y1 + 1):
            jobs.append((z, x, y))

def fetch(z, x, y):
    path = os.path.join(out, str(z), str(x), f"{y}.png")
    if os.path.exists(path):
        return z, x, y, os.path.getsize(path), True
    url = f"{base}/{z}/{x}/{y}.png"
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url, timeout=120) as r:
                body = r.read()
            break
        except Exception:
            if attempt == 2:
                raise
            time.sleep(2)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".part"
    with open(tmp, "wb") as f:
        f.write(body)
    os.replace(tmp, path)
    return z, x, y, len(body), False

start = time.time()
done = 0
sizes = []
with ThreadPoolExecutor(threads) as pool, open(os.path.join(out, "sizes.tsv"), "w") as log:
    futures = [pool.submit(fetch, *j) for j in jobs]
    for f in as_completed(futures):
        z, x, y, n, cached = f.result()
        sizes.append(n)
        log.write(f"{z}\t{x}\t{y}\t{n}\n")
        done += 1
        if done % 2000 == 0 or done == len(jobs):
            rate = done / max(time.time() - start, 1e-6)
            print(f"{done}/{len(jobs)} tiles, {rate:.1f}/s", flush=True)

sizes.sort()
p95 = sizes[int(len(sizes) * 0.95) - 1] if sizes else 0
print(f"DONE {len(sizes)} tiles in {time.time() - start:.0f}s; total {sum(sizes)/1e6:.1f} MB; "
      f"mean {sum(sizes)/max(len(sizes),1)/1e3:.1f} KB; p95 {p95/1e3:.1f} KB; max {sizes[-1]/1e3 if sizes else 0:.1f} KB; "
      f"over 60 KB: {sum(1 for s in sizes if s > 60000)}", flush=True)
