/**
 * DSC 106 Project 3 — MODIS / FIRMS hotspot explorer (SVG basemap + canvas hotspots).
 */
(function () {
  const MAP_BASE = { width: 2800, height: 1520 };

  const parseDate = d3.timeParse("%Y-%m-%d");
  const fmtDate = d3.timeFormat("%b %-d, %Y");
  const fmtShort = d3.timeFormat("%b %-d");

  const state = {
    raw: [],
    dates: [],
    geo: null,
    projection: null,
    path: null,
    mapSizeKey: "",
    zoomTransform: d3.zoomIdentity,
    firesFiltered: [],
    firesProjected: [],
    selected: null,
    zoomBehavior: null,
    rScale: null,
    maxFrp: 1,
    allowDay: true,
    allowNight: true,
    minConf: 0,
    minDateIdx: 0,
    maxDateIdx: 0,
    /** Creative extension: optional crosshair on max-FRP point in filtered set */
    showPeakHighlight: false,
  };

  /** @type {CanvasRenderingContext2D | null} */
  let ctx = null;
  let zoomRaf = null;

  function regionLabel(lon) {
    if (lon < -102) return "West";
    if (lon < -88) return "Central";
    return "East";
  }

  function applyFilters(data) {
    const dmin = state.dates[state.minDateIdx];
    const dmax = state.dates[state.maxDateIdx];
    return data.filter((d) => {
      if (d.acq_date < dmin || d.acq_date > dmax) return false;
      if (d.confidence < state.minConf) return false;
      if (d.daynight === "D" && !state.allowDay) return false;
      if (d.daynight === "N" && !state.allowNight) return false;
      return true;
    });
  }

  /** Same as applyFilters but omit date window — drives the linked activity strip. */
  function applyFiltersNoDateRange(data) {
    return data.filter((d) => {
      if (d.confidence < state.minConf) return false;
      if (d.daynight === "D" && !state.allowDay) return false;
      if (d.daynight === "N" && !state.allowNight) return false;
      return true;
    });
  }

  function dailyCountsForTimeline() {
    const rows = applyFiltersNoDateRange(state.raw);
    const byDay = d3.rollup(rows, (v) => v.length, (d) => d.acq_date.getTime());
    return state.dates.map((d) => byDay.get(d.getTime()) || 0);
  }

  function drawActivityTimeline() {
    const host = document.getElementById("timeline-host");
    const svgEl = document.getElementById("timeline-svg");
    if (!host || !svgEl || !state.dates.length) return;

    const counts = dailyCountsForTimeline();
    const n = counts.length;
    const margin = { top: 2, right: 8, bottom: 16, left: 34 };
    const bw = host.getBoundingClientRect().width;
    const fallbackW = document.querySelector(".fullscreen-map")?.clientWidth ?? 640;
    const w = Math.max(240, Math.floor(bw > 12 ? bw : fallbackW));
    const h = 48;
    const innerW = w - margin.left - margin.right;
    const innerH = h - margin.top - margin.bottom;
    const maxC = d3.max(counts) || 1;
    const y = d3.scaleLinear().domain([0, maxC]).nice().range([innerH, 0]);
    const color = d3.scaleSequential((t) => d3.interpolateRgb("#4a6fa5", "#ff9a3c")(t)).domain([0, maxC]);
    const xb = d3
      .scaleBand()
      .domain(Array.from({ length: n }, (_, i) => i))
      .range([0, innerW])
      .paddingInner(0.06);
    const barData = counts.map((c, i) => ({ i, c }));

    const svg = d3.select(svgEl);
    svg.selectAll("*").remove();
    svg.attr("viewBox", `0 0 ${w} ${h}`).attr("width", w).attr("height", h);
    svg.append("title").text("Per-day detection counts after confidence and pass filters; taller bars are busier days.");

    const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

    g.append("text")
      .attr("x", -4)
      .attr("y", innerH / 2)
      .attr("text-anchor", "end")
      .attr("dominant-baseline", "middle")
      .attr("fill", "rgba(150,156,180,0.9)")
      .attr("font-size", "9px")
      .text("count");

    g.append("rect")
      .attr("width", innerW)
      .attr("height", innerH)
      .attr("fill", "transparent")
      .style("cursor", "default")
      .on("dblclick", (ev) => {
        ev.preventDefault();
        state.minDateIdx = 0;
        state.maxDateIdx = state.dates.length - 1;
        document.getElementById("date-min").value = "0";
        document.getElementById("date-max").value = String(state.dates.length - 1);
        refresh();
      });

    const i0 = Math.min(state.minDateIdx, state.maxDateIdx);
    const i1 = Math.max(state.minDateIdx, state.maxDateIdx);
    g.append("rect")
      .attr("x", xb(i0) ?? 0)
      .attr("width", Math.max(xb.bandwidth(), (xb(i1) ?? 0) + xb.bandwidth() - (xb(i0) ?? 0)))
      .attr("y", 0)
      .attr("height", innerH)
      .attr("fill", "rgba(255, 210, 120, 0.14)")
      .attr("stroke", "rgba(255, 210, 140, 0.35)")
      .attr("stroke-width", 1)
      .attr("pointer-events", "none");

    const bars = g
      .selectAll("rect.bar")
      .data(barData)
      .join("rect")
      .attr("class", "bar")
      .attr("x", (d) => xb(d.i))
      .attr("width", xb.bandwidth())
      .attr("y", (d) => y(d.c))
      .attr("height", (d) => innerH - y(d.c))
      .attr("fill", (d) => color(d.c))
      .attr("rx", 1.5)
      .style("cursor", "pointer")
      .on("click", (ev, d) => {
        ev.stopPropagation();
        state.minDateIdx = d.i;
        state.maxDateIdx = d.i;
        document.getElementById("date-min").value = String(d.i);
        document.getElementById("date-max").value = String(d.i);
        refresh();
      });

    bars.append("title").text((d) => `${fmtDate(state.dates[d.i])}: ${d.c} detection(s)`);

    const tickIdx = Array.from(
      new Set([0, Math.floor(n * 0.25), Math.floor(n * 0.5), Math.floor(n * 0.75), n - 1].filter((k) => k >= 0 && k < n))
    ).sort(d3.ascending);

    g.append("g")
      .attr("transform", `translate(0,${innerH})`)
      .call(
        d3
          .axisBottom(xb)
          .tickValues(tickIdx)
          .tickFormat((d) => fmtShort(state.dates[+d]))
          .tickSizeOuter(0)
      );
  }

  function updateInsights(filtered) {
    const ul = document.getElementById("insights-list");
    if (!ul) return;
    if (!filtered.length) {
      ul.innerHTML = "<li>No detections in the current date window.</li>";
      return;
    }

    const byDay = d3.rollup(filtered, (v) => v.length, (d) => d.acq_date.getTime());
    const sortedDays = [...byDay.entries()].sort((a, b) => b[1] - a[1]);
    const peakDay = sortedDays[0];
    const busiest = peakDay ? fmtDate(new Date(peakDay[0])) : "—";
    const bestN = peakDay ? peakDay[1] : 0;

    const byReg = d3.rollup(filtered, (v) => v.length, (d) => regionLabel(d.longitude));
    const total = filtered.length;
    const sortedReg = [...byReg.entries()].sort((a, b) => b[1] - a[1]);
    const [topName, topC] = sortedReg[0] || ["—", 0];
    const topPct = total ? ((topC / total) * 100).toFixed(0) : "0";

    const topFrp = d3.max(filtered, (d) => d.frp) || 0;
    const topFrpRow = filtered.find((d) => d.frp === topFrp) || filtered[0];

    ul.innerHTML = [
      `<li><strong>Busiest day</strong> in the selected window: <strong>${busiest}</strong> (${bestN} pts).</li>`,
      `<li><strong>Regional plurality:</strong> <strong>${topName}</strong> (${topPct}% of filtered points).</li>`,
      `<li><strong>Peak FRP here:</strong> <strong>${topFrp.toFixed(1)} MW</strong> on ${fmtDate(topFrpRow.acq_date)} (${topFrpRow.daynight === "D" ? "day" : "night"} pass).</li>`,
    ].join("");
  }

  function renderDetail(d) {
    const empty = document.getElementById("detail-empty");
    const dl = document.getElementById("detail-dl");
    if (!d) {
      empty.hidden = false;
      dl.hidden = true;
      dl.innerHTML = "";
      return;
    }
    empty.hidden = true;
    dl.hidden = false;
    const rows = [
      ["Latitude", d.latitude.toFixed(5)],
      ["Longitude", d.longitude.toFixed(5)],
      ["Brightness (K)", d.brightness.toFixed(2)],
      ["Brightness T31 (K)", d.bright_t31.toFixed(2)],
      ["FRP (MW)", d.frp.toFixed(2)],
      ["Acquisition date", fmtDate(d.acq_date)],
      ["Acquisition time (UTC)", d.acq_time],
      ["Satellite", d.satellite],
      ["Confidence (%)", String(d.confidence)],
      ["Scan (km)", d.scan.toFixed(2)],
      ["Track (km)", d.track.toFixed(2)],
      ["Approx footprint area (km²)", (d.scan * d.track).toFixed(2)],
      ["Day/night", d.daynight === "D" ? "Day" : "Night"],
      ["Region (band)", regionLabel(d.longitude)],
    ];
    dl.innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");
  }

  function measureMapLogicalSize() {
    const stage = document.querySelector(".map-stage");
    const box = stage?.getBoundingClientRect?.();
    let w = Math.round(box?.width ?? 0);
    let h = Math.round(box?.height ?? 0);
    if (w < 16 || h < 16) {
      w = MAP_BASE.width;
      h = MAP_BASE.height;
    }
    return [w, h];
  }

  function colorForBrightness(brightness) {
    const t = (brightness - 300) / 60;
    const c = d3.interpolateRgb("#ffe5a8", "#ffb020")(Math.min(1, Math.max(0, t)));
    return d3.color(c) || d3.rgb("#ffb020");
  }

  function syncCanvasSize(canvas, w, h, dpr) {
    const ww = Math.round(w * dpr);
    const hh = Math.round(h * dpr);
    if (canvas.width !== ww || canvas.height !== hh) {
      canvas.width = ww;
      canvas.height = hh;
    }
    canvas.style.removeProperty("width");
    canvas.style.removeProperty("height");
  }

  function buildProjectionPath(mw, mh) {
    const statesFeat = topojson.feature(state.geo, state.geo.objects.states);
    const projection = d3.geoAlbersUsa().fitSize([mw, mh], statesFeat);
    const path = d3.geoPath(projection);
    return { statesFeat, projection, path };
  }

  function drawBasemap(svgRoot, path, statesFeat, mw, mh) {
    svgRoot.selectAll("*").remove();
    svgRoot.attr("viewBox", `0 0 ${mw} ${mh}`);
    /** Keep display size purely from CSS (#map-svg { width:100%; height:100% }) so canvas/SVG pixels match. */
    svgRoot.attr("preserveAspectRatio", "xMidYMid meet");

    const defs = svgRoot.append("defs");

    const oceanGrad = defs
      .append("linearGradient")
      .attr("id", "map-ocean-fill")
      .attr("gradientUnits", "userSpaceOnUse")
      .attr("x1", 0)
      .attr("y1", 0)
      .attr("x2", mw)
      .attr("y2", mh);
    oceanGrad.append("stop").attr("offset", "0%").attr("stop-color", "#2874a6");
    oceanGrad.append("stop").attr("offset", "45%").attr("stop-color", "#1a5270");
    oceanGrad.append("stop").attr("offset", "100%").attr("stop-color", "#0e3148");

    const landGrad = defs
      .append("radialGradient")
      .attr("id", "map-land-fill")
      .attr("gradientUnits", "userSpaceOnUse")
      .attr("cx", mw * 0.42)
      .attr("cy", mh * 0.42)
      .attr("r", Math.max(mw, mh) * 0.72);
    landGrad.append("stop").attr("offset", "0%").attr("stop-color", "#dde8cf");
    landGrad.append("stop").attr("offset", "40%").attr("stop-color", "#aecfa0");
    landGrad.append("stop").attr("offset", "72%").attr("stop-color", "#93b883");
    landGrad.append("stop").attr("offset", "100%").attr("stop-color", "#7da06d");

    svgRoot.append("rect").attr("class", "map-ocean").attr("width", mw).attr("height", mh).attr("fill", "url(#map-ocean-fill)");

    const root = svgRoot.append("g").attr("class", "map-root");
    root
      .append("path")
      .datum(statesFeat)
      .attr("class", "states-fill")
      .attr("d", path)
      .attr("fill", "url(#map-land-fill)")
      .attr("stroke", "#4d7348")
      .attr("stroke-width", 0.45)
      .attr("stroke-opacity", 0.9);

    root
      .append("path")
      .datum(topojson.mesh(state.geo, state.geo.objects.states, (a, b) => a !== b))
      .attr("class", "state-boundary")
      .attr("d", path);
  }

  function projectFires(rows) {
    return rows.map((d) => {
      const xy = state.projection([d.longitude, d.latitude]);
      return { datum: d, x: xy[0], y: xy[1], r: state.rScale(d.frp), col: colorForBrightness(d.brightness) };
    });
  }

  function redrawCanvasFires() {
    const canvas = document.getElementById("map-canvas");
    if (!canvas || !ctx) return;

    const lw = +canvas.dataset.logicalW || canvas.clientWidth || MAP_BASE.width;
    const lh = +canvas.dataset.logicalH || canvas.clientHeight || MAP_BASE.height;
    const w = lw;
    const h = lh;
    const dpr = window.devicePixelRatio || 1;
    syncCanvasSize(canvas, w, h, dpr);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const t = state.zoomTransform;

    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.scale(t.k, t.k);

    for (const p of state.firesProjected) {
      const halo = ctx.createRadialGradient(p.x, p.y + p.r * 0.35, p.r * 0.25, p.x, p.y, p.r * 3.4);
      halo.addColorStop(0, "rgba(255,210,140,0.52)");
      halo.addColorStop(0.35, "rgba(255,180,70,0.22)");
      halo.addColorStop(1, "rgba(255,170,60,0)");
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * 3.6, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();
      ctx.arc(p.x, p.y + p.r * 0.08, p.r * 0.92, 0, Math.PI * 2);
      ctx.globalAlpha = 0.38;
      ctx.fillStyle = "rgba(18,52,74,0.55)";
      ctx.fill();
      ctx.globalAlpha = 1;

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.globalAlpha = 0.93;
      const mid = d3.rgb(p.col);
      mid.opacity = 0.95;
      const edge = p.col.darker(0.25);
      const lum = ctx.createRadialGradient(p.x - p.r * 0.35, p.y - p.r * 0.35, p.r * 0.05, p.x, p.y, p.r * 1.05);
      lum.addColorStop(0, `rgba(255,255,255,0.55)`);
      lum.addColorStop(0.35, mid.formatRgb());
      lum.addColorStop(1, edge.formatRgb());
      ctx.fillStyle = lum;
      ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,0.42)";
      ctx.lineWidth = 1.1 / t.k;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    if (state.selected) {
      const sp = state.firesProjected.find((p) => p.datum === state.selected);
      if (sp) {
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, sp.r + 2.8, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(255,255,255,0.9)";
        ctx.lineWidth = 2.2 / t.k;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(sp.x, sp.y, sp.r + 6, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(255,59,48,0.55)";
        ctx.lineWidth = 3 / t.k;
        ctx.stroke();
      }
    }

    if (state.showPeakHighlight && state.firesProjected.length) {
      const peak = state.firesProjected.reduce((a, b) => (b.datum.frp > a.datum.frp ? b : a));
      const { x: px, y: py, r } = peak;
      const L = Math.max(10, r * 3.2);
      ctx.strokeStyle = "rgba(255, 200, 110, 0.95)";
      ctx.lineWidth = 2.2 / t.k;
      ctx.beginPath();
      ctx.moveTo(px - L, py);
      ctx.lineTo(px + L, py);
      ctx.moveTo(px, py - L);
      ctx.lineTo(px, py + L);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(px - L * 0.7, py - L * 0.7);
      ctx.lineTo(px + L * 0.7, py + L * 0.7);
      ctx.moveTo(px + L * 0.7, py - L * 0.7);
      ctx.lineTo(px - L * 0.7, py + L * 0.7);
      ctx.stroke();
    }

    ctx.restore();
  }

  function scheduleRedrawFires() {
    if (zoomRaf !== null) return;
    zoomRaf = window.requestAnimationFrame(() => {
      zoomRaf = null;
      redrawCanvasFires();
    });
  }

  function svgPoint(clientX, clientY) {
    const svgEl = document.getElementById("map-svg");
    if (!(svgEl instanceof SVGSVGElement)) return null;
    const pt = svgEl.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svgEl.getScreenCTM();
    if (!ctm) return null;
    return pt.matrixTransform(ctm.inverse());
  }

  function nearestFireSvgPoint(svgX, svgY) {
    if (!Number.isFinite(svgX) || !Number.isFinite(svgY) || !state.firesProjected.length) return null;

    const t = state.zoomTransform;
    const ix = (svgX - t.x) / t.k;
    const iy = (svgY - t.y) / t.k;

    let best = null;
    let bestD = Infinity;

    const hitPx = Math.max(12, 26 / Math.sqrt(t.k));
    const hitSq = hitPx * hitPx;

    for (const p of state.firesProjected) {
      const dx = ix - p.x;
      const dy = iy - p.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD && d2 <= hitSq) {
        bestD = d2;
        best = p;
      }
    }
    return best;
  }

  function setupInteractions(svgRoot) {
    const svgNode = svgRoot.node();
    state.zoomBehavior = d3
      .zoom()
      .scaleExtent([1, 24])
      .on("zoom", (event) => {
        state.zoomTransform = event.transform;
        svgRoot.select("g.map-root").attr("transform", event.transform);
        scheduleRedrawFires();
      });

    d3.select(svgNode).call(state.zoomBehavior);
    d3.select(svgNode).on("dblclick.zoom", null);

    d3.select(svgNode).call(state.zoomBehavior.transform, state.zoomTransform);

    svgNode.addEventListener("click", (ev) => {
      const pt = svgPoint(ev.clientX, ev.clientY);
      if (!pt) return;
      const nearest = nearestFireSvgPoint(pt.x, pt.y);
      if (nearest) {
        ev.stopPropagation();
        state.selected = nearest.datum;
        scheduleRedrawFires();
        renderDetail(nearest.datum);
        return;
      }
      state.selected = null;
      scheduleRedrawFires();
      renderDetail(null);
    });
  }

  function ensureMapInfrastructure(firesFiltered) {
    const [mw, mh] = measureMapLogicalSize();
    const key = `${mw}x${mh}`;

    const svgRoot = d3.select("#map-svg");
    const canvas = document.getElementById("map-canvas");

    state.maxFrp = d3.max(state.raw, (d) => d.frp) || 1;
    state.rScale = d3.scaleSqrt().domain([0, state.maxFrp]).range([3, 13]);

    if (!ctx && canvas) {
      ctx = canvas.getContext("2d");
    }

    if (key !== state.mapSizeKey || !state.projection) {
      const { statesFeat, projection, path } = buildProjectionPath(mw, mh);
      state.projection = projection;
      state.path = path;
      state.mapSizeKey = key;
      drawBasemap(svgRoot, path, statesFeat, mw, mh);

      if (canvas) {
        syncCanvasSize(canvas, mw, mh, window.devicePixelRatio || 1);
        canvas.dataset.logicalW = String(mw);
        canvas.dataset.logicalH = String(mh);
      }

      setupInteractions(svgRoot);
    }

    const keepSel = state.selected && firesFiltered.includes(state.selected);
    if (!keepSel) {
      state.selected = null;
      renderDetail(null);
    }

    state.firesFiltered = firesFiltered;
    state.firesProjected = projectFires(firesFiltered);
    scheduleRedrawFires();
  }

  function refresh() {
    const filtered = applyFilters(state.raw);
    ensureMapInfrastructure(filtered);

    document.getElementById("date-label").textContent =
      `${fmtShort(state.dates[state.minDateIdx])} → ${fmtShort(state.dates[state.maxDateIdx])}`;
    document.getElementById("conf-label").textContent = `${state.minConf}%`;
    const stats = document.querySelector("#map-stats");
    if (stats) stats.textContent = `${filtered.length} / ${state.raw.length} hotspots shown`;

    drawActivityTimeline();
    updateInsights(filtered);
  }

  async function init() {
    const csvText =
      typeof window.__MODIS_FIRES_CSV === "string" && window.__MODIS_FIRES_CSV.length
        ? window.__MODIS_FIRES_CSV
        : await d3.text("data/modis_fires_us.csv");
    const geo = await d3.json("https://cdn.jsdelivr.net/npm/us-atlas@3/states-10m.json");
    state.geo = geo;

    const rows = d3.csvParse(csvText, (d) => ({
      ...d,
      latitude: +d.latitude,
      longitude: +d.longitude,
      brightness: +d.brightness,
      scan: +d.scan,
      track: +d.track,
      acq_date: parseDate(d.acq_date),
      acq_time: d.acq_time,
      satellite: d.satellite,
      instrument: d.instrument,
      confidence: +d.confidence,
      version: d.version,
      bright_t31: +d.bright_t31,
      frp: +d.frp,
      daynight: d.daynight,
    }));

    state.raw = rows;
    state.dates = Array.from(new Set(rows.map((d) => d.acq_date.getTime())))
      .sort((a, b) => a - b)
      .map((t) => new Date(t));
    state.minDateIdx = 0;
    state.maxDateIdx = state.dates.length - 1;

    const minEl = document.getElementById("date-min");
    const maxEl = document.getElementById("date-max");
    minEl.min = maxEl.min = 0;
    minEl.max = maxEl.max = String(state.dates.length - 1);
    minEl.step = maxEl.step = "1";
    minEl.value = "0";
    maxEl.value = String(state.dates.length - 1);

    minEl.addEventListener("input", () => {
      state.minDateIdx = Math.min(+minEl.value, +maxEl.value);
      minEl.value = String(state.minDateIdx);
      refresh();
    });
    maxEl.addEventListener("input", () => {
      state.maxDateIdx = Math.max(+minEl.value, +maxEl.value);
      maxEl.value = String(state.maxDateIdx);
      refresh();
    });

    document.getElementById("confidence").addEventListener("input", (e) => {
      state.minConf = +e.target.value;
      refresh();
    });

    document.getElementById("btn-day").addEventListener("click", (e) => {
      state.allowDay = !state.allowDay;
      e.currentTarget.classList.toggle("active", state.allowDay);
      refresh();
    });
    document.getElementById("btn-night").addEventListener("click", (e) => {
      state.allowNight = !state.allowNight;
      e.currentTarget.classList.toggle("active", state.allowNight);
      refresh();
    });

    document.getElementById("btn-reset").addEventListener("click", () => {
      state.minConf = 0;
      state.allowDay = true;
      state.allowNight = true;
      state.selected = null;
      state.zoomTransform = d3.zoomIdentity;
      state.minDateIdx = 0;
      state.maxDateIdx = state.dates.length - 1;
      state.showPeakHighlight = false;
      document.getElementById("confidence").value = "0";
      document.getElementById("date-min").value = "0";
      document.getElementById("date-max").value = String(state.dates.length - 1);
      document.getElementById("btn-day").classList.add("active");
      document.getElementById("btn-night").classList.add("active");
      const peakChk = document.getElementById("chk-peak-frp");
      if (peakChk) peakChk.checked = false;
      renderDetail(null);
      refresh();
    });

    const peakChk = document.getElementById("chk-peak-frp");
    if (peakChk) {
      peakChk.addEventListener("change", () => {
        state.showPeakHighlight = peakChk.checked;
        scheduleRedrawFires();
      });
    }

    refresh();

    let resizeTimer = null;
    window.addEventListener("resize", () => {
      if (resizeTimer) window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        state.mapSizeKey = "";
        refresh();
      }, 120);
    });
  }

  init().catch((err) => {
    console.error(err);
    document.body.insertAdjacentHTML(
      "beforeend",
      `<p style="color:#faa;padding:1rem">Failed to load data: ${err.message}</p>`
    );
  });
})();
