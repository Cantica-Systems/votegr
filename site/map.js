// The self-drawn basemap and the license plate camera marker and popup.

import { displayCase, esc } from './voting.js';

// ---- Basemap layer ----
// No tiles: a tile server would see every pan. Drawing from data the page already holds
// is what lets the site say nothing leaves the browser.
// Canvas, not SVG: about 39k street segments as DOM nodes would crawl on a phone.

// Keyed by the road class scripts/build_graph.py stamps. w: screen px at each of STOPS.
const CLASS = {
  1: { name: 'motorway', w: [1.6, 2.6, 5.0, 7.0], minZ: 9,  casing: 1.6 },
  2: { name: 'primary',  w: [1.0, 2.0, 3.6, 5.4], minZ: 10, casing: 1.3 },
  3: { name: 'arterial', w: [0.7, 1.4, 2.8, 4.2], minZ: 11, casing: 1.1 },
  4: { name: 'collector',w: [0.5, 1.0, 2.2, 3.4], minZ: 12, casing: 1.0 },
  5: { name: 'local',    w: [0,   0.6, 1.6, 2.6], minZ: 13, casing: 0.9 },
  // Class 6: a driveway in the city, but 30% of township roads, so it is drawn from z13.
  6: { name: 'private',  w: [0,   0.5, 1.2, 1.9], minZ: 13, casing: 0.6  }
};

// Names the label pass skips: alleys, and ramps, whose long names carpet every interchange.
const ALLEY = /\bALY\b|\bALLEY\b/i;
const RAMP = /\bRAMP\b/i;

const STOPS = [10, 13, 15, 17];
function widthFor(cls, z) {
  const w = CLASS[cls] ? CLASS[cls].w : CLASS[5].w;
  if (z <= STOPS[0]) return w[0];
  if (z >= STOPS[3]) return w[3] * 1.18 ** (z - STOPS[3]);
  for (let i = 1; i < STOPS.length; i++) {
    if (z <= STOPS[i]) {
      const t = (z - STOPS[i - 1]) / (STOPS[i] - STOPS[i - 1]);
      return w[i - 1] + (w[i] - w[i - 1]) * t;
    }
  }
  return w[3];
}

function palette(dark) {
  return dark ? {
    land:   '#20242c',
    water:  '#18303f',
    green:  '#1e2a24',
    rail:   '#333a45',
    casing: '#161a21',
    // Local and private are lifted off the land: in a township they are most of the map.
    road: { motorway: '#4a5361', primary: '#3e4652', arterial: '#373e49',
            collector: '#353c48', local: '#38404d', private: '#333a46' },
    label:  '#c3ccd8', labelHalo: '#12161d', labelRoute: '#ffffff',
    // No jurisdiction in the county has a fourth ward; a ward 4 would paint as a township.
    wardHue: { '1': 265, '2': 190, '3': 32 },
    wardSat: 54, wardL: 50, wardLStep: 6, wardAlpha: .26,
    scopeHue: 210, scopeBorder: '#ffd76a',
    precinct: '#b5a6f0', precinctActive: '#ffffff',
    precinctHalo: 'rgba(10,13,18,.8)',
    precinctFill: 'rgba(139,131,176,.12)',
    boundary: '#4a5361'
  } : {
    // Land is kept off white so the white roads register against it.
    land:   '#e9e6df',
    water:  '#bcd6e6',
    green:  '#d7e3cf',
    rail:   '#c9c5bc',
    casing: '#d5d1c7',
    road: { motorway: '#f0c97a', primary: '#fdf6e6', arterial: '#ffffff',
            collector: '#ffffff', local: '#ffffff', private: '#f9f7f2' },
    label:  '#4a4640', labelHalo: '#ffffff', labelRoute: '#1d1b17',
    wardHue: { '1': 265, '2': 190, '3': 32 },
    wardSat: 60, wardL: 46, wardLStep: 6, wardAlpha: .22,
    scopeHue: 210, scopeBorder: '#8a5b00',
    precinct: '#6d4fa8', precinctActive: '#3f1f86',
    precinctHalo: 'rgba(255,255,255,.85)',
    precinctFill: 'rgba(124,108,168,.08)',
    boundary: '#a9a496'
  };
}

function shieldFor(name) {
  const m = String(name || '').toUpperCase()
    .match(/^(I|US|M)[-\s]?(\d+)\b/);
  if (!m) return null;
  return { kind: m[1], num: m[2] };
}

function drawShield(ctx, sh, x, y, dark) {
  const num = sh.num, wide = num.length > 2;
  const w = wide ? 26 : 21, h = 17, r = 3;
  ctx.save();
  ctx.translate(x, y);
  ctx.font = `700 ${wide ? 10 : 11}px "Hanken Grotesk", system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  function box(fill, stroke, lw) {
    ctx.beginPath();
    const x0 = -w / 2, y0 = -h / 2;
    ctx.moveTo(x0 + r, y0);
    ctx.arcTo(x0 + w, y0, x0 + w, y0 + h, r);
    ctx.arcTo(x0 + w, y0 + h, x0, y0 + h, r);
    ctx.arcTo(x0, y0 + h, x0, y0, r);
    ctx.arcTo(x0, y0, x0 + w, y0, r);
    ctx.closePath();
    ctx.fillStyle = fill; ctx.fill();
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 1.5; ctx.stroke(); }
  }

  ctx.globalAlpha = 0.82;
  if (sh.kind === 'I') {
    box('#2c4a86', '#ffffff', 1.4);
    ctx.fillStyle = '#b34a5c';                       // the red cap
    ctx.fillRect(-w / 2 + 1.6, -h / 2 + 1.6, w - 3.2, 3.6);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(num, 0, 2);
  } else {
    box(dark ? '#dcd9d2' : '#fbfaf7', '#6b6d73', 1.3);
    ctx.fillStyle = '#3a3d44';
    ctx.fillText(num, 0, 0.5);
  }
  ctx.restore();
}

// Labels keep this far (CSS px) from a camera's centre: half the marker SIZE below, plus 10.
const MARKER_R = 29;

// The edge index tie-break makes the order total, so the same block wins every redraw.
function betterBlock(x, y) {
  if (x.rd !== y.rd) return x.rd < y.rd;
  if (x.len !== y.len) return x.len > y.len;
  return x.idx < y.idx;
}

// wx/wy turn canvas px into world px, so the cells stay put on the ground during a pan.
function spanCells(mx, my, ang, tw, fontPx, CELL, wx, wy) {
  const out = [], seen = {};
  const half = tw / 2, cosA = Math.cos(ang), sinA = Math.sin(ang);
  const steps = Math.max(2, Math.ceil(tw / (CELL * 0.55)));
  for (let i = 0; i <= steps; i++) {
    const t = -half + (tw * i / steps);
    const x = mx + t * cosA, y = my + t * sinA;
    for (let s2 = -1; s2 <= 1; s2 += 2) {            // a little vertical body
      const ox = x - s2 * (fontPx * 0.34) * sinA + wx;
      const oy = y + s2 * (fontPx * 0.34) * cosA + wy;
      const k = `${Math.round(ox / CELL)}:${Math.round(oy / CELL)}`;
      if (!seen[k]) { seen[k] = 1; out.push(k); }
    }
  }
  return out;
}

// Names arrive in ALL CAPS; displayCase (voting.js) spells them as the step list does.
function labelText(name) {
  return displayCase(name);
}

const BasemapLayer = L.Layer.extend({
  initialize(opts) {
    this._graph = opts.graph;
    this._land = opts.landcover || null;
    this._dark = !!opts.dark;
    this._buckets = null;
    this._outlines = {};
  },

  setDark(d) { this._dark = !!d; this._redraw(); },

  setPrecincts(list) {
    this._precincts = list || null;
    this._redraw();
  },

  // Outlines ship in precincts.json (scripts/build_precincts.py). They cannot be derived here
  // from edges seen once: each precinct is thinned separately, so shared borders never match.
  setJurisdictions(list) {
    this._outlines = {};
    for (const j of list || []) {
      if (j?.outline) this._outlines[String(j.mcd)] = j.outline;
    }
    this._scopeBorder = this._outline(this._scopeMcd);
    this._redraw();
  },

  _outline(mcd) {
    return mcd == null ? null : (this._outlines || {})[String(mcd)] || null;
  },

  setScope(mcd) {
    this._scopeMcd = mcd == null ? null : String(mcd);
    this._scopeBorder = this._outline(this._scopeMcd);
    this._redraw();
  },

  // The state's 13-digit code: precinct numbers repeat across jurisdictions.
  _pid(pr) {
    return String(pr.code);
  },

  setLayerOpts(o) {
    this._opts = o || {};
    this._redraw();
  },

  setActivePrecinct(id) {
    this._activePrecinct = id == null ? null : String(id);
    this._redraw();
  },

  // Camera markers are DOM elements above the canvas, so labels learn their [lat, lng] here.
  setObstacles(pts) {
    this._obstacles = pts?.length ? pts : null;
    this._redraw();
  },

  setRouteStreets(names, pts) {
    this._routeStreets = {};
    (names || []).forEach((n) => {
      if (n) this._routeStreets[String(n).toUpperCase()] = 1;
    });
    this._routePts = pts || null;
    this._redraw();
  },
  setData(graph, land) {
    this._graph = graph; this._land = land; this._buckets = null; this._redraw();
  },

  onAdd(map) {
    this._map = map;

    // Ground goes under the route; labels get their own pane over it so the route cannot hide them.
    this._canvas = L.DomUtil.create('canvas', 'basemap-canvas');
    this._canvas.style.position = 'absolute';
    // Origin top left: _onZoom scales this canvas, and about its centre it would slide away.
    this._canvas.style.transformOrigin = '0 0';
    map.getPane('tilePane').appendChild(this._canvas);

    if (!map.getPane('basemapLabels')) {
      const lp = map.createPane('basemapLabels');
      lp.style.zIndex = 450;             // overlayPane is 400, markers 600
      lp.style.pointerEvents = 'none';
    }
    this._labelCanvas = L.DomUtil.create('canvas', 'basemap-labels');
    this._labelCanvas.style.position = 'absolute';
    this._labelCanvas.style.transformOrigin = '0 0';
    map.getPane('basemapLabels').appendChild(this._labelCanvas);

    // Redraw only when the map settles, once per frame: a drag already moves the canvases with
    // their pane, and repainting on every `move` held panning to about 20fps.
    this._schedule = this._schedule.bind(this);
    map.on('zoomend moveend viewreset resize', this._schedule, this);
    map.on('zoomanim', this._onZoomAnim, this);
    // Fires on every frame of a pinch; see _onZoom.
    map.on('zoom', this._onZoom, this);
    this._redraw();
  },

  onRemove(map) {
    map.off('zoomend moveend viewreset resize', this._schedule, this);
    map.off('zoomanim', this._onZoomAnim, this);
    map.off('zoom', this._onZoom, this);
    if (this._raf) cancelAnimationFrame(this._raf);
    [this._canvas, this._labelCanvas].forEach((c) => {
      if (c?.parentNode) c.parentNode.removeChild(c);
    });
  },

  // Edges grouped by class once, so a frame strokes a few long paths, not 39k short ones.
  _bucket() {
    if (!this._graph) return {};
    if (this._buckets) return this._buckets;
    const b = {};
    const g = this._graph, n = g.edgeCount();
    for (let i = 0; i < n; i++) {
      const c = g.edgeClass(i) || 5;
      (b[c] || (b[c] = [])).push(g.edgePoly(i));
    }
    this._buckets = b;
    return b;
  },

  // A zoom animation would show stretched roads, so hide until the redraw lands.
  _onZoomAnim() {
    if (this._canvas) this._canvas.style.opacity = '0';
    if (this._labelCanvas) this._labelCanvas.style.opacity = '0';
  },

  // A pinch fires no zoomanim and transforms no pane: markers follow the fractional zoom,
  // these canvases do not. So scale the last picture about _drawnCenter until zoomend.
  // Zoom only: a drag already moves the canvases with their pane.
  _onZoom() {
    const map = this._map, cv = this._canvas, lc = this._labelCanvas;
    if (!map || !cv || this._drawnCenter == null) return;
    const s = map.getZoomScale(map.getZoom(), this._drawnZoom);
    const mid = map.latLngToLayerPoint(this._drawnCenter);
    const pos = L.point(mid.x - this._drawnW / 2 * s, mid.y - this._drawnH / 2 * s);
    L.DomUtil.setTransform(cv, pos, s);
    if (lc) L.DomUtil.setTransform(lc, pos, s);
  },

  _schedule() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = 0;
      this._redraw();
    });
  },

  _redraw() {
    if (!this._map || !this._canvas) return;
    const map = this._map, cv = this._canvas;
    const size = map.getSize();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const lc = this._labelCanvas;
    const PAD = 0.35;                                  // of a viewport, each side
    const padX = Math.round(size.x * PAD), padY = Math.round(size.y * PAD);
    const cw = size.x + padX * 2, ch = size.y + padY * 2;
    [cv, lc].forEach((c) => {
      if (!c) return;
      if (c.width !== cw * dpr || c.height !== ch * dpr) {
        c.width = cw * dpr; c.height = ch * dpr;
        c.style.width = `${cw}px`; c.style.height = `${ch}px`;
      }
      c.style.opacity = '1';
    });
    const tl = map.containerPointToLayerPoint([0, 0]);
    const origin = L.point(tl.x - padX, tl.y - padY);
    // setPosition also clears any scale a pinch left behind.
    L.DomUtil.setPosition(cv, origin);
    if (lc) L.DomUtil.setPosition(lc, origin);

    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);

    const lctx = lc ? lc.getContext('2d') : null;
    if (lctx) {
      lctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      lctx.clearRect(0, 0, cw, ch);
    }

    const P = palette(this._dark), z = map.getZoom();

    // For _onZoom. The padding is symmetric, so the canvas middle is the map centre.
    this._drawnCenter = map.getCenter();
    this._drawnZoom = z;
    this._drawnW = cw; this._drawnH = ch;

    // The legend swatches (--lg-* in style.css) read these, so key and map match in both themes.
    // Wards are published solid: the map's alpha would be a washed-out smear at swatch size.
    try {
      const rs = document.documentElement.style;
      rs.setProperty('--lg-precinct', P.precinct);
      for (const wk in P.wardHue) {
        if (!Object.hasOwn(P.wardHue, wk)) continue;
        rs.setProperty(`--lg-ward${wk}`, `hsl(${P.wardHue[wk]},${P.wardSat}%,${P.wardL}%)`);
      }
      rs.setProperty('--lg-scope', `hsl(${P.scopeHue},${P.wardSat}%,${P.wardL}%)`);
      rs.setProperty('--lg-border', P.scopeBorder);
      // Unused by the legend: tests/test_page.mjs composes the ward tints over it.
      rs.setProperty('--lg-land', P.land);
    } catch (e) {}

    // [lat, lng] to canvas px by Web Mercator, precomputed per frame: latLngToLayerPoint
    // allocates a Point per coordinate and was the page's biggest cost.
    const ctr = map.getCenter();
    const halfX = cw / 2, halfY = ch / 2;
    const RAD = Math.PI / 180;
    const xScale = 256 * 2 ** z / 360;   // px per degree of longitude
    const yScale = 256 * 2 ** z / (2 * Math.PI);
    function mercY(lat) {
      return Math.log(Math.tan(Math.PI / 4 + lat * RAD / 2));
    }
    const cX = ctr.lng * xScale, cY = mercY(ctr.lat) * yScale;
    function pt(p) {
      return [(p[1] * xScale - cX) + halfX, (cY - mercY(p[0]) * yScale) + halfY];
    }

    ctx.fillStyle = P.land;
    ctx.fillRect(0, 0, cw, ch);

    if (!this._graph) return;

    if (this._land) {
      this._fillRings(ctx, this._land.green, P.green, pt);
      this._fillRings(ctx, this._land.water, P.water, pt);
      this._strokeLines(ctx, this._land.waterways, P.water,
                        Math.max(0.8, widthFor(4, z) * 0.9), pt);
      if (z >= 13) {
        this._strokeLines(ctx, this._land.rail, P.rail,
                          Math.max(0.5, widthFor(5, z) * 0.7), pt);
      }
    }

    // Casings first, then fills, so junctions look joined.
    const buckets = this._bucket();
    const order = [6, 5, 4, 3, 2, 1];
    for (let i = 0; i < order.length; i++) {
      const cls = order[i], w = widthFor(cls, z);
      if (w <= 0 || z < CLASS[cls].minZ) continue;
      const casingW = w + (CLASS[cls].casing || 0) * 2;
      this._strokeLines(ctx, buckets[cls], P.casing, casingW, pt);
    }
    for (let i = 0; i < order.length; i++) {
      const cls = order[i], w = widthFor(cls, z);
      if (w <= 0 || z < CLASS[cls].minZ) continue;
      this._strokeLines(ctx, buckets[cls],
                        P.road[CLASS[cls].name] || P.road.local, w, pt);
    }

    // Precinct lines go over the roads: they follow streets, and the casings hid them.
    const O = this._opts || {};
    if (this._precincts && (O.wards || O.precincts !== false)) {
      const act = this._activePrecinct;

      // Hue per ward, one for a township (the legend's "Wards, or your township"). Lightness
      // steps by (precinct * 2) % 5 around wardL, so consecutive numbers, usually neighbours,
      // differ by 2+ steps. tests/test_page.mjs checks the contrasts; keep wardLStep small.
      const scope = this._scopeMcd;
      const inScope = (p) => String(p.mcd) === scope;
      if (O.wards && scope) {
        for (let wi = 0; wi < this._precincts.length; wi++) {
          const wp = this._precincts[wi];
          if (!inScope(wp)) continue;
          let hue = wp.ward ? P.wardHue[String(wp.ward)] : P.scopeHue;
          if (hue == null) hue = P.scopeHue;
          const lift = (((Number(wp.precinct) * 2) % 5) - 2) * P.wardLStep;
          this._fillRings(ctx, wp.rings,
            `hsla(${hue},${P.wardSat}%,${P.wardL + lift}%,${P.wardAlpha})`, pt);
        }
      }
      if (act) {
        for (let pi = 0; pi < this._precincts.length; pi++) {
          if (this._pid(this._precincts[pi]) !== act) continue;
          this._fillRings(ctx, this._precincts[pi].rings, P.precinctFill, pt);
        }
      }
      ctx.save();
      ctx.setLineDash([7, 5]);
      ctx.lineCap = 'butt';
      for (let pj = 0; O.precincts !== false && pj < this._precincts.length; pj++) {
        const isAct = act && this._pid(this._precincts[pj]) === act;
        const dim = scope && !inScope(this._precincts[pj]);
        if (!dim) {
          ctx.globalAlpha = 0.9;
          ctx.strokeStyle = P.precinctHalo;
          ctx.lineWidth = (isAct ? 4.5 : 3.4);
          this._strokeRings(ctx, this._precincts[pj].rings, pt);
        }
        ctx.globalAlpha = dim ? 0.3 : isAct ? 1 : 0.92;
        ctx.strokeStyle = P.precinct;
        ctx.lineWidth = dim ? 1 : isAct ? 2.6 : 1.7;
        this._strokeRings(ctx, this._precincts[pj].rings, pt);
      }
      ctx.restore();

      if (this._scopeBorder?.length) {
        ctx.save();
        ctx.setLineDash([]);
        ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.globalAlpha = 0.95;
        ctx.strokeStyle = P.precinctHalo; ctx.lineWidth = 5.5;
        this._strokeRings(ctx, this._scopeBorder, pt);
        ctx.strokeStyle = P.scopeBorder; ctx.lineWidth = 2.8;
        this._strokeRings(ctx, this._scopeBorder, pt);
        ctx.restore();
      }
    }

    // Where precinct numbers sit, for _labels to avoid. Reset every render, outside the guard
    // below, and recorded even while numbers are toggled off, so toggling them does not
    // reflow every street name on the map.
    this._precinctBoxes = [];

    if (lctx && this._precincts && z >= 12) {
      const showNumbers = (this._opts || {}).numbers !== false;
      const actP = this._activePrecinct;
      // This pass runs before _labels, so it checks the camera markers itself.
      const obsN = (this._obstacles || []).map(pt);
      lctx.save();
      lctx.textAlign = 'center';
      lctx.textBaseline = 'middle';
      lctx.lineJoin = 'round';
      for (let pn = 0; pn < this._precincts.length; pn++) {
        const pr = this._precincts[pn];
        if (!pr.label) continue;
        const lp = pt(pr.label);
        if (lp[0] < 12 || lp[0] > cw - 12 || lp[1] < 12 || lp[1] > ch - 12) continue;
        const isA = actP && this._pid(pr) === actP;
        const txt = z >= 14 ? `Precinct ${pr.precinct}` : String(pr.precinct);
        const fs = z >= 15 ? 13 : z >= 13 ? 12 : 11;
        lctx.font = `${isA ? 800 : 700} ${isA ? fs + 1 : fs}px ` +
          '"Hanken Grotesk", system-ui, sans-serif';
        const tw = lctx.measureText(txt).width;
        let nClash = false;
        for (let oq = 0; oq < obsN.length; oq++) {
          const ndx = Math.abs(lp[0] - obsN[oq][0]), ndy = Math.abs(lp[1] - obsN[oq][1]);
          if (ndx < MARKER_R + tw / 2 + 2 && ndy < MARKER_R + fs * 0.8) { nClash = true; break; }
        }
        if (nClash) continue;
        if (showNumbers) {
          lctx.strokeStyle = P.labelHalo || P.land;
          lctx.lineWidth = 4;
          lctx.strokeText(txt, lp[0], lp[1]);
          lctx.fillStyle = isA ? P.precinctActive : P.precinct;
          lctx.fillText(txt, lp[0], lp[1]);
        }
        this._precinctBoxes.push({ x: lp[0], y: lp[1], hw: tw / 2, hh: fs * 0.7 });
      }
      lctx.restore();
    }

    // Canvas px to world px: fixed to the ground at this zoom, so names hold still on a pan.
    const worldOff = origin.add(map.getPixelOrigin());
    if (lctx) this._labels(lctx, P, z, { x: cw, y: ch }, pt, worldOff);
  },

  // Street names: one per street per geographic cell, on that cell's best block.
  _labels(ctx, P, z, size, pt, worldOff) {
    if (z < 10 || !this._graph) return;
    const maxCls = z >= 14 ? 5 : z >= 13 ? 4 : 3;
    const g = this._graph, edgeTotal = g.edgeCount();
    const best = {};
    // Cells are keyed on world px so a pan cannot move a name. 300 placed the most names in
    // a downtown sweep of sizes from 220 px to the whole canvas.
    const wx = worldOff ? worldOff.x : 0, wy = worldOff ? worldOff.y : 0;
    const LCELL = 300;   // world px; see the sweep above
    const route = this._routeStreets || {};
    let routeScreen = null;
    if (this._routePts?.length) {
      routeScreen = [];
      for (let rr = 0; rr < this._routePts.length; rr++) {
        routeScreen.push(pt(this._routePts[rr]));
      }
    }

    for (let i = 0; i < edgeTotal; i++) {
      // Endpoints only, from the packed arrays: building every polyline per pan is too slow.
      const en = g.edgeName(i), ec = g.edgeClass(i) || 5;
      if (!en || ec > maxCls || ALLEY.test(en) || RAMP.test(en)) continue;
      const lastPt = g.edgePointCount(i) - 1;
      if (lastPt < 1) continue;
      const a = pt([g.edgePointLat(i, 0), g.edgePointLng(i, 0)]);
      const b = pt([g.edgePointLat(i, lastPt), g.edgePointLng(i, lastPt)]);
      // Collect a whole cell beyond the canvas: clipped to it, a block sliding into view
      // could take the name from the block that had it.
      if ((a[0] < -LCELL && b[0] < -LCELL) ||
          (a[0] > size.x + LCELL && b[0] > size.x + LCELL) ||
          (a[1] < -LCELL && b[1] < -LCELL) ||
          (a[1] > size.y + LCELL && b[1] > size.y + LCELL)) continue;
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const len = Math.sqrt(dx * dx + dy * dy);
      // Px of road a name needs: least for freeways, which ramps chop into short blocks.
      let minRun;
      if (ec === 1) minRun = 18;
      else if (ec <= 3) minRun = z >= 15 ? 22 : 28;
      else minRun = z >= 17 ? 22 : z >= 16 ? 26 : z >= 15 ? 30 : z >= 14 ? 34 : 40;
      if (len < minRun) continue;
      const mx0 = (a[0] + b[0]) / 2, my0 = (a[1] + b[1]) / 2;
      // A route street prefers the block on the route line, where it is actually driven.
      let rd = 0;
      if (routeScreen && route[en]) {
        let near = Infinity;
        for (let rp = 0; rp < routeScreen.length; rp++) {
          const ddx = routeScreen[rp][0] - mx0, ddy = routeScreen[rp][1] - my0;
          const dd = ddx * ddx + ddy * ddy;
          if (dd < near) near = dd;
        }
        rd = near < 900 ? near : 1e7 + near;   // 30px of the line is "on it"
      }
      const cellX = Math.floor((mx0 + wx) / LCELL);
      const cellY = Math.floor((my0 + wy) / LCELL);
      const cand = { len, a, b, cls: ec, rd, idx: i };
      const key = `${en}\u0000${cellX},${cellY}`;
      const slot = best[key];
      // One winner per cell and deliberately no runner-up: falling back when the winner is
      // off screen or blocked would move the name whenever the view changed.
      if (!slot) best[key] = { name: en, best: cand };
      else if (betterBlock(cand, slot.best)) slot.best = cand;
    }

    const names = Object.keys(best);
    names.sort((x, y) => {
      // Ends on the edge index so the order is total and stable across redraws.
      const X = best[x], Y = best[y];
      const rx = route[X.name] ? 0 : 1, ry = route[Y.name] ? 0 : 1;
      if (rx !== ry) return rx - ry;
      let d = X.best.cls - Y.best.cls;
      if (d !== 0) return d;
      d = Y.best.len - X.best.len;
      if (d !== 0) return d;
      return X.best.idx - Y.best.idx;
    });

    const CELL = z >= 17 ? 34 : z >= 16 ? 40 : z >= 15 ? 46 : z >= 14 ? 54 : 62;
    const taken = {};

    const obstacles = this._obstacles || [];
    const obsPx = [];                    // on-screen obstacle centres, in pixels
    const OB = MARKER_R;
    for (let oi = 0; oi < obstacles.length; oi++) {
      const op = pt(obstacles[oi]);
      if (op[0] < -OB || op[0] > size.x + OB ||
          op[1] < -OB || op[1] > size.y + OB) continue;
      obsPx.push(op);
      const gx1 = Math.round((op[0] + OB + wx) / CELL);
      const gy1 = Math.round((op[1] + OB + wy) / CELL);
      for (let gx = Math.round((op[0] - OB + wx) / CELL); gx <= gx1; gx++) {
        for (let gy = Math.round((op[1] - OB + wy) / CELL); gy <= gy1; gy++) {
          taken[`${gx}:${gy}`] = 1;
        }
      }
    }
    // Reserve the precinct numbers: that pass ran first, so it could not avoid the names.
    const preBoxes = this._precinctBoxes || [];
    for (let pb = 0; pb < preBoxes.length; pb++) {
      const B = preBoxes[pb];
      const bx1 = Math.round((B.x + B.hw + wx) / CELL), by1 = Math.round((B.y + B.hh + wy) / CELL);
      for (let bx = Math.round((B.x - B.hw + wx) / CELL); bx <= bx1; bx++) {
        for (let by = Math.round((B.y - B.hh + wy) / CELL); by <= by1; by++) {
          taken[`${bx}:${by}`] = 1;
        }
      }
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';

    for (let k = 0; k < names.length; k++) {
      // Keys include the cell, so the name comes from the slot.
      const slotK = best[names[k]], streetName = slotK.name;
      const onRoute = !!route[streetName];
      // Runs once: the loop is there so each test below can give up with `continue`.
      const cands = [slotK.best];
      for (let q = 0; q < cands.length; q++) {
        const it = cands[q];
        const mx = (it.a[0] + it.b[0]) / 2, my = (it.a[1] + it.b[1]) / 2;
        if (mx < 16 || mx > size.x - 16 || my < 12 || my > size.y - 12) continue;
        let ang = Math.atan2(it.b[1] - it.a[1], it.b[0] - it.a[0]);
        if (ang > Math.PI / 2) ang -= Math.PI;      // keep text upright
        if (ang < -Math.PI / 2) ang += Math.PI;

        const sh = it.cls <= 2 ? shieldFor(streetName) : null;
        if (sh) {
          if (it.len < 22) continue;
          const shx = Math.round((mx + wx) / CELL), shy = Math.round((my + wy) / CELL);
          // A shield claims its cell and the four neighbours, roughly the badge's footprint.
          if (taken[`${shx}:${shy}`]) continue;
          // Exact marker test too: one cell is far coarser than the marker's radius.
          let shClash = false;
          for (let so = 0; so < obsPx.length; so++) {
            const sdx = mx - obsPx[so][0], sdy = my - obsPx[so][1];
            const sreach = MARKER_R + 15;
            if (sdx * sdx + sdy * sdy < sreach * sreach) { shClash = true; break; }
          }
          if (shClash) continue;
          drawShield(ctx, sh, mx, my, this._dark);
          taken[`${shx}:${shy}`] = 1;
          taken[`${shx + 1}:${shy}`] = 1;
          taken[`${shx - 1}:${shy}`] = 1;
          taken[`${shx}:${shy + 1}`] = 1;
          taken[`${shx}:${shy - 1}`] = 1;
          continue;
        }
        const size_px = it.cls <= 2 ? 13.5 : it.cls === 3 ? 12.5 : 12;
        ctx.font = `600 ${size_px}px "Hanken Grotesk", system-ui, sans-serif`;
        const label = labelText(streetName);
        // Names may overrun their block: demanding a fit rejected nearly every mid-zoom label.
        const tw = ctx.measureText(label).width;
        if (tw > it.len * 2.6 + 40) continue;

        const cells = spanCells(mx, my, ang, tw, size_px, CELL, wx, wy);
        let clash = false;
        for (let ci = 0; ci < cells.length; ci++) {
          if (taken[cells[ci]]) { clash = true; break; }
        }
        if (clash) continue;

        // Exact test against the markers: grid cells (34 to 62 px) are too coarse for them.
        if (obsPx.length) {
          const half = tw / 2, ca = Math.cos(ang), sa = Math.sin(ang);
          const reach = OB + size_px * 0.6;
          const samples = Math.max(2, Math.ceil(tw / 12));
          for (let oi2 = 0; oi2 < obsPx.length && !clash; oi2++) {
            for (let si = 0; si <= samples; si++) {
              const t = -half + (tw * si / samples);
              const lx = mx + ca * t, ly = my + sa * t;
              const odx = lx - obsPx[oi2][0], ody = ly - obsPx[oi2][1];
              if (odx * odx + ody * ody < reach * reach) { clash = true; break; }
            }
          }
          if (clash) continue;
        }

        // Same against the precinct numbers, as boxes, since they are horizontal words.
        if (preBoxes.length) {
          const phalf = tw / 2, pca = Math.cos(ang), psa = Math.sin(ang);
          const psamples = Math.max(2, Math.ceil(tw / 12));
          for (let pi = 0; pi < preBoxes.length && !clash; pi++) {
            const PB = preBoxes[pi];
            const rx = PB.hw + 3, ry = PB.hh + size_px * 0.6;
            for (let pj = 0; pj <= psamples; pj++) {
              const pt2 = -phalf + (tw * pj / psamples);
              const px2 = mx + pca * pt2, py2 = my + psa * pt2;
              if (Math.abs(px2 - PB.x) < rx && Math.abs(py2 - PB.y) < ry) { clash = true; break; }
            }
          }
          if (clash) continue;
        }

        for (let cj = 0; cj < cells.length; cj++) taken[cells[cj]] = 1;
        ctx.save();
        ctx.translate(mx, my);
        ctx.rotate(ang);
        ctx.strokeStyle = P.labelHalo || P.land;
        ctx.lineWidth = 4.5;
        ctx.strokeText(label, 0, 0);
        ctx.fillStyle = onRoute ? (P.labelRoute || P.label) : P.label;
        ctx.fillText(label, 0, 0);
        ctx.restore();
      }
    }
  },

  _strokeRings(ctx, rings, pt) {
    if (!rings) return;
    ctx.beginPath();
    for (let i = 0; i < rings.length; i++) {
      const r = rings[i];
      if (!r || r.length < 3) continue;
      const a = pt(r[0]);
      ctx.moveTo(a[0], a[1]);
      for (let j = 1; j < r.length; j++) {
        const b = pt(r[j]);
        ctx.lineTo(b[0], b[1]);
      }
      ctx.closePath();
    }
    ctx.stroke();
  },

  _fillRings(ctx, rings, color, pt) {
    if (!rings || !rings.length) return;
    ctx.fillStyle = color;
    ctx.beginPath();
    for (let i = 0; i < rings.length; i++) {
      const r = rings[i];
      if (!r || r.length < 3) continue;
      const a = pt(r[0]);
      ctx.moveTo(a[0], a[1]);
      for (let j = 1; j < r.length; j++) {
        const b = pt(r[j]);
        ctx.lineTo(b[0], b[1]);
      }
      ctx.closePath();
    }
    ctx.fill('evenodd');
  },

  _strokeLines(ctx, lines, color, width, pt) {
    if (!lines || !lines.length) return;
    ctx.strokeStyle = color; ctx.lineWidth = width;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!l || l.length < 2) continue;
      const a = pt(l[0]);
      ctx.moveTo(a[0], a[1]);
      for (let j = 1; j < l.length; j++) {
        const b = pt(l[j]);
        ctx.lineTo(b[0], b[1]);
      }
    }
    ctx.stroke();
  }
});

// ---- Camera marker and popup ----
// SVG and HTML strings, no Leaflet: app.js wraps markerSvg() in an L.divIcon.

const FIELD_LABELS = {
  manufacturer: 'Made by', model: 'Model', brand: 'Brand',
  'camera:type': 'Camera type', 'camera:mount': 'Mounted on',
  operator: 'Operated by', 'operator:type': 'Operator type',
  surveillance: 'Watches', 'surveillance:zone': 'Zone',
  electricity: 'Power', height: 'Height', level: 'Level', support: 'Support',
  note: 'Note', description: 'Description', ref: 'Reference',
  'survey:date': 'Surveyed', check_date: 'Last checked', start_date: 'Installed'
};
const FIELD_ORDER = ['manufacturer', 'model', 'brand', 'operator', 'operator:type',
  'camera:type', 'camera:mount', 'support', 'surveillance', 'surveillance:zone',
  'electricity', 'height', 'level', 'start_date', 'survey:date', 'check_date',
  'ref', 'note', 'description'];

// BOX is the drawing's own units, SIZE the rendered px (keep the tap target over 24 px).
// MARKER_R above is half of SIZE plus a margin; change them together.
const BOX = 58, CENTRE = BOX / 2;
const SIZE = 38;

function ago(iso) {
  const then = new Date(`${iso}T00:00:00Z`).getTime();
  if (Number.isNaN(then)) return '';
  const days = Math.floor((Date.now() - then) / 86400000);
  if (days < 0) return '';
  if (days === 0) return ' · today';
  if (days === 1) return ' · yesterday';
  if (days < 31) return ` · ${days} days ago`;
  const months = Math.round(days / 30.44);
  if (months < 24) return ` · ${months} month${months > 1 ? 's' : ''} ago`;
  return ` · ${(days / 365.25).toFixed(1)} years ago`;
}

function compass(deg) {
  const pts = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
             'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return pts[Math.round((deg % 360) / 22.5) % 16];
}

// Degrees from OSM's direction tag, or null. router.js assignCameras() reads it the same
// way to seat the marker; change both, or the cone points down a road it was not seated on.
function bearing(c) {
  const f = c.f || {};
  const raw = f.direction ?? f['camera:direction'];
  return (raw != null && raw !== '' && !Number.isNaN(parseFloat(raw))) ? parseFloat(raw) : null;
}

function popupHtml(c) {
  const f = c.f || {};
  let rows = '';
  const d = bearing(c);
  if (d != null) {
    rows += '<div class="cf"><span class="ck">Faces</span>' +
      `<span class="cv">${compass(d)} · ${Math.round(d)}°</span></div>`;
  }
  FIELD_ORDER.forEach((k) => {
    if (f[k] == null || f[k] === '') return;
    const val = String(f[k]).replace(/;/g, ', ');
    rows += `<div class="cf"><span class="ck">${esc(FIELD_LABELS[k] || k)}</span>` +
      `<span class="cv">${esc(val)}</span></div>`;
  });
  // OSM version 1 is unedited, so only then is the timestamp when it was first mapped.
  const seen = c.t ? String(c.t).slice(0, 10) : null;
  if (seen) {
    const label = c.v === 1 ? 'First mapped' : 'Last edited';
    rows += `<div class="cf"><span class="ck">${label}</span>` +
      `<span class="cv">${seen}<span class="cago">${ago(seen)}</span></span></div>`;
  }
  if (!rows) rows = '<div class="cf"><span class="cv">No details recorded in OpenStreetMap.</span></div>';
  const foot = `<div class="cfoot">OpenStreetMap ${esc(c.id)}` +
    (c.v ? ` · version ${c.v}` : '') + '</div>';
  return `<div class="campop"><div class="ctitle">License plate camera</div>${rows}${foot}</div>`;
}

// The robot officer, shared by the marker and the legend key so the two cannot drift.
// Only the eyes take the state colour (fill). C is the centre, in BOX units.
function bodySvg(fill, C, ringColour) {
  const dark = '#0e1116', cap = '#2a52c8', skin = '#f0c8a2';
  return `<g stroke-linejoin="round" transform="translate(${C},${C}) ` +
      `scale(1.15) translate(-${C},-${C})">` +
    // ear bolts first, so the head overlaps their inner edge
    `<rect x="${C - 10.6}" y="${C - 1}" width="3" height="4.6" rx="1" ` +
      `fill="${ringColour}" stroke="${dark}" stroke-width="1.2"/>` +
    `<rect x="${C + 7.6}" y="${C - 1}" width="3" height="4.6" rx="1" ` +
      `fill="${ringColour}" stroke="${dark}" stroke-width="1.2"/>` +
    // head
    `<rect x="${C - 8.5}" y="${C - 4}" width="17" height="13.5" rx="2.2" ` +
      `fill="${skin}" stroke="${dark}" stroke-width="1.6"/>` +
    // faceplate seam
    `<path d="M${C - 8.5},${C + 3.6} H${C + 8.5}" ` +
      `stroke="${dark}" stroke-width=".9" opacity=".45"/>` +
    // mouth grille
    `<rect x="${C - 4.2}" y="${C + 5.2}" width="2.2" height="1.8" rx=".5" ` +
      `fill="${dark}" opacity=".8"/>` +
    `<rect x="${C - 1.1}" y="${C + 5.2}" width="2.2" height="1.8" rx=".5" ` +
      `fill="${dark}" opacity=".8"/>` +
    `<rect x="${C + 2}" y="${C + 5.2}" width="2.2" height="1.8" rx=".5" ` +
      `fill="${dark}" opacity=".8"/>` +
    // eye glow, then eyes
    `<circle cx="${C - 3.8}" cy="${C + 1.2}" r="4.4" fill="${fill}" opacity=".3"/>` +
    `<circle cx="${C + 3.8}" cy="${C + 1.2}" r="4.4" fill="${fill}" opacity=".3"/>` +
    `<circle cx="${C - 3.8}" cy="${C + 1.2}" r="2.1" fill="${fill}" ` +
      `stroke="${dark}" stroke-width=".8"/>` +
    `<circle cx="${C + 3.8}" cy="${C + 1.2}" r="2.1" fill="${fill}" ` +
      `stroke="${dark}" stroke-width=".8"/>` +
    // cap: crown, then brim
    `<path d="M${C - 8.5},${C - 4.5} Q${C - 8},${C - 11} ${C},${C - 11}` +
      ` Q${C + 8},${C - 11} ${C + 8.5},${C - 4.5} Z" ` +
      `fill="${cap}" stroke="${dark}" stroke-width="1.4"/>` +
    `<rect x="${C - 10}" y="${C - 5.4}" width="20" height="2.6" rx="1.3" ` +
      `fill="${cap}" stroke="${dark}" stroke-width="1.2"/>` +
    // cap badge
    `<circle cx="${C}" cy="${C - 7.8}" r="1.3" fill="#f0ad2d"/>` +
    '</g>';
}

function markerSvg(c, flagged, ringColour) {
  const deg = bearing(c);
  const fill = flagged ? '#ff2d2d' : '#ff4d4d';
  let cone = '';
  if (deg != null) {
    // Cone drawn pointing north from centre, then rotated to the bearing.
    cone = `<g transform="rotate(${deg.toFixed(1)} ${CENTRE} ${CENTRE})">` +
      `<path d="M${CENTRE},${CENTRE} L${CENTRE - 11},${CENTRE - 24}` +
      ` A26,26 0 0,1 ${CENTRE + 11},${CENTRE - 24} Z" ` +
      `fill="${fill}" fill-opacity="${flagged ? '.42' : '.26'}" ` +
      `stroke="${fill}" stroke-opacity="${flagged ? '.85' : '.5'}" stroke-width="1.5"/></g>`;
  }
  const ring = flagged
    ? `<circle cx="${CENTRE}" cy="${CENTRE}" r="15" fill="none" stroke="${fill}"` +
      ' stroke-width="2.5" opacity=".9" class="cam-pulse"/>'
    : '';
  return {
    html: '<span title="RoboCop" style="display:block;width:100%;height:100%">' +
      `<svg width="${SIZE}" height="${SIZE}" viewBox="0 0 ${BOX} ${BOX}">` +
      `${cone}${ring}${bodySvg(fill, CENTRE, ringColour)}</svg></span>`,
    size: SIZE,
    // In px, for the caller's anchor; CENTRE is in BOX units.
    centre: SIZE / 2
  };
}

// The legend key: the robot alone, cropped out of BOX, at its own size rather than SIZE.
function legendSvg(ringColour) {
  return '<svg viewBox="16 15 26 26" width="18" height="18" style="display:block">' +
    `${bodySvg('#ff4d4d', 29, ringColour)}</svg>`;
}

const Cameras = {
  FIELD_LABELS, FIELD_ORDER,
  ago, compass, bearing,
  popupHtml, bodySvg, markerSvg,
  legendSvg
};

const basemapLayer = (opts) => new BasemapLayer(opts);

export { basemapLayer, Cameras };
