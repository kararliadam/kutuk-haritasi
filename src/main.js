import * as d3 from "d3";

const RAMP = ["#efe8dc", "#d4c4a4", "#b08958", "#7a522c", "#3d2a1c"];
const RAMP_DARK = ["#2c261c", "#534836", "#8a7354", "#c4a87a", "#ead9b8"];
const FARK_COLORS = ["#1a5a66", "#6aa3ab", "#e6e2dc", "#c4845a", "#8b4a2b"];
const FARK_DARK = ["#8fd0d6", "#4d8f96", "#4a4550", "#c99268", "#e8b48a"];
const THEME_KEY = "kutuk-theme";
const ALWAYS_LABEL = new Set([6, 16, 21, 34, 35, 42, 63]);
const OFFSETS = {
  7: [0, 14],
  11: [0, 10],
  16: [0, 4],
  27: [0, 8],
  31: [0, 10],
  33: [8, 12],
  34: [0, -16],
  35: [-6, 4],
  39: [-4, -8],
  41: [16, 2],
  46: [0, 8],
  54: [0, 12],
  59: [0, 10],
  69: [12, 0],
  74: [0, -10],
  77: [22, -10],
  78: [12, -6],
  79: [16, 12],
  80: [12, 12],
  81: [0, 14],
};

const state = {
  mode: "kutuk",
  year: null,
  selected: null,
  query: "",
};

const MODE_TITLES = {
  kutuk: "Sıralama · Kütük",
  ikamet: "Sıralama · İkamet",
  fark: "Sıralama · Fark",
};

const tooltip = document.getElementById("tooltip");
const ranking = document.getElementById("ranking");
const legend = document.getElementById("legend");
const mapEl = document.getElementById("map");
const yearInput = document.getElementById("year");
const yearButtons = document.getElementById("year-buttons");
const yearPrev = document.getElementById("year-prev");
const yearNext = document.getElementById("year-next");
const listTitle = document.getElementById("list-title");
const zoomIn = document.getElementById("zoom-in");
const zoomOut = document.getElementById("zoom-out");
const zoomReset = document.getElementById("zoom-reset");
const zoomFull = document.getElementById("zoom-full");
const mapPanel = document.getElementById("map-panel");
const themeToggle = document.getElementById("theme-toggle");
const themeColor = document.getElementById("theme-color");

const ZOOM_MIN = 1;
const ZOOM_MAX = 8;
const MOBILE_BREAK = 880;
const MOBILE_ZOOM = 1.7;
const LABEL_ZOOM = 0.45;

let mapView = null;

const [geo, payload] = await Promise.all([
  d3.json("./tr-provinces.geojson"),
  d3.json("./data/provinces.json"),
]);

const years = payload.years;
state.year = years[years.length - 1];

const byCode = new Map(payload.provinces.map((p) => [p.code, p]));
for (const feature of geo.features) {
  feature.properties.meta = byCode.get(feature.properties.number);
}

function formatNumber(n) {
  return Math.round(n).toLocaleString("tr-TR");
}

function signedNumber(n) {
  const abs = formatNumber(Math.abs(n));
  if (n > 0) return `+${abs}`;
  if (n < 0) return `−${abs}`;
  return abs;
}

function snapshot(meta, year = state.year) {
  const point = meta.series[String(year)];
  return {
    code: meta.code,
    name: meta.name,
    kutuk: point.kutuk,
    ikamet: point.ikamet,
  };
}

function prevYear(year = state.year) {
  const i = years.indexOf(year);
  return i > 0 ? years[i - 1] : null;
}

function valueOf(row, mode = state.mode) {
  if (mode === "fark") return row.kutuk - row.ikamet;
  return row[mode];
}

function labelOf(n, mode = state.mode) {
  return mode === "fark" ? signedNumber(n) : formatNumber(n);
}

function yearDelta(meta, mode = state.mode) {
  const prev = prevYear();
  if (!prev) return null;
  return valueOf(snapshot(meta), mode) - valueOf(snapshot(meta, prev), mode);
}

function allValues(mode) {
  return payload.provinces.flatMap((p) => years.map((year) => valueOf(snapshot(p, year), mode)));
}

function isDark() {
  return document.documentElement.dataset.theme === "dark";
}

function palettes() {
  return isDark()
    ? { ramp: RAMP_DARK, fark: FARK_DARK }
    : { ramp: RAMP, fark: FARK_COLORS };
}

function colorScale(mode) {
  const { ramp, fark } = palettes();
  if (mode === "fark") {
    return d3.scaleThreshold().domain([-1000000, -100000, 100000, 1000000]).range(fark);
  }
  if (mode === "ikamet") {
    return d3.scaleThreshold().domain([500000, 1000000, 2000000, 5000000]).range(ramp);
  }
  const values = allValues("kutuk");
  return d3.scaleQuantize().domain([d3.min(values), d3.max(values)]).range(ramp);
}

function legendBreaks(scale, mode) {
  const { ramp, fark } = palettes();
  if (mode === "fark") {
    return [
      { color: fark[0], text: "Göç alan, 1 milyondan fazla" },
      { color: fark[1], text: "Göç alan" },
      { color: fark[2], text: "Yaklaşık dengede" },
      { color: fark[3], text: "Göç veren" },
      { color: fark[4], text: "Göç veren, 1 milyondan fazla" },
    ];
  }
  if (mode === "ikamet") {
    const labels = [
      "500 binden az",
      "500.000 – 999.999",
      "1.000.000 – 1.999.999",
      "2.000.000 – 4.999.999",
      "5.000.000+",
    ];
    return ramp.map((color, i) => ({ color, text: labels[i] }));
  }
  const [min, max] = scale.domain();
  const step = (max - min) / ramp.length;
  return ramp.map((color, i) => {
    const from = Math.round(min + step * i);
    const to = Math.round(i === ramp.length - 1 ? max : min + step * (i + 1) - 1);
    return { color, text: `${formatNumber(from)} – ${formatNumber(to)}` };
  });
}

function rankMap(mode) {
  const sorted = [...payload.provinces]
    .map((p) => snapshot(p))
    .sort((a, b) => valueOf(b, mode) - valueOf(a, mode));
  return new Map(sorted.map((p, i) => [p.code, i + 1]));
}

function fold(s) {
  return s.toLocaleLowerCase("tr-TR");
}

function deltaHtml(delta) {
  if (delta == null) return "";
  const cls = delta > 0 ? " is-up" : delta < 0 ? " is-down" : "";
  const prev = prevYear();
  return `<span class="delta${cls}">${signedNumber(delta)} (${prev})</span>`;
}

function renderChrome() {
  document.getElementById("source-year").textContent =
    `Kaynak: TÜİK, Adrese Dayalı Nüfus Kayıt Sistemi, 31 Aralık ${state.year}.`;
  yearInput.value = String(state.year);
  document.getElementById("year-display").textContent = String(state.year);
  listTitle.textContent = MODE_TITLES[state.mode];
  yearPrev.disabled = state.year === years[0];
  yearNext.disabled = state.year === years[years.length - 1];
  yearButtons.querySelectorAll(".year").forEach((button) => {
    button.classList.toggle("is-active", Number(button.dataset.year) === state.year);
  });
}

function renderLegend() {
  const scale = colorScale(state.mode);
  const items = legendBreaks(scale, state.mode);
  const compact = matchMedia(`(max-width: ${MOBILE_BREAK}px)`).matches;
  const labels = compact
    ? items.map((item, i) => {
        if (i !== 0 && i !== items.length - 1) return item;
        if (state.mode === "kutuk") {
          const [min, max] = scale.domain();
          const text =
            i === 0 ? formatNumber(Math.round(min)) : formatNumber(Math.round(max));
          return { ...item, text };
        }
        if (state.mode === "fark") {
          return { ...item, text: i === 0 ? "Göç alan" : "Göç veren" };
        }
        return item;
      })
    : items;
  legend.innerHTML = `<div class="legend-bar">${labels
    .map((item) => `<span style="background:${item.color}"></span>`)
    .join("")}</div><div class="legend-labels">${labels
    .map((item) => `<span>${item.text}</span>`)
    .join("")}</div>`;
}

function renderList() {
  const ranks = rankMap(state.mode);
  const q = fold(state.query.trim());
  const rows = [...payload.provinces]
    .filter((p) => !q || fold(p.name).includes(q))
    .sort((a, b) => valueOf(snapshot(b)) - valueOf(snapshot(a)));

  ranking.innerHTML = rows
    .map((p) => {
      const row = snapshot(p);
      const active = p.code === state.selected ? " is-active" : "";
      return `<li class="${active}" data-code="${p.code}">
        <span class="rank">${ranks.get(p.code)}</span>
        <span>${p.name}</span>
        <span class="value">${labelOf(valueOf(row))}${deltaHtml(yearDelta(p))}</span>
      </li>`;
    })
    .join("");
}

function tooltipHtml(meta) {
  const row = snapshot(meta);
  const ranks = rankMap("kutuk");
  const fark = row.kutuk - row.ikamet;
  const side = fark > 0 ? "göç veren" : fark < 0 ? "göç alan" : "dengede";
  const prev = prevYear();
  const change = (mode) => {
    const d = yearDelta(meta, mode);
    return d == null ? "" : ` <span class="tip-delta">(${signedNumber(d)} / ${prev})</span>`;
  };
  return `<strong>${row.name} · ${state.year}</strong>
    <dl>
      <dt>Kütük</dt><dd>${formatNumber(row.kutuk)}${change("kutuk")}</dd>
      <dt>İkamet</dt><dd>${formatNumber(row.ikamet)}${change("ikamet")}</dd>
      <dt>Fark</dt><dd>${signedNumber(fark)} (${side})${change("fark")}</dd>
      <dt>Sıra</dt><dd>${ranks.get(row.code)} / 81</dd>
    </dl>`;
}

function showTooltip(event, meta) {
  tooltip.hidden = false;
  tooltip.innerHTML = tooltipHtml(meta);
  const box = mapPanel.getBoundingClientRect();
  const pad = 10;
  const tipW = tooltip.offsetWidth;
  const tipH = tooltip.offsetHeight;
  const localX = event.clientX - box.left;
  const localY = event.clientY - box.top;
  const mobile = matchMedia(`(max-width: ${MOBILE_BREAK}px)`).matches;
  let x = mobile ? localX - tipW / 2 : localX + 14;
  let y = mobile ? localY - tipH - 16 : localY + 14;
  if (!mobile && x + tipW > box.width - pad) x = localX - tipW - 14;
  tooltip.style.left = `${Math.max(pad, Math.min(x, box.width - tipW - pad))}px`;
  tooltip.style.top = `${Math.max(pad, Math.min(y, box.height - tipH - pad))}px`;
}

function hideTooltip() {
  tooltip.hidden = true;
}

function mapSize() {
  const width = mapEl.clientWidth || 800;
  const height = mapEl.clientHeight || (width >= MOBILE_BREAK ? 620 : 360);
  return { width, height };
}

function defaultTransform(width, height) {
  if (width >= MOBILE_BREAK) return d3.zoomIdentity;
  return d3.zoomIdentity
    .translate(width / 2, height / 2)
    .scale(MOBILE_ZOOM)
    .translate(-width / 2, -height / 2);
}

function syncZoomButtons(k) {
  const start = mapView ? defaultTransform(mapView.width, mapView.height).k : ZOOM_MIN;
  zoomOut.disabled = k <= ZOOM_MIN + 0.01;
  zoomIn.disabled = k >= ZOOM_MAX - 0.01;
  zoomReset.disabled = Math.abs(k - start) < 0.02;
  mapEl.classList.toggle("is-zoomed", k > 1.25);
}

function nameMinArea() {
  return matchMedia(`(max-width: ${MOBILE_BREAK}px)`).matches ? 200 : 420;
}

function applyLabelScale(k) {
  if (!mapView) return;
  const s = 1 / k ** (1 - LABEL_ZOOM);
  const min = nameMinArea();
  mapView.labelG.selectAll(":scope > g").each(function () {
    const area = Number(this.dataset.area);
    const code = Number(this.dataset.code);
    const show = ALWAYS_LABEL.has(code) || area * k * k >= min;
    d3.select(this)
      .attr("transform", `translate(${this.dataset.x},${this.dataset.y}) scale(${s})`)
      .attr("display", show ? null : "none");
  });
}

function applyZoom(event) {
  mapView.layers.attr("transform", event.transform);
  applyLabelScale(event.transform.k);
  hideTooltip();
  syncZoomButtons(event.transform.k);
}

function isMapFullscreen() {
  return document.fullscreenElement === mapPanel || mapPanel.classList.contains("is-fullscreen");
}

function syncFullscreenButton() {
  const on = isMapFullscreen();
  zoomFull.setAttribute("aria-pressed", String(on));
  zoomFull.setAttribute("aria-label", on ? "Tam ekrandan çık" : "Tam ekran");
  zoomFull.textContent = on ? "×" : "⛶";
}

function enterFakeFullscreen() {
  mapPanel.classList.add("is-fullscreen");
  document.body.classList.add("map-full");
}

function exitFakeFullscreen() {
  mapPanel.classList.remove("is-fullscreen");
  document.body.classList.remove("map-full");
}

function toggleFullscreen() {
  if (isMapFullscreen()) {
    if (document.fullscreenElement) document.exitFullscreen();
    exitFakeFullscreen();
    syncFullscreenButton();
    requestAnimationFrame(() => drawMap());
    return;
  }
  const useNative =
    mapPanel.requestFullscreen && window.matchMedia(`(min-width: ${MOBILE_BREAK}px)`).matches;
  if (useNative) {
    mapPanel.requestFullscreen().catch(() => {
      enterFakeFullscreen();
      syncFullscreenButton();
      requestAnimationFrame(() => drawMap());
    });
    return;
  }
  enterFakeFullscreen();
  syncFullscreenButton();
  requestAnimationFrame(() => drawMap());
}

function ensureMap() {
  const { width, height } = mapSize();
  const kept = mapView ? d3.zoomTransform(mapView.svg.node()) : null;
  if (mapView && mapView.width === width && mapView.height === height) return mapView;

  mapEl.innerHTML = "";
  const projection = d3.geoMercator().fitSize([width, height], geo);
  const path = d3.geoPath(projection);
  const svg = d3
    .select(mapEl)
    .append("svg")
    .attr("viewBox", `0 0 ${width} ${height}`)
    .attr("role", "img");
  const layers = svg.append("g").attr("class", "map-layers");
  const provinceG = layers.append("g").attr("class", "provinces");
  const labelG = layers.append("g").attr("class", "map-labels");
  const zoom = d3
    .zoom()
    .scaleExtent([ZOOM_MIN, ZOOM_MAX])
    .clickDistance(6)
    .extent([
      [0, 0],
      [width, height],
    ])
    .translateExtent([
      [0, 0],
      [width, height],
    ])
    .on("zoom", applyZoom);

  svg.call(zoom);
  svg.on("dblclick.zoom", null);
  svg.on("click", () => hideTooltip());
  mapView = { svg, layers, provinceG, labelG, zoom, path, width, height };
  svg.call(zoom.transform, kept && kept.k ? kept : defaultTransform(width, height));
  return mapView;
}

function drawMap() {
  const view = ensureMap();
  const scale = colorScale(state.mode);

  view.provinceG
    .selectAll("path.province")
    .data(geo.features, (d) => d.properties.number)
    .join("path")
    .attr("class", "province")
    .classed("is-active", (d) => d.properties.number === state.selected)
    .attr("d", view.path)
    .attr("fill", (d) => scale(valueOf(snapshot(d.properties.meta))))
    .on("pointerenter", (event, d) => {
      showTooltip(event, d.properties.meta);
    })
    .on("pointermove", (event, d) => {
      showTooltip(event, d.properties.meta);
    })
    .on("pointerleave", (event) => {
      if (event.pointerType === "touch") return;
      hideTooltip();
    })
    .on("click", (event, d) => {
      if (event.defaultPrevented) return;
      event.stopPropagation();
      showTooltip(event, d.properties.meta);
    });

  view.labelG.selectAll("*").remove();
  for (const feature of geo.features) {
    const row = snapshot(feature.properties.meta);
    const area = Math.abs(view.path.area(feature));
    const [x, y] = view.path.centroid(feature);
    const [dx, dy] = OFFSETS[row.code] || [0, 0];
    const lx = x + dx;
    const ly = y + dy;
    const g = view.labelG
      .append("g")
      .attr("data-x", lx)
      .attr("data-y", ly)
      .attr("data-area", area)
      .attr("data-code", row.code)
      .attr("transform", `translate(${lx},${ly})`);
    g.append("text").attr("class", "label-name").attr("y", area < 900 ? 3 : -3).text(row.name);
    if (area >= 900 || ALWAYS_LABEL.has(row.code)) {
      g.append("text").attr("class", "label-value").attr("y", 9).text(labelOf(valueOf(row)));
    }
  }
  applyLabelScale(d3.zoomTransform(view.svg.node()).k);
}

function resetZoom() {
  if (!mapView) return;
  mapView.svg
    .transition()
    .duration(220)
    .call(mapView.zoom.transform, defaultTransform(mapView.width, mapView.height));
}

function nudgeZoom(factor) {
  if (!mapView) return;
  mapView.svg.transition().duration(180).call(mapView.zoom.scaleBy, factor);
}

function render() {
  renderChrome();
  drawMap();
  renderLegend();
  renderList();
}

function setYear(year) {
  state.year = Number(year);
  hideTooltip();
  render();
}

function shiftYear(delta) {
  const i = years.indexOf(state.year) + delta;
  if (i >= 0 && i < years.length) setYear(years[i]);
}

yearInput.min = String(years[0]);
yearInput.max = String(years[years.length - 1]);
yearInput.step = "1";
yearInput.value = String(state.year);

const yearTicks = years
  .filter((y) => y === years[0] || y === years[years.length - 1] || y % 4 === 0)
  .filter((y, _, ticks) => !(y === 2024 && ticks.includes(2025)));
yearButtons.innerHTML = yearTicks
  .map((year) => `<button type="button" class="year" data-year="${year}">${year}</button>`)
  .join("");

yearInput.addEventListener("input", (event) => {
  setYear(event.target.value);
});

yearButtons.addEventListener("click", (event) => {
  const button = event.target.closest(".year");
  if (button) setYear(button.dataset.year);
});

yearPrev.addEventListener("click", () => shiftYear(-1));
yearNext.addEventListener("click", () => shiftYear(1));

document.addEventListener("keydown", (event) => {
  if (event.target === document.getElementById("search")) return;
  if (event.target === yearInput) return;
  if (event.key === "ArrowLeft") shiftYear(-1);
  if (event.key === "ArrowRight") shiftYear(1);
});

document.querySelectorAll(".mode").forEach((button) => {
  button.addEventListener("click", () => {
    state.mode = button.dataset.mode;
    document.querySelectorAll(".mode").forEach((b) => b.classList.toggle("is-active", b === button));
    render();
  });
});

document.getElementById("search").addEventListener("input", (event) => {
  state.query = event.target.value;
  renderList();
});

ranking.addEventListener("click", (event) => {
  const item = event.target.closest("li");
  if (!item) return;
  state.selected = Number(item.dataset.code);
  render();
});

document.addEventListener(
  "wheel",
  (event) => {
    if (event.ctrlKey) event.preventDefault();
  },
  { passive: false },
);
document.addEventListener("gesturestart", (event) => event.preventDefault());
document.addEventListener("gesturechange", (event) => event.preventDefault());

document.querySelector(".map-zoom").addEventListener("mousedown", (event) => {
  event.preventDefault();
});
zoomIn.addEventListener("click", () => nudgeZoom(1.4));
zoomOut.addEventListener("click", () => nudgeZoom(1 / 1.4));
zoomReset.addEventListener("click", resetZoom);
zoomFull.addEventListener("click", toggleFullscreen);

document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement) exitFakeFullscreen();
  syncFullscreenButton();
  requestAnimationFrame(() => drawMap());
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (!mapPanel.classList.contains("is-fullscreen")) return;
  exitFakeFullscreen();
  syncFullscreenButton();
  requestAnimationFrame(() => drawMap());
});

function syncThemeButton() {
  const dark = isDark();
  themeToggle.setAttribute("aria-label", dark ? "Açık görünüme geç" : "Koyu görünüme geç");
  themeColor.content = dark ? "#161411" : "#f4f1ea";
}

function setTheme(next, persist = true) {
  document.documentElement.dataset.theme = next;
  if (persist) localStorage.setItem(THEME_KEY, next);
  syncThemeButton();
  if (mapView) render();
}

themeToggle.addEventListener("click", () => {
  setTheme(isDark() ? "light" : "dark");
});

if (!localStorage.getItem(THEME_KEY)) {
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (event) => {
    if (localStorage.getItem(THEME_KEY)) return;
    setTheme(event.matches ? "dark" : "light", false);
  });
}

syncThemeButton();

const scrollTop = document.getElementById("scroll-top");
window.addEventListener(
  "scroll",
  () => {
    scrollTop.classList.toggle("is-visible", window.scrollY > 360);
  },
  { passive: true },
);
scrollTop.addEventListener("click", () => {
  window.scrollTo({ top: 0, behavior: "smooth" });
});

new ResizeObserver(() => {
  if (!mapView) return;
  drawMap();
  renderLegend();
}).observe(mapEl);

render();
