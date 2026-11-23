import * as maplibregl from "./vendor/maplibre-gl.mjs";

maplibregl.setWorkerUrl(new URL("./vendor/maplibre-gl-worker.mjs", import.meta.url).href);

const $ = (s) => document.querySelector(s);
const nil = (v) => v === null || v === undefined || (typeof v === "number" && !Number.isFinite(v));
const fmt = (v, d = 2, u = "") => (nil(v) ? "–" : `${Number(v).toFixed(d)}${u}`);
const pct = (v, d = 0) => (nil(v) ? "–" : `${(100 * v).toFixed(d)}%`);
const int = (v) => (nil(v) ? "–" : Number(v).toLocaleString("en-US"));
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const CLASS_NAME = { ford: "Ford-like", culvert: "Culvert-like", bridge: "Bridge-like", none: "Not measured" };
const COLORS = { ford: "#d7301f", culvert: "#f08c00", bridge: "#2b6cb0", none: "#9a9a9a" };
const MTFCC = { S1100: "primary road", S1200: "secondary road", S1400: "local road", S1500: "vehicular trail",
  S1630: "ramp", S1640: "service drive", S1740: "private road" };
const VIEW = { hays: { center: [-98.03, 30.03], zoom: 9.7 }, travis: { center: [-97.78, 30.33], zoom: 9.6 } };
const NAIP = "https://imagery.geographic.texas.gov/server/rest/services/NAIP/NAIP22_NCCIR_60cm/ImageServer/exportImage";

function naipUrl(lon, lat, half = 64) {
  const R = 6378137;
  const x = (R * lon * Math.PI) / 180;
  const y = R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  const h = half / Math.cos((lat * Math.PI) / 180);
  return `${NAIP}?bbox=${x - h},${y - h},${x + h},${y + h}&bboxSR=3857&imageSR=3857&size=256,256&format=jpg&bandIds=0,1,2&f=image`;
}

const get = (p) => fetch(p).then((r) => { if (!r.ok) throw new Error(`${p}: ${r.status}`); return r.json(); });
const [X, T, N, R, S] = await Promise.all(["data/crossings.json", "data/txgio.json", "data/nbi.json",
  "data/results.json", "data/spot.json"].map(get));
let P = null;                                   // profiles, loaded on first use
const profiles = async () => (P ??= await get("data/profiles.json"));
const byId = new Map(X.map((x, i) => [x.id, i]));

const fc = (rows, props) => ({ type: "FeatureCollection", features: rows.map((r, i) => ({
  type: "Feature", geometry: { type: "Point", coordinates: [r.lon, r.lat] }, properties: props(r, i) })) });

const map = new maplibregl.Map({
  container: "map", hash: true, ...VIEW.hays, maxZoom: 18.5, attributionControl: { compact: false },
  style: {
    version: 8,
    sources: {
      osm: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, maxzoom: 19,
        attribution: "© OpenStreetMap contributors" },
      naip: { type: "raster", tiles: [`${NAIP}?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=jpg&bandIds=0,1,2&f=image`],
        tileSize: 256, minzoom: 13, maxzoom: 19, attribution: "NAIP 2022: USDA, served by TxGIO" },
    },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": "#f2f1ec" } },
      { id: "osm", type: "raster", source: "osm", paint: { "raster-saturation": -0.6, "raster-opacity": 0.9 } },
      { id: "naip", type: "raster", source: "naip", minzoom: 13 },
    ],
  },
});
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-right");

let selected = null;
let spotMode = false;

map.on("load", () => {
  map.addSource("x", { type: "geojson", data: fc(X, (r, i) => ({ i, pred: r.ok && r.pred ? r.pred : "none", sc: nil(r.sc) ? -1 : r.sc, k: r.txt ? 1 : 0 })) });
  map.addSource("t", { type: "geojson", data: fc(T, (r, i) => ({ i })) });
  map.addSource("n", { type: "geojson", data: fc(N, (r, i) => ({ i })) });
  map.addSource("sel", { type: "geojson", data: fc([], () => ({})) });
  map.addLayer({ id: "n-dots", type: "circle", source: "n", layout: { visibility: "none" },
    paint: { "circle-color": "#111", "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 1.4, 14, 3.5],
      "circle-stroke-color": "#fff", "circle-stroke-width": 0.8 } });
  map.addLayer({ id: "t-rings", type: "circle", source: "t",
    paint: { "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": "#111",
      "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 9, 1.4, 14, 2.4],
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 3.4, 13, 6.5, 16, 11] } });
  map.addLayer({ id: "x-circles", type: "circle", source: "x",
    paint: { "circle-color": ["match", ["get", "pred"], "ford", COLORS.ford, "culvert", COLORS.culvert, "bridge", COLORS.bridge, COLORS.none],
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 2.1, 13, 4.2, 16, 7.5],
      "circle-stroke-color": "#fff", "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 9, 0.4, 14, 1.2] } });
  map.addLayer({ id: "sel-ring", type: "circle", source: "sel",
    paint: { "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": "#ffd400", "circle-stroke-width": 3,
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 7, 16, 15] } });
  map.on("click", "x-circles", (e) => select(e.features[0].properties.i, false));
  map.on("mouseenter", "x-circles", () => (map.getCanvas().style.cursor = "pointer"));
  map.on("mouseleave", "x-circles", () => (map.getCanvas().style.cursor = ""));
  applyFilters();
  const want = new URLSearchParams(location.search).get("id");
  if (want && byId.has(want)) select(byId.get(want), true);
});

function applyFilters() {
  if (!map.getLayer("x-circles")) return;
  const m = Number($("#minscore").value);
  const kn = $("#known").value;
  $("#minscore-v").textContent = m;
  const conds = [];
  if (m > 0) conds.push([">=", ["get", "sc"], m]);
  if (kn !== "all") conds.push(["==", ["get", "k"], kn === "known" ? 1 : 0]);
  map.setFilter("x-circles", conds.length ? ["all", ...conds] : null);
  const vis = (id, on) => map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
  vis("x-circles", $("#show-x").checked);
  vis("t-rings", $("#show-t").checked && !spotMode);
  vis("n-dots", $("#show-n").checked && !spotMode);
  vis("naip", $("#show-aerial").checked);
  map.setPaintProperty("x-circles", "circle-color", spotMode ? "#ffffff"
    : ["match", ["get", "pred"], "ford", COLORS.ford, "culvert", COLORS.culvert, "bridge", COLORS.bridge, COLORS.none]);
  const shown = X.filter((r) => (m > 0 ? !nil(r.sc) && r.sc >= m : true) && (kn === "all" || (kn === "known") === !!r.txt));
  const f = shown.filter((r) => r.ok && r.pred === "ford");
  const fNew = f.filter((r) => !r.txt).length;
  $("#count").textContent = `${int(shown.length)} crossings shown: ${int(f.length)} ford-like, of which ${int(fNew)} are not in TxGIO (unverified).`;
}
for (const id of ["#minscore", "#known", "#show-x", "#show-t", "#show-n", "#show-aerial"]) $(id).addEventListener("input", applyFilters);
for (const b of document.querySelectorAll(".fly")) b.addEventListener("click", () => map.flyTo({ ...VIEW[b.dataset.county], duration: 1500 }));
for (const b of document.querySelectorAll(".tabs button")) b.addEventListener("click", () => {
  for (const x of document.querySelectorAll(".tabs button")) x.classList.toggle("on", x === b);
  for (const t of document.querySelectorAll(".tab")) t.classList.toggle("on", t.id === `tab-${b.dataset.tab}`);
  spotMode = b.dataset.tab === "spot";
  applyFilters();
  if (spotMode) renderSpot();
});

// ------------------------------------------------------------------ detail card

function profileSvg(pr, r) {
  if (!pr) return "";
  const W = 360, H = 150, L = 40, B = 22, T0 = 10, R0 = 8;
  const xs = pr.z.map((_, k) => pr.s0 + k * pr.step);
  const zs = pr.z.filter((v) => v !== null);
  if (!zs.length) return "";
  let lo = Math.min(...zs, nil(r.chn) ? Infinity : r.chn), hi = Math.max(...zs);
  if (hi - lo < 2) { const m = (hi + lo) / 2; lo = m - 1; hi = m + 1; }
  lo -= 0.3; hi += 0.3;
  const sx = (s) => L + ((s - xs[0]) / (xs[xs.length - 1] - xs[0])) * (W - L - R0);
  const sy = (z) => T0 + (1 - (z - lo) / (hi - lo)) * (H - T0 - B);
  let path = "", pen = false;
  pr.z.forEach((z, k) => { if (z === null) { pen = false; return; } path += `${pen ? "L" : "M"}${sx(xs[k]).toFixed(1)},${sy(z).toFixed(1)} `; pen = true; });
  const ch = nil(r.chn) ? "" : `<line x1="${L}" x2="${W - R0}" y1="${sy(r.chn)}" y2="${sy(r.chn)}" stroke="#2b6cb0" stroke-dasharray="4 3"/>
    <text x="${W - R0}" y="${sy(r.chn) - 4}" text-anchor="end" font-size="10" fill="#2b6cb0">stream level ${fmt(r.chn, 1)} m</text>`;
  const ticks = [-50, 0, 50].map((s) => `<text x="${sx(s)}" y="${H - 6}" text-anchor="middle" font-size="10" fill="#555">${s > 0 ? "+" : ""}${s} m</text>`).join("");
  return `<svg class="profile" viewBox="0 0 ${W} ${H}" role="img" aria-label="Road profile">
    <text x="${L}" y="${T0 + 2}" font-size="10" fill="#555">${fmt(hi, 1)} m</text>
    <text x="${L}" y="${H - B - 2}" font-size="10" fill="#555">${fmt(lo, 1)} m</text>
    ${ch}<path d="${path}" fill="none" stroke="#161616" stroke-width="2"/>
    <circle cx="${sx(0)}" cy="${sy(r.low)}" r="4" fill="#d7301f"/>
    <text x="${sx(0) + 6}" y="${sy(r.low) + 12}" font-size="10" fill="#d7301f">lowest road point</text>${ticks}
    <text x="${W - R0}" y="${T0 + 2}" text-anchor="end" font-size="10" fill="#555">road surface along the road</text></svg>`;
}

const reviews = load("txcross-reviews");
function load(k) { try { return JSON.parse(localStorage.getItem(k) || "{}"); } catch { return {}; } }
function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } }

function known(r) {
  const out = [];
  if (r.txt) out.push(`TxGIO: <b>${esc(r.txt.toLowerCase())}</b>${r.lvgi ? " (volunteered)" : ""}, ${fmt(r.txd, 0)} m away${r.troad ? `, ${esc(r.troad)}` : ""}${r.tflow ? ` over ${esc(r.tflow)}` : ""}`);
  if (r.nbi) out.push(`NBI: <b>${r.nbi}</b> ${esc(r.nid || "")}, ${fmt(r.nbd, 0)} m away${nil(r.n71) || r.n71 === "N" ? "" : `, waterway rating ${esc(r.n71)}`}`);
  return out.length ? out.join("<br>") : "Not in the TxGIO or NBI inventories.";
}

async function select(i, fly) {
  const r = X[i];
  selected = i;
  map.getSource("sel").setData(fc([r], () => ({})));
  if (fly) map.flyTo({ center: [r.lon, r.lat], zoom: Math.max(map.getZoom(), 16.5), duration: 1200 });
  const pr = (await profiles())[r.id];
  const cls = r.ok && r.pred ? r.pred : "none";
  const tier = (t) => `<span class="tier">${t}</span>`;
  const rev = reviews[r.id]?.v;
  $("#detail").innerHTML = `<div class="card">
    <h3>Crossing ${esc(r.id)} · ${r.c === "hays" ? "Hays" : "Travis"}</h3>
    <span class="badge ${cls}">${CLASS_NAME[cls]}${r.ok && !nil(r.p) ? ` · ${pct(r.p)}` : ""}</span> ${r.ok ? tier("classified, model G") : ""}
    <p>${known(r)}</p>
    ${nil(r.sc) ? "" : `<p><b>Screening score ${r.sc} / 10</b> ${tier("screening")}<br>
      type ${r.pt} + clearance ${r.pc} + drainage ${r.pd} + no sign ${r.ps}</p>`}
    <div class="imgs">
      <figure><img alt="Hillshade from 1 m lidar" src="chips/${esc(r.id)}.png" onerror="this.style.visibility='hidden'"><figcaption>1 m lidar hillshade, 128 m (red ring: crossing point)</figcaption></figure>
      <figure><img alt="Aerial photo" src="${naipUrl(r.lon, r.lat)}"><figcaption>NAIP 2022 aerial, 128 m</figcaption></figure>
    </div>
    ${profileSvg(pr, r)}
    <table>
      <tr><th>Measurement</th><th class="num">Value</th><th>Tier</th></tr>
      <tr><td>Clearance: lowest road point above the stream</td><td class="num"><b>${fmt(r.clr, 2, " m")}</b></td><td>${tier("measured")}</td></tr>
      <tr><td>Lowest road point (crossing)</td><td class="num">${fmt(r.low, 2, " m")}</td><td>${tier("measured")}</td></tr>
      <tr><td>Stream level beside the road</td><td class="num">${fmt(r.chn, 2, " m")}</td><td>${tier("measured")}</td></tr>
      <tr><td>Approach: highest minus lowest road point (±50 m)</td><td class="num">${fmt(r.apr, 2, " m")}</td><td>${tier("measured")}</td></tr>
      <tr><td>Steepest road slope near the crossing</td><td class="num">${pct(r.grd)}</td><td>${tier("measured")}</td></tr>
      <tr><td>Library cut (h3-lowpoints): stream level / lowered</td><td class="num">${fmt(r.lev, 2)} / ${fmt(r.lwr, 2, " m")}</td><td>${tier("measured")}</td></tr>
      <tr><td>Upstream drainage area</td><td class="num">${r.dl ? "≥ " : ""}${fmt(r.da, 2, " km²")}</td><td>${tier("derived, 10 m")}</td></tr>
      <tr><td>Found by</td><td class="num">${[r.ma ? "mapped stream (NHD)" : "", r.mb ? "drainage line (10 m)" : ""].filter(Boolean).join(" + ")}</td><td></td></tr>
      <tr><td>Road</td><td class="num">${esc(MTFCC[r.mt] || r.mt || "–")}</td><td>${tier("TIGER 2024")}</td></tr>
      <tr><td>Lidar survey</td><td class="num">${esc(r.surv || "–")}</td><td>${tier(esc(r.sdate || ""))}</td></tr>
    </table>
    ${r.ok ? "" : `<p class="hint">The 1 m measurement did not pass its checks here (no clear low point on the road, or missing lidar), so this crossing has no class or score.</p>`}
    <div class="review">Review:
      ${["confirm", "reject", "unsure"].map((v) => `<button class="btn ${rev === v ? "on" : ""}" data-v="${v}">${v}</button>`).join("")}
      <button class="btn" id="export-rev">Export reviews (CSV)</button>
    </div></div>`;
  for (const b of document.querySelectorAll("#detail .review [data-v]")) b.addEventListener("click", () => {
    reviews[r.id] = { v: b.dataset.v, t: new Date().toISOString() }; save("txcross-reviews", reviews); select(i, false);
  });
  $("#export-rev").addEventListener("click", () => download("crossing_reviews.csv",
    ["id,county,predicted,known_label,review,time", ...Object.entries(reviews).map(([id, v]) => {
      const x = X[byId.get(id)] || {}; return [id, x.c, x.pred, x.label, v.v, v.t].join(",");
    })].join("\n")));
}

function download(name, text) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  a.download = name; a.click(); URL.revokeObjectURL(a.href);
}

// ------------------------------------------------------------------ results and method

function kpi(lab, val, note = "") { return `<div class="kpi"><div class="lab">${lab}</div><div class="big">${val}</div>${note ? `<div class="hint">${note}</div>` : ""}</div>`; }
function verdict(ok) { return ok === true ? `<span class="pass">PASS</span>` : ok === false ? `<span class="fail">FAIL</span>` : "–"; }

function renderResults() {
  const h = R.hays || {}, t = R.travis || {};
  const hr = h.kill_i_recall?.not_vgi || {}, tr = t.recall?.not_vgi || {};
  const sep = h.kill_ii_separation || {};
  const g = h.model_g?.[h.model_g?.chosen] || {};
  const ho = t.held_out || {};
  $("#tab-results").innerHTML = `
    <h2>Hays County: training (cross-validated)</h2>
    <div class="kpis">
      ${kpi("Crossings found", int(h.n_crossings), `${int(h.n_measured_ok)} measured from 1 m lidar`)}
      ${kpi("Known low-water crossings found (within 30 m)", pct(hr.recall_30m), `${int(hr.n)} TxGIO points, not volunteered · kill test ${verdict(h.kill_i_pass)} (≥ 70%)`)}
      ${kpi("Fords vs bridges from measurements alone", fmt(sep.auc, 2), `AUC, 95% CI ${fmt(sep.ci95?.[0], 2)} to ${fmt(sep.ci95?.[1], 2)} · kill test ${verdict(sep.pass)} (≥ 0.80)`)}
      ${kpi("Ford precision / recall", `${pct(g.ford_vs_rest?.precision)} / ${pct(g.ford_vs_rest?.recall)}`, `model G (${esc(h.model_g?.chosen || "")}), grouped 5-fold cross-validation`)}
    </div>
    <h2>Travis County: held-out test (rules frozen before any Travis computation)</h2>
    <div class="kpis">
      ${kpi("Crossings found", int(t.n_crossings), `${int(t.n_measured_ok)} measured from 1 m lidar`)}
      ${kpi("Known low-water crossings found (within 30 m)", pct(tr.recall_30m), `${int(tr.n)} TxGIO points, not volunteered`)}
      ${kpi("Ford precision / recall", `${pct(ho.ford_vs_rest?.precision)} / ${pct(ho.ford_vs_rest?.recall)}`, "on Travis crossings with a TxGIO or NBI label; the model never saw Travis")}
      ${kpi("Ford-like crossings not in TxGIO", int(t.new_likely_fords), "the road dips to the stream or swale; unverified: blind spot check of 50 in the Spot check tab")}
    </div>
    ${baseRate(g, ho)}
    <h2>Per class</h2>${classTable(g, "Hays, out-of-fold")}${classTable(ho, "Travis, held-out")}
    <p class="hint">Targets from the brief, reported against and not promised: ford precision ≥ 85%, recall ≥ 75%.
      Labels: TxGIO fords and bridge-class points (not volunteered) and NBI 2025 bridges and culverts over waterways.
      Model file sha256 ${esc((t.model_sha256 || h.model_g?.sha256 || "").slice(0, 16))}…; rules: docs/eval_rules.md.</p>
    <h2>Run</h2><p class="hint">${esc(R.meta?.runtime || "")}</p>`;
}

function rates(rep) {
  const m = rep?.confusion?.matrix;
  if (!m) return null;
  const sum = (r) => r.reduce((a, b) => a + b, 0);
  const fords = sum(m[0]), others = sum(m[1]) + sum(m[2]);
  return { hit: m[0][0] / fords, alarm: (m[1][0] + m[2][0]) / others, share: fords / (fords + others) };
}

function baseRate(g, ho) {
  const a = rates(g), b = rates(ho);
  if (!a || !b) return "";
  return `<h2>Why ford precision drops in Travis</h2>
    <p>The classifier behaved the same in both counties: it caught ${pct(a.hit)} of fords in Hays and ${pct(b.hit)} in Travis,
    and wrongly called ${pct(a.alarm)} of non-fords "ford" in Hays and ${pct(b.alarm)} in Travis.
    But fords are ${pct(a.share)} of the labelled structures in Hays and only ${pct(b.share)} in Travis (mostly bridges and
    culverts from the bridge inventory), so the same false-alarm rate gives far more false fords there.
    Measurements alone are not enough to flag fords reliably in an urban county; the next step is to add the aerial imagery.</p>`;
}

function classTable(rep, title) {
  if (!rep || !rep.ford) return "";
  const rows = ["ford", "culvert", "bridge"].map((c) => `<tr><td>${c}</td><td class="num">${int(rep[c]?.n)}</td><td class="num">${pct(rep[c]?.precision)}</td><td class="num">${pct(rep[c]?.recall)}</td></tr>`).join("");
  return `<p><b>${title}</b></p><table><tr><th>Class</th><th class="num">Labelled</th><th class="num">Precision</th><th class="num">Recall</th></tr>${rows}</table>`;
}

function renderMethod() {
  $("#tab-method").innerHTML = `
    <h2>How each crossing is found and measured</h2>
    <ol>
      <li><b>Find:</b> every place a road (Census TIGER 2024) crosses a mapped stream (USGS NHD), plus every place it crosses a drainage line traced from 10 m elevation (upstream area ≥ 0.1 km²). The drainage lines catch channels the maps miss. Points within 25 m are one crossing.</li>
      <li><b>Measure from 1 m lidar</b> (USGS 3DEP, read straight from USGS): the road surface every metre along the road, its lowest point near the stream (where water goes over first), the stream level beside the road, and <b>clearance</b> = lowest road point − stream level. A ford sits near 0 m; a culvert under fill sits higher.</li>
      <li><b>Classify</b> (model G): ford, culvert or bridge from the measurements only (no imagery yet), trained on Hays County labels (TxGIO, NBI) and checked by cross-validation in blocks of about 36 km².</li>
      <li><b>Test once on Travis</b> with rules fixed in advance (docs/eval_rules.md).</li>
      <li><b>Rank</b> with a points table (docs/score.md): type, clearance, drainage area, no warning sign. A screening score, not a forecast.</li>
    </ol>
    <h2>Certainty tiers</h2>
    <ul><li><b>measured</b>: geometry from 1 m lidar (survey TX Central B1 2017 for most of both counties).</li>
      <li><b>derived</b>: drainage area from 10 m routing; "≥" where the catchment reaches the edge of the area routed.</li>
      <li><b>classified</b>: model output, with its held-out precision and recall.</li>
      <li><b>screening</b>: the score.</li></ul>
    <h2>Limits</h2>
    <ul>
      <li>In this lidar the ground under bridges sits lower than at fords, consistent with bridge decks being removed from the bare-earth model; clearance alone confuses them, and the steepest road slope near the crossing carries most of the difference.</li>
      <li>Ford precision does not transfer from Hays to Travis (76% to 22%): the same false-alarm rate meets far fewer fords among Travis's labelled structures. See Results.</li>
      <li>The screening score did not track the bridge inspectors' overtopping rating (NBI item 71) in either county: the score is not validated.</li>
      <li>The lidar is from 2017; the aerial photos are from 2022. Crossings rebuilt in between disagree.</li>
      <li>Hays labels come mostly from the county; Travis labels from FIS, atxfloods and volunteers.</li>
      <li>Few labels in some classes: 25 unvented fords and 23 bridge-class points in Hays.</li>
      <li>Drainage area is topographic; over the Edwards recharge zone the real contributing area differs.</li>
      <li>NBI coordinates are coarse (matched within 100 m).</li>
      <li>Not yet done: imagery model (CNN), hand-labelled gold set, statewide run, hydraulics.</li>
    </ul>`;
}

// ------------------------------------------------------------------ blind spot check (Travis)

const spot = load("txcross-spot");
let spotK = 0;
async function renderSpot() {
  const ids = S.ids || [];
  if (!ids.length) { $("#tab-spot").innerHTML = "<p class='hint'>No spot-check sample.</p>"; return; }
  spotK = Math.min(spotK, ids.length - 1);
  const id = ids[spotK], r = X[byId.get(id)];
  const done = ids.filter((x) => spot[x]).length;
  map.getSource("sel")?.setData(fc([r], () => ({})));
  map.jumpTo({ center: [r.lon, r.lat], zoom: 17 });
  const pr = (await profiles())[r.id];
  $("#tab-spot").innerHTML = `<h2>Blind spot check: Travis</h2>
    <p class="hint">${ids.length} Travis crossings in random order: half are predicted fords that TxGIO does not list,
      half are other crossings. The prediction is hidden. Is this a ford (the road dips through the stream bed)?</p>
    <p><b>${spotK + 1} of ${ids.length}</b> · answered ${done}</p>
    <div class="imgs">
      <figure><img alt="Hillshade" src="chips/${esc(id)}.png"><figcaption>1 m lidar hillshade, 128 m</figcaption></figure>
      <figure><img alt="Aerial" src="${naipUrl(r.lon, r.lat)}"><figcaption>NAIP 2022 aerial, 128 m</figcaption></figure>
    </div>${profileSvg(pr, r)}
    <div class="review">${[["ford", "Ford"], ["not", "Not a ford"], ["unsure", "Unsure"]].map(([v, l]) =>
      `<button class="btn ${spot[id] === v ? "on" : ""}" data-v="${v}">${l}</button>`).join("")}
      <button class="btn" id="spot-prev">◀</button><button class="btn" id="spot-next">▶</button>
      <button class="btn" id="spot-export">Export answers (CSV)</button></div>`;
  for (const b of document.querySelectorAll("#tab-spot [data-v]")) b.addEventListener("click", () => {
    spot[id] = b.dataset.v; save("txcross-spot", spot); spotK = Math.min(spotK + 1, ids.length - 1); renderSpot();
  });
  $("#spot-prev").addEventListener("click", () => { spotK = Math.max(spotK - 1, 0); renderSpot(); });
  $("#spot-next").addEventListener("click", () => { spotK = Math.min(spotK + 1, ids.length - 1); renderSpot(); });
  $("#spot-export").addEventListener("click", () => download("spot_check_answers.csv",
    ["id,answer", ...ids.filter((x) => spot[x]).map((x) => `${x},${spot[x]}`)].join("\n")));
}

renderResults();
renderMethod();
window.__demo = { map, X, select, byId };
