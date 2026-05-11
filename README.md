# U.S. MODIS wildfire hotspots (DSC 106 — Interactive visualization)

**Course:** DSC 106 (UC San Diego) — Project 3: interactive exploration of NASA MODIS / FIRMS thermal anomalies.

**Live site (GitHub Pages):** [https://shreybe.github.io/A-Song-of-Ice-and-Fire/](https://shreybe.github.io/A-Song-of-Ice-and-Fire/)

## What’s in this repo

- **`index.html`** — Full-screen D3 map + filters + details-on-demand, and the **required write-up** (design rationale, data transformations, exploratory figures, development process).
- **`js/main.js`** — D3 projection, zoom, filtering, SVG basemap + canvas points.
- **`js/fire-data.js`** — Optional embedded CSV mirror for static hosting (generated from `data/modis_fires_us.csv`).
- **`data/modis_fires_us.csv`** — Bundled CONUS hotspot subset for the prototype.
- **`scripts/`** — `fetch_firms_modis.py` (refresh from FIRMS API with `FIRMS_MAP_KEY`) and `generate_demo_modis_csv.py` (demo generator).
- **`graphs/`** — Static exploratory figures referenced in the write-up.

## Stack (assignment constraints)

- **D3 v7** + **topojson-client** only for the interactive graphic.
- No Plotly, Vega-Lite, or other disallowed plotting stacks on the submission page.

## Local preview

```bash
cd "$(dirname "$0")"
python3 -m http.server 8080
```

Open `http://localhost:8080/`.

## Data

NASA FIRMS MODIS near-real-time hotspots. Product overview: [FIRMS](https://firms.modaps.eosdis.nasa.gov/).  
Refresh instructions are in `scripts/fetch_firms_modis.py`.

## GitHub Pages

Repository must be **Public**. Pages: **Settings → Pages → Branch `main` / (root)**.  
A `.nojekyll` file is included so Jekyll does not strip underscored paths.
