#!/usr/bin/env python3
"""Regenerate demo MODIS FIRMS-schema CSV for local prototyping without a MAP_KEY."""
import csv
import os
import random
from datetime import date, timedelta

random.seed(42)


def cluster_points(cx, cy, n, spread_lon, spread_lat):
    return [(cx + random.gauss(0, spread_lon), cy + random.gauss(0, spread_lat)) for _ in range(n)]


def clip(lon, lat):
    return max(-124.5, min(-66.5, lon)), max(24.5, min(49.5, lat))


def main():
    regions = []
    regions += cluster_points(-119, 37, 280, 2.2, 1.8)
    regions += cluster_points(-122, 45, 160, 1.5, 1.2)
    regions += cluster_points(-112, 46, 120, 2.0, 1.1)
    regions += cluster_points(-111, 39, 110, 1.8, 1.0)
    regions += cluster_points(-105, 35, 90, 2.5, 1.2)
    regions += cluster_points(-97, 35, 70, 2.2, 1.0)
    regions += cluster_points(-84, 33, 55, 1.2, 0.9)
    regions += cluster_points(-80, 40, 45, 1.0, 0.8)

    rows = []
    # Spread points across a much longer window so the timeline slider is not "one month only".
    date_start = date(2026, 1, 1)
    date_span_days = 364
    for i, (lon, lat) in enumerate(regions):
        lon, lat = clip(lon, lat)
        base = 305 + random.random() * 45
        frp = max(0.5, random.lognormvariate(1.2, 0.65))
        conf = random.choices([0, 25, 50, 75, 100], weights=[5, 10, 15, 35, 35])[0]
        offset = int((i / max(1, len(regions) - 1)) * date_span_days)
        acq_date = (date_start + timedelta(days=offset)).isoformat()
        hhmm = random.randint(0, 2359)
        acq_time = f"{hhmm:04d}"
        sat = random.choice(["Terra", "Aqua"])
        dn = random.choice(["D", "N"])
        rows.append(
            {
                "latitude": round(lat, 5),
                "longitude": round(lon, 5),
                "brightness": round(base, 2),
                "scan": round(random.uniform(0.3, 2.5), 2),
                "track": round(random.uniform(0.3, 2.0), 2),
                "acq_date": acq_date,
                "acq_time": acq_time,
                "satellite": sat,
                "instrument": "MODIS",
                "confidence": conf,
                "version": "6.1NRT",
                "bright_t31": round(base - random.uniform(10, 35), 2),
                "frp": round(frp, 2),
                "daynight": dn,
            }
        )

    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out = os.path.join(root, "data", "modis_fires_us.csv")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    print(f"Wrote {len(rows)} rows to {out}")


if __name__ == "__main__":
    main()
