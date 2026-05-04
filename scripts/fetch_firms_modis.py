#!/usr/bin/env python3
"""
Download NASA FIRMS MODIS_NRT hotspot CSV for the contiguous US using your free MAP_KEY.

Sign up: https://firms.modaps.eosdis.nasa.gov/api/map_key

Usage:
  export FIRMS_MAP_KEY='your_key'
  python3 scripts/fetch_firms_modis.py

Writes: data/modis_fires_us.csv (overwrites demo bundle)

Bounding box (lon_min, lat_min, lon_max, lat_max) matches FIRMS /api/area/csv docs.
"""
import os
import sys
import urllib.request

# CONUS approximate extent
LON_MIN, LAT_MIN, LON_MAX, LAT_MAX = -125.0, 24.0, -66.0, 49.5
DAY_RANGE = 10
SOURCE = "MODIS_NRT"
AREA = f"{LON_MIN},{LAT_MIN},{LON_MAX},{LAT_MAX}"


def main():
    key = os.environ.get("FIRMS_MAP_KEY")
    if not key:
        print("Set FIRMS_MAP_KEY in your environment.", file=sys.stderr)
        sys.exit(1)
    url = f"https://firms.modaps.eosdis.nasa.gov/api/area/csv/{key}/{SOURCE}/{AREA}/{DAY_RANGE}"
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out = os.path.join(root, "data", "modis_fires_us.csv")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    print("GET", url.split(key)[0] + "<MAP_KEY>/" + "/".join(url.split("/")[6:]))
    with urllib.request.urlopen(url, timeout=120) as resp:
        body = resp.read()
    with open(out, "wb") as f:
        f.write(body)
    print(f"Saved {len(body)} bytes to {out}")


if __name__ == "__main__":
    main()
