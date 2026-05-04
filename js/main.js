/**
 * DSC 106 Project 3 — D3-only interactive MODIS / FIRMS hotspot explorer.
 */
(function () {
  const parseDate = d3.timeParse("%Y-%m-%d");
  const fmtDate = d3.timeFormat("%b %-d, %Y");
  const fmtShort = d3.timeFormat("%b %-d");

  const state = {
    raw: [],
    dates: [],
    projection: null,
    path: null,
    geo: null,
    brushExtent: null,
    selected: null,
    allowDay: true,
    allowNight: true,
    minConf: 0,
    minDateIdx: 0,
    maxDateIdx: 0,
  };

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
      if (state.brushExtent) {
        const [frp0, frp1] = state.brushExtent.frp;
        const [br0, br1] = state.brushExtent.brightness;
        const loF = Math.min(frp0, frp1);
        const hiF = Math.max(frp0, frp1);
        const loB = Math.min(br0, br1);
        const hiB = Math.max(br0, br1);
        if (d.frp < loF || d.frp > hiF || d.brightness < loB || d.brightness > hiB) return false;
      }
      return true;
    });
  }

  function chartMargins(w, h, left, bottom) {
    return { width: w, height: h, margin: { top: 12, right: 10, bottom, left } };
  }

  function barChart(svgSel, data, { key, xTickFormat }) {
    const { width, height, margin } = chartMargins(320, 180, 34, 28);
    const iw = width - margin.left - margin.right;
    const ih = height - margin.top - margin.bottom;
    const svg = d3.select(svgSel).attr("viewBox", `0 0 ${width} ${height}`);
    svg.selectAll("*").remove();
    const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
    const rolled = d3.rollups(
      data,
      (v) => v.length,
      (d) => key(d)
    );
    rolled.sort((a, b) => (String(a[0]) < String(b[0]) ? -1 : 1));
    if (!rolled.length) {
      g.append("text").attr("x", iw / 2).attr("y", ih / 2).attr("text-anchor", "middle").attr("fill", "#9a958c").text("No data in filter");
      return;
    }
    const x = d3
      .scaleBand()
      .domain(rolled.map((d) => d[0]))
      .range([0, iw])
      .padding(0.18);
    const y = d3
      .scaleLinear()
      .domain([0, d3.max(rolled, (d) => d[1]) || 1])
      .nice()
      .range([ih, 0]);
    g.selectAll("rect.bar")
      .data(rolled)
      .join("rect")
      .attr("class", "bar")
      .attr("x", (d) => x(d[0]))
      .attr("y", (d) => y(d[1]))
      .attr("width", x.bandwidth())
      .attr("height", (d) => ih - y(d[1]));
    const ax = g.append("g").attr("transform", `translate(0,${ih})`).call(d3.axisBottom(x).tickFormat(xTickFormat || ((v) => v)));
    ax.attr("class", "axis");
    ax.selectAll("text").style("text-anchor", "end").attr("dx", "-0.35em").attr("dy", "0.35em").attr("transform", "rotate(-35)");
    g.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(4));
  }

  function histogramBrightness(svgSel, data) {
    const { width, height, margin } = chartMargins(320, 180, 34, 22);
    const iw = width - margin.left - margin.right;
    const ih = height - margin.top - margin.bottom;
    const svg = d3.select(svgSel).attr("viewBox", `0 0 ${width} ${height}`);
    svg.selectAll("*").remove();
    const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
    if (!data.length) {
      g.append("text").attr("x", iw / 2).attr("y", ih / 2).attr("text-anchor", "middle").attr("fill", "#9a958c").text("No data in filter");
      return;
    }
    const bins = d3
      .bin()
      .domain(d3.extent(data, (d) => d.brightness))
      .thresholds(14)(data.map((d) => d.brightness));
    const y = d3
      .scaleLinear()
      .domain([0, d3.max(bins, (b) => b.length) || 1])
      .nice()
      .range([ih, 0]);
    const x = d3
      .scaleLinear()
      .domain([bins[0].x0, bins[bins.length - 1].x1])
      .range([0, iw]);
    g.selectAll("rect.bar")
      .data(bins)
      .join("rect")
      .attr("class", "bar")
      .attr("x", (d) => x(d.x0))
      .attr("y", (d) => y(d.length))
      .attr("width", (d) => Math.max(0, x(d.x1) - x(d.x0) - 1))
      .attr("height", (d) => ih - y(d.length));
    g.append("g").attr("class", "axis").attr("transform", `translate(0,${ih})`).call(d3.axisBottom(x).ticks(5));
    g.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(4));
  }

  let suppressBrushEnd = false;

  function drawScatterBrush() {
    const svgSel = "#chart-scatter";
    const width = 320;
    const height = 200;
    const margin = { top: 12, right: 12, bottom: 36, left: 42 };
    const iw = width - margin.left - margin.right;
    const ih = height - margin.top - margin.bottom;
    const svg = d3.select(svgSel).attr("viewBox", `0 0 ${width} ${height}`);
    svg.selectAll("*").remove();
    const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);

    const x = d3
      .scaleLinear()
      .domain(d3.extent(state.raw, (d) => d.frp))
      .nice()
      .range([0, iw]);
    const y = d3
      .scaleLinear()
      .domain(d3.extent(state.raw, (d) => d.brightness))
      .nice()
      .range([ih, 0]);

    g.append("g")
      .selectAll("circle")
      .data(state.raw)
      .join("circle")
      .attr("cx", (d) => x(d.frp))
      .attr("cy", (d) => y(d.brightness))
      .attr("r", 2.2)
      .attr("fill", "rgba(255,200,120,0.35)");

    g.append("g").attr("class", "axis").attr("transform", `translate(0,${ih})`).call(d3.axisBottom(x).ticks(5));
    g.append("g").attr("class", "axis").call(d3.axisLeft(y).ticks(5));
    g.append("text")
      .attr("x", iw / 2)
      .attr("y", ih + 30)
      .attr("text-anchor", "middle")
      .attr("fill", "#9a958c")
      .attr("font-size", "10px")
      .text("FRP (MW)");
    g.append("text")
      .attr("transform", "rotate(-90)")
      .attr("x", -ih / 2)
      .attr("y", -30)
      .attr("text-anchor", "middle")
      .attr("fill", "#9a958c")
      .attr("font-size", "10px")
      .text("Brightness (K)");

    const brushG = g.append("g").attr("class", "brush-layer");

    const brush = d3
      .brush()
      .extent([
        [0, 0],
        [iw, ih],
      ])
      .on("end", (event) => {
        if (suppressBrushEnd) return;
        if (!event.selection) {
          if (event.sourceEvent) {
            state.brushExtent = null;
            refresh();
          }
          return;
        }
        const [[px0, py0], [px1, py1]] = event.selection;
        const frp0 = x.invert(px0);
        const frp1 = x.invert(px1);
        const br0 = y.invert(py0);
        const br1 = y.invert(py1);
        state.brushExtent = { frp: [frp0, frp1], brightness: [br1, br0] };
        refresh();
      });

    brushG.call(brush);

    if (state.brushExtent) {
      const [frp0, frp1] = state.brushExtent.frp;
      const [br0, br1] = state.brushExtent.brightness;
      const px0 = x(Math.min(frp0, frp1));
      const px1 = x(Math.max(frp0, frp1));
      const py0 = y(Math.max(br0, br1));
      const py1 = y(Math.min(br0, br1));
      suppressBrushEnd = true;
      brushG.call(brush.move, [
        [px0, py0],
        [px1, py1],
      ]);
      suppressBrushEnd = false;
    }
  }

  function drawSmallMultiples(filtered) {
    barChart("#chart-date", filtered, {
      key: (d) => d3.timeFormat("%Y-%m-%d")(d.acq_date),
      xTickFormat: (v) => String(v).slice(5),
    });
    barChart("#chart-region", filtered, {
      key: (d) => regionLabel(d.longitude),
      xTickFormat: (v) => v,
    });
    histogramBrightness("#chart-brightness", filtered);
    barChart("#chart-satellite", filtered, {
      key: (d) => d.satellite,
      xTickFormat: (v) => v,
    });
    barChart("#chart-daynight", filtered, {
      key: (d) => (d.daynight === "D" ? "Day" : "Night"),
      xTickFormat: (v) => v,
    });
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
      ["Day/night", d.daynight === "D" ? "Day" : "Night"],
      ["Region (band)", regionLabel(d.longitude)],
    ];
    dl.innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");
  }

  function setupMap(firesFiltered) {
    const svg = d3.select("#map-svg");
    svg.selectAll("*").remove();
    const defs = svg.append("defs");
    const filter = defs.append("filter").attr("id", "spark-glow").attr("x", "-80%").attr("y", "-80%").attr("width", "260%").attr("height", "260%");
    filter.append("feGaussianBlur").attr("stdDeviation", "1.4").attr("result", "blur");
    const merge = filter.append("feMerge");
    merge.append("feMergeNode").attr("in", "blur");
    merge.append("feMergeNode").attr("in", "SourceGraphic");

    const root = svg.append("g").attr("class", "map-root");
    const statesFeat = topojson.feature(state.geo, state.geo.objects.states);
    state.projection = d3.geoAlbersUsa().fitSize([960, 560], statesFeat);
    state.path = d3.geoPath(state.projection);

    root
      .append("path")
      .datum(statesFeat)
      .attr("class", "states-fill")
      .attr("d", state.path)
      .attr("fill", "#15151d")
      .attr("stroke", "none");

    root.append("path").datum(topojson.mesh(state.geo, state.geo.objects.states, (a, b) => a !== b)).attr("class", "state-boundary").attr("d", state.path);

    const maxFrp = d3.max(state.raw, (d) => d.frp) || 1;
    const rScale = d3.scaleSqrt().domain([0, maxFrp]).range([1.1, 5]);

    root
      .append("g")
      .attr("class", "fires")
      .selectAll("circle")
      .data(firesFiltered, (d) => `${d.longitude},${d.latitude},${d.acq_time},${d.acq_date.getTime()}`)
      .join("circle")
      .attr("class", "spark-dot")
      .attr("cx", (d) => state.projection([d.longitude, d.latitude])[0])
      .attr("cy", (d) => state.projection([d.longitude, d.latitude])[1])
      .attr("r", (d) => rScale(d.frp))
      .attr("fill", (d) => {
        const t = (d.brightness - 300) / 60;
        return d3.interpolateRgb("#ffe5a8", "#ffb020")(Math.min(1, Math.max(0, t)));
      })
      .attr("opacity", 0.92)
      .attr("filter", "url(#spark-glow)")
      .on("click", (event, d) => {
        event.stopPropagation();
        state.selected = d;
        root.selectAll("circle.spark-dot").classed("selected", (dd) => dd === d);
        renderDetail(d);
      });

    svg.call(
      d3
        .zoom()
        .scaleExtent([1, 14])
        .on("zoom", (event) => {
          root.attr("transform", event.transform);
        })
    );

    svg.on("click", () => {
      state.selected = null;
      root.selectAll("circle.spark-dot").classed("selected", false);
      renderDetail(null);
    });
  }

  function refresh() {
    const filtered = applyFilters(state.raw);
    drawSmallMultiples(filtered);
    drawScatterBrush();
    setupMap(filtered);

    document.getElementById(
      "date-label"
    ).textContent = `${fmtShort(state.dates[state.minDateIdx])} → ${fmtShort(state.dates[state.maxDateIdx])}`;
    document.getElementById("conf-label").textContent = `${state.minConf}%`;
    document.querySelector("#interactive h2").textContent = `Interactive map · ${filtered.length} of ${state.raw.length} detections`;
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

    document.getElementById("btn-clear-brush").addEventListener("click", () => {
      state.brushExtent = null;
      refresh();
    });

    document.getElementById("btn-reset").addEventListener("click", () => {
      state.brushExtent = null;
      state.minConf = 0;
      state.allowDay = true;
      state.allowNight = true;
      state.minDateIdx = 0;
      state.maxDateIdx = state.dates.length - 1;
      document.getElementById("confidence").value = "0";
      document.getElementById("date-min").value = "0";
      document.getElementById("date-max").value = String(state.dates.length - 1);
      document.getElementById("btn-day").classList.add("active");
      document.getElementById("btn-night").classList.add("active");
      refresh();
    });

    refresh();
  }

  init().catch((err) => {
    console.error(err);
    document.body.insertAdjacentHTML(
      "beforeend",
      `<p style="color:#faa;padding:1rem">Failed to load data: ${err.message}</p>`
    );
  });
})();
