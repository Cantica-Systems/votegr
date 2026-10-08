// The map page: where you vote anywhere in Kent County, and a route there around known
// plate cameras. The destination is derived from the address, never asked for.

import { displayCase, esc, Elections, Precincts } from './voting.js';
import { basemapLayer, Cameras } from './map.js';
import { Graph, haversine, bearing } from './router.js';

let map, graph, P, cameras;
let pollLayer, siteLayer, camLayer, routeLayer, pinLayer;
let current = null;
let activeEl = null, destChoice = null, electionDayHours = null;
// Kept so the countdown can re-ask the calendar when the day rolls over.
let electionList = null;
let ownBase = null;
let neighbors = null, precincts = null;
let pinArmed = false;
let ac = null;      // the suggestion list (attachSuggestions, below)
let clerk = null;   // gr-clerk.json: early voting sites and drop boxes
let sources = {};   // sources.json: every upstream this site reads, by id
// Which place in each kind's list the reader picked; reset on every new lookup.
let chosen = { dropbox: 0, early: 0 };
let routes = null, selected = 'avoid';
let originArrow = null;   // the blue you-are-here arrow; steps advance it
const GR = [42.9634, -85.6681];
const GR_MCD = '34000';             // the state's MCD code for the City of Grand Rapids
const METERS_PER_MILE = 1609.344;   // the international mile, exactly

// No tile layer: tiles would be third-party requests on every pan, and nothing the user
// looks up may leave the browser. The basemap is drawn from local files (map.js).
// One line on purpose: a two-line attribution eats the bottom of a card-sized map.
const ATTR = 'Roads: Kent County (REGIS) · ' +
           '\u00a9 OpenStreetMap contributors (ODbL)';

function $(id) { return document.getElementById(id); }
function getVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#000';
}

function setHint(text) { $('hint').textContent = text || ''; }

// ---- Color scheme ----
// data-theme on <html> (absent: follow the system) is mirrored to localStorage, which the
// inline script in index.html reads before first paint.

// Dark by default on purpose; choosing 'system' is stored as a choice of its own.
function themeChoice() {
  try {
    const t = localStorage.getItem('theme');
    return (t === 'light' || t === 'dark' || t === 'system') ? t : 'dark';
  } catch (e) { return 'dark'; }
}

function prefersDark() {
  const c = themeChoice();
  if (c === 'dark') return true;
  if (c === 'light') return false;
  return !!window.matchMedia?.('(prefers-color-scheme: dark)').matches;
}

function applyTheme(choice) {
  const root = document.documentElement;
  if (choice === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);
  try {
    localStorage.setItem('theme', choice);
  } catch (e) { /* private mode: the page still works, it just forgets */ }

  const sw = $('themeSwitch');
  if (sw) {
    sw.querySelectorAll('button').forEach((b) => {
      const on = b.dataset.themeChoice === choice;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }
  onSchemeChanged();
}

// Map colors are read from CSS at draw time, so a scheme change redraws them.
function onSchemeChanged() {
  if (!map) return;
  ownBase.setDark(prefersDark());
  if (routes) renderAll(false);
  else if (cameras) drawCameras();
  // The legend key reads --pin-ring too; without this it kept the first theme's ink.
  paintLegendCamera();
}

// ---- Modals ----

function openModal(wrap) {
  wrap.hidden = false;
  wrap.querySelector('.modal-x')?.focus();
}

function initAbout() {
  const wrap = $('aboutModal');
  if (!wrap) return;
  function open() { openModal(wrap); }
  function close() { wrap.hidden = true; }

  const btnF = $('aboutBtnFoot');
  if (btnF) btnF.onclick = open;
  const howL = $('howLink');
  if (howL) howL.onclick = (e) => { e.preventDefault(); open(); };
  wrap.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) close();
  });
  // Bound once here: binding it in wirePlaceLists added a listener per lookup.
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    document.querySelectorAll('.modal-wrap').forEach((w) => { w.hidden = true; });
  });
}

// ---- Map layers ----

const LAYER_KEYS = { lyrPrecincts: 'precincts', lyrNumbers: 'numbers',
                   lyrWards: 'wards', lyrPolling: 'polling',
                   lyrCameras: 'cameras' };

function layerState() {
  const o = {};
  Object.keys(LAYER_KEYS).forEach((id) => {
    const el = $(id);
    o[LAYER_KEYS[id]] = el ? el.checked : true;
  });
  return o;
}

function applyLayers() {
  const o = layerState();
  ownBase.setLayerOpts(o);
  [pollLayer, siteLayer].forEach((layer) => {
    if (!layer) return;
    if (o.polling) { if (!map.hasLayer(layer)) layer.addTo(map); }
    else map.removeLayer(layer);
  });
  if (camLayer) {
    if (o.cameras && camerasInScope()) { if (!map.hasLayer(camLayer)) camLayer.addTo(map); }
    else map.removeLayer(camLayer);
    syncLabelObstacles();
  }
  try { localStorage.setItem('layers', JSON.stringify(o)); } catch (e) { /* private mode */ }
}

function initLayers() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem('layers') || 'null'); } catch (e) { saved = null; }
  Object.keys(LAYER_KEYS).forEach((id) => {
    const el = $(id);
    if (!el) return;
    if (saved && typeof saved[LAYER_KEYS[id]] === 'boolean') el.checked = saved[LAYER_KEYS[id]];
    el.addEventListener('change', applyLayers);
  });
  applyLayers();
}

function initTheme() {
  const sw = $('themeSwitch');
  if (sw) {
    sw.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-theme-choice]');
      if (b) applyTheme(b.dataset.themeChoice);
    });
  }
  applyTheme(themeChoice());
}

// ---- Result map ----

// 700px, matches the phone breakpoint in style.css.
function isPhone() { return window.matchMedia('(max-width: 700px)').matches; }

// On touch, details open in the card under the map, since a 260px popup does not fit a
// 320px map. detailKind lets a tap off a marker's detail close it, not show a precinct.
let detailKind = null;

function showDetail(html, kind) {
  const d = $('mapDetail');
  detailKind = kind || 'precinct';
  $('mapDetailBody').innerHTML = html;
  d.hidden = false;
  const r = d.getBoundingClientRect();
  if (r.bottom > window.innerHeight) d.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function hideDetail() {
  const d = $('mapDetail');
  if (d) { d.hidden = true; $('mapDetailBody').innerHTML = ''; }
  detailKind = null;
}

// Leaflet sizes itself once, so a map revealed after layout must re-measure. Fit bounds
// after this, not before.
function revealMap() {
  const b = $('mapBlock'), rb = $('routeBlock');
  if (!b) return;
  // The map sits inside #routeBlock; map-only hides that section's chrome for pin picking.
  if (rb?.hidden) { rb.hidden = false; rb.classList.add('map-only'); }
  const wasHidden = b.hidden;
  b.hidden = false;
  // Re-measure on any reveal path: either hidden flag may have left it 0x0.
  if (map && (wasHidden || map.getSize().x === 0)) map.invalidateSize(false);
  updateMapScope();
}

function updateMapScope() {
  const el = $('mapScope');
  if (!el) return;
  if (!map || !precincts || $('mapBlock').hidden) { el.textContent = ''; return; }
  const c = map.getCenter();
  el.textContent = scopeText(c.lat, c.lng);
}

function scopeText(lat, lng) {
  const pr = precinctAt(lat, lng);
  return pr ? placeLine(pr) : 'Outside Kent County';
}

// "3-58" where the jurisdiction has wards, else the bare number; never the 13-digit code.
// `context` is the ward already on screen, which is then left out.
function precinctNumber(id, context) {
  const d = P?.describe ? P.describe(id) : null;
  if (!d || d.precinct == null || String(d.precinct) === String(id)) return String(id);
  const ward = d.ward == null || d.ward === '' || String(d.ward) === String(context)
    ? '' : `${d.ward}-`;
  return ward + d.precinct;
}

// Plain text, not HTML: callers set it as textContent or escape it.
function placeLine(pr) {
  return (pr.jurisdiction ? `${pr.jurisdiction} \u00b7 ` : '') +
    (pr.ward != null && pr.ward !== '' ? `Ward ${pr.ward} \u00b7 ` : '') +
    `Precinct ${pr.precinct}`;
}

function listTitle(kind) {
  const where = current?.jurisdiction || 'your area';
  if (kind === 'dropbox' && officeOnly(boxesFor(current))) {
    return `Returning an absentee ballot in ${where}`;
  }
  const what = kind === 'dropbox' ? 'Ballot drop boxes' : 'Early voting sites';
  return `${what} in ${where}`;
}

// The list lives in a modal outside the row: nested inside it, a pick bubbled to the
// cell's handler and re-routed to the nearest place.
function wirePlaceLists(r) {
  const wrap = $('placeModal'), body = $('placeModalBody'), title = $('placeTitle');
  if (!wrap || !body) return;
  const opts = destinations(r);

  function close() { wrap.hidden = true; }

  ['dropbox', 'early'].forEach((kind) => {
    const btn = $(kind === 'dropbox' ? 'boxListBtn' : 'evListBtn');
    const opt = opts.find((o) => o.kind === kind);
    if (!btn || !opt) return;
    btn.onclick = () => {
      title.textContent = listTitle(kind);
      body.innerHTML = placeListHtml(kind, opt);
      openModal(wrap);
    };
  });

  wrap.onclick = (e) => {
    if (e.target.closest('[data-close]')) { close(); return; }
    const li = e.target.closest('li[data-pick]');
    if (!li || !current) return;
    chosen[li.dataset.kind] = Number(li.dataset.pick);
    close();
    // The landing goes to show() rather than a second scroll after it: two scrolls stutter.
    show(current, li.dataset.kind, isPhone() ? 'routeBlock' : null);
  };
  body.onkeydown = (e) => {
    const li = e.target.closest?.('li[data-pick]');
    if (li && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); li.click(); }
  };
}

// Nearest first (destinations() ranks them), the one routed to marked.
function placeListHtml(kind, opt) {
  const opens = evOpensOn(opt, current);
  let html = opens
    ? `<p class="bx-lead">Not open yet: these sites take ballots from ${esc(opens)}.</p>`
    : '';
  html += '<ul class="box-list">';
  opt.all.forEach((b, i) => {
    const picked = i === chosen[kind] ? ' class="is-chosen"' : '';
    const dist = b.metres != null ? `<span class="bx-dist">${fmtMi(b.metres)}</span>` : '';
    const loc = b.entrance_note || b.note
      ? '<span class="bx-where"><span class="pp-loc-l">Location:</span> ' +
        `${esc(sentenceCase(b.entrance_note || b.note))}</span>`
      : '';
    html += `<li data-pick="${i}" data-kind="${kind}"` +
      ` role="button" tabindex="0" title="Get directions here"${picked}>` +
      `<span class="bx-name">${esc(boxLabel(b))}${dist}</span>` +
      `<span class="bx-addr">${esc(addressForDisplay(b.address))}</span>` +
      loc +
      boxHoursHtml(b, 'span', { open: 'bx-hours', phone: 'bx-addr' }) +
      '</li>';
  });
  // Boxes without a street address are listed but not routable.
  if (kind === 'dropbox' && inGrandRapids(current)) {
    (clerk?.unrouted || []).forEach((b) => {
      html += `<li class="bx-noroute"><span class="bx-name">${esc(boxLabel(b))}</span>` +
        `<span class="bx-where">${esc(sentenceCase(b.note || ''))}</span>` +
        '<span class="bx-addr">Inside the building, so there is no address ' +
        'to route to.</span></li>';
    });
  }
  return `${html}</ul>${provenanceHtml(opt)}`;
}

// Credits each row's own `src` through sources.json. A row without one credits nobody:
// naming a source that did not produce it sends the reader to the wrong office.
// County drop boxes carry no src yet (that belongs with refresh_polling.py).
function provenanceHtml(opt) {
  const ids = [], seen = {};
  (opt?.all || []).forEach((r) => {
    const id = r?.src;
    if (id && sources[id] && !seen[id]) { seen[id] = 1; ids.push(id); }
  });
  if (!ids.length) return '';

  const credits = ids.map((id) => {
    const s = sources[id];
    const bits = [`Source: <a href="${esc(s.url)}" target="_blank" ` +
      `rel="noopener">${esc(s.publisher)}</a>`];
    if (s.retrieved) bits.push(`read ${esc(Elections.monthDay(s.retrieved))}`);
    if (s.archived) {
      bits.push(`<a href="${esc(s.archived)}" target="_blank" ` +
        'rel="noopener">archived copy</a>');
    }
    return bits.join(' \u00b7 ') +
      (s.archive_note ? `<br>${esc(s.archive_note)}` : '');
  });
  return `<p class="bx-prov">${credits.join('<br>')}</p>`;
}

// On a phone, head is the shut card's summary and fold is what opening it reveals.
// state.now: the way of voting in person that is happening today (nowKind), badged.
// state.off: a way of voting not open yet or over, shown disabled.
function whenCell(kind, state, extra) {
  const note = state.note ? `<div class="pp-note">${esc(state.note)}</div>` : '';
  let shown = extra || '';
  const phone = isPhone();
  // Early voting's many hour lines fold away; election day's one line stays with the date.
  const fold = phone ? note + (kind === 'early' ? shown : '') : '';
  if (phone && kind === 'early') shown = '';
  const lbl = `<div class="vi-lbl${state.live ? ' live' : ''}">${esc(state.label)}</div>`;
  const head = `<div class="vi-when vi-when-${kind}${state.now ? ' is-now' : ''}` +
    `${state.off ? ' is-off' : ''}">` +
    (state.now
      ? `<div class="vi-lbl-row">${lbl}<span class="vi-now">${esc(state.now)}</span></div>`
      : lbl) +
    `<div class="vi-val">${esc(state.status)}</div>` +
    `${shown}${phone ? '' : note}</div>`;
  return { head, fold, now: !!state.now, off: !!state.off };
}

// 'none', 'upcoming', 'open' or 'closed'. Both ends are statute, not per box: ballots go
// out on Elections.absenteeFrom and must be back by poll close, so an open box accepts
// nothing before then.
function absenteePhase() {
  if (!activeEl) return 'none';
  const today = Elections.todayISO();
  if (today < Elections.absenteeFrom(activeEl)) return 'upcoming';
  if (today > activeEl.date) return 'closed';
  return 'open';
}

function absenteeState() {
  const phase = absenteePhase();
  if (phase === 'none') return { label: 'Ballot drop box', status: 'No election scheduled' };
  const from = Elections.absenteeFrom(activeEl);
  const range = `${Elections.dayMonth(from)} to ${Elections.dayMonth(activeEl.date)}`;
  if (phase === 'upcoming') {
    return { label: 'Absentee voting upcoming', status: range, live: true,
             note: `Absentee ballots are mailed from ${Elections.monthDay(from)}. ` +
                   'They can be returned from then until the polls close on election day.' +
                   boxAccess() };
  }
  if (phase === 'closed') {
    return { label: 'Absentee voting closed', status: range };
  }
  return { label: 'Absentee voting open', status: range, live: true,
           note: 'A returned ballot has to be in the clerk\'s hands by the ' +
                 `time the polls close on election day.${boxAccess()}` };
}

function isElectionDay() {
  return !!activeEl && Elections.todayISO() === activeEl.date;
}

// The way of voting in person that is happening today, and so the one highlighted: the
// polls on election day and on no other day, early voting while its window is open.
// Null otherwise. Separate from the routed default, which the drop box holds while
// absentee voting is open (destinations()).
function nowKind(r) {
  if (isElectionDay()) return 'polling';
  return Elections.windowState(evWindow(r)) === 'open' ? 'early' : null;
}

// Only the first letter: the rest may hold names the clerk cased on purpose.
function sentenceCase(s) {
  s = String(s || '').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

function placeLabel(kind, dflt) {
  return chosen[kind] ? 'Custom location selected' : dflt;
}

function customClass(kind) { return chosen[kind] ? ' is-custom' : ''; }

function locLine(text) {
  return text
    ? '<div class="pp-loc"><span class="pp-loc-l">Location:</span> ' +
      `${esc(sentenceCase(text))}</div>`
    : '';
}

function actionRow(kind, extra) {
  return `<div class="vi-actions">${extra || ''}` +
    `<button type="button" class="box-open dir-btn" data-dir="${kind}">` +
    'Directions</button></div>';
}

// Wide: two grid cells, place then dates. Phone: one card with the dates as its summary,
// shut until that way of voting opens.
function section(kind, where, when, opts) {
  const head = when?.head || '', fold = when?.fold || '';
  if (!isPhone()) return where + head;
  if (!head) return `<div class="vi-card vi-card-${kind}">${where}</div>`;
  return `<div class="vi-card vi-card-${kind}${when.now ? ' is-now' : ''}` +
    `${when.off ? ' is-off' : ''}">` +
    `<details class="vi-fold"${opts?.collapsed ? '' : ' open'}>` +
    `<summary>${head}</summary>` +
    `<div class="vi-fold-body">${fold}${where}</div>` +
    '</details></div>';
}

function metaBlock(lines) {
  const body = lines.filter(Boolean).join('');
  return body ? `<div class="pp-meta">${body}</div>` : '';
}

// Appended to the absentee note, so it returns a leading space or ''.
function boxAccess() {
  const list = boxesFor(current);
  if (officeOnly(list)) {
    const where = esc(current?.jurisdiction || 'this jurisdiction');
    return ` No ballot drop box is published for ${where}` +
      '. An absentee ballot has to be returned to your own clerk, so the ' +
      'clerk\u2019s office is where it goes, during office hours.';
  }
  return '';
}

const ALWAYS_OPEN = /^24\/7$/;

function boxLabel(box) {
  // Office names are composed already cased; displayCase would turn "Clerk's" into "Clerk'S".
  if (box.office) return box.name;
  return displayCase(box.name || box.address || 'Drop box');
}

// The ZIP is dropped for display only; the data keeps it for geocoding.
function addressForDisplay(a) {
  return displayCase(String(a || '').replace(/,\s*\d{5}(-\d{4})?\s*$/, ''));
}

function placePopup(title, name, p, extra) {
  return '<div class="destpop">' +
    `<div class="dt">${esc(title)}</div>` +
    `<div class="dn">${esc(name)}</div>` +
    `<div class="da">${esc(addressForDisplay(p.address))}</div>` +
    (p.entrance_note ? `<div class="de">${esc(p.entrance_note)}</div>` : '') +
    `${extra || ''}</div>`;
}

function precinctInfoHtml(pr) {
  const place = P?.pollingPlace(P.idOf(pr));
  return place
    ? placePopup(placeLine(pr), displayCase(place.name), place)
    : `<div class="destpop"><div class="dt">${esc(placeLine(pr))}</div>` +
      '<div class="da">No polling place on file.</div></div>';
}

// Hover devices get a Leaflet popup, touch gets the card under the map. Every marker goes
// through bindDetail so a device never mixes the two; html may be a string or a function.
function hoverPopups() {
  return !!window.matchMedia?.('(hover: hover)').matches;
}

function bindDetail(m, html, maxWidth) {
  if (hoverPopups()) {
    m.bindPopup(html, { maxWidth, className: 'cam-popup' });
  } else {
    m.on('click', () => {
      showDetail(typeof html === 'function' ? html() : html, 'marker');
    });
  }
}

let hoverThrottle = 0;
function initMapHover() {
  if (!hoverPopups()) return;
  map.on('mousemove', (e) => {
    const now = Date.now();
    if (now - hoverThrottle < 40) return;
    hoverThrottle = now;
    const el = $('mapScope');
    if (el) el.textContent = scopeText(e.latlng.lat, e.latlng.lng);
  });
  map.on('mouseout', updateMapScope);
}

function hideMap() {
  const b = $('mapBlock');
  if (b) b.hidden = true;
}

let spyPending = false;

function markSection(btn) {
  document.querySelectorAll('#sectionNav button').forEach((b) => {
    const on = b === btn;
    b.classList.toggle('is-current', on);
    b.setAttribute('aria-current', on ? 'true' : 'false');
  });
}

function syncSectionNav() {
  const nav = $('sectionNav');
  if (!nav || nav.hidden) return;
  const bar = $('searchBar');
  const line = (bar ? bar.getBoundingClientRect().bottom : 0) + 12;
  let lit = null;
  const live = [];
  nav.querySelectorAll('button').forEach((b) => {
    const el = $(b.dataset.goto);
    if (!el || el.hidden) return;
    live.push(b);
    if (el.getBoundingClientRect().top <= line) lit = b;
  });
  // The last section rarely reaches the bar, so the bottom of the page lights it.
  const doc = document.documentElement;
  if (live.length && window.innerHeight + window.scrollY >= doc.scrollHeight - 4) {
    lit = live[live.length - 1];
  }
  markSection(lit);
}

// Wait a frame: routeTo has just filled the section, so its position is not settled.
function scrollToDirections() {
  requestAnimationFrame(() => { scrollToResult('routeBlock'); });
}

// Offset by the sticky search bar, or the block's heading lands under it.
function scrollToResult(id) {
  const el = $(id), bar = $('searchBar');
  if (!el || el.hidden) return;
  const offset = (bar ? bar.getBoundingClientRect().height : 0) + 8;
  const y = window.scrollY + el.getBoundingClientRect().top - offset;
  window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
}

function init() {
  initMap();
  initInput();
  initTheme();
  initLayers();
  initMapHover();
  initAbout();
  $('resetBtn').onclick = reset;
  loadData();
}

function initMap() {
  map = L.map('map', { zoomControl: true, attributionControl: true }).setView(GR, 13);
  // Added before the data arrives so the map shows its ground color, not a blank flash.
  ownBase = basemapLayer({ graph: null, landcover: null, dark: prefersDark() });
  ownBase.addTo(map);
  // Drops the flag from Leaflet 1.9's default prefix: no politics on a voting page, and it
  // keeps the attribution to one line on a phone.
  map.attributionControl.setPrefix(
    '<a href="https://leafletjs.com" title="A JavaScript library for interactive maps">Leaflet</a>');
  map.attributionControl.addAttribution(ATTR);
  if (window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onScheme = () => {
      if (themeChoice() === 'system') onSchemeChanged();
    };
    if (mq.addEventListener) mq.addEventListener('change', onScheme);
    else if (mq.addListener) mq.addListener(onScheme);
  }
  pollLayer = L.layerGroup().addTo(map);
  siteLayer = L.layerGroup().addTo(map);
  camLayer = L.layerGroup().addTo(map);
  routeLayer = L.layerGroup().addTo(map);
  pinLayer = L.layerGroup().addTo(map);
  addGearControl();
  addStatusControl();

  map.on('moveend', updateMapScope);

  // Pin drop is one-shot and armed by #pinBtn, so a stray click never starts a route.
  map.on('click', (e) => {
    if (pinArmed) {
      hideDetail();
      disarmPin();
      pinLookup(e.latlng.lat, e.latlng.lng);
      return;
    }
    // Marker clicks do not reach the map, so this is an idle tap: show the precinct under it.
    if (detailKind === 'marker') { hideDetail(); return; }
    const pr = precinctAt(e.latlng.lat, e.latlng.lng);
    if (pr) showDetail(precinctInfoHtml(pr));
    else hideDetail();
  });
  $('detailX').onclick = hideDetail;
  document.querySelectorAll('#sectionNav button').forEach((b) => {
    b.onclick = () => {
      markSection(b);
      scrollToResult(b.dataset.goto);
    };
  });
  window.addEventListener('scroll', () => {
    if (spyPending) return;
    spyPending = true;
    requestAnimationFrame(() => { spyPending = false; syncSectionNav(); });
  }, { passive: true });
  $('pinBtn').onclick = () => { pinArmed ? disarmPin() : armPin(); };
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    // One surface per press: an armed pin backs out first and the detail survives.
    if (pinArmed) disarmPin();
    else hideDetail();
  });
}

// Each input is a sibling of its label: wrapped inside it, a click toggled it twice.
function addGearControl() {
  const gear = L.control({ position: 'topright' });
  gear.onAdd = () => {
    const d = L.DomUtil.create('div', 'map-gear leaflet-bar');
    d.innerHTML =
      '<button type="button" class="gear-btn" title="Map layers" aria-expanded="false">' +
      '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<circle cx="12" cy="12" r="3"/>' +
      '<path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.09a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.09a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z"/></svg></button>' +
      '<div class="gear-panel" hidden>' +
      '<div class="layer-toggles">' +
      '<div class="lyr"><input type="checkbox" id="lyrPrecincts" checked><label for="lyrPrecincts">Precinct boundaries</label></div>' +
      '<div class="lyr"><input type="checkbox" id="lyrNumbers" checked><label for="lyrNumbers">Precinct numbers</label></div>' +
      // The ward fill only; the border (_scopeBorder in map.js) follows lyrPrecincts.
      '<div class="lyr"><input type="checkbox" id="lyrWards" checked><label for="lyrWards">Ward and precinct colors</label></div>' +
      '<div class="lyr"><input type="checkbox" id="lyrPolling" checked><label for="lyrPolling">Voting locations</label></div>' +
      '<div class="lyr"><input type="checkbox" id="lyrCameras" checked><label for="lyrCameras">License plate cameras</label></div>' +
      '</div>' +
      '<div class="gear-sec">Camera data</div>' +
      '<div class="cam-count" id="camCountFold"></div>' +
      '</div>';
    L.DomEvent.disableClickPropagation(d);
    const btn = d.querySelector('.gear-btn'), panel = d.querySelector('.gear-panel');
    btn.onclick = () => {
      panel.hidden = !panel.hidden;
      btn.setAttribute('aria-expanded', String(!panel.hidden));
    };
    // Capture phase, so a click whose target is re-rendered away is still seen.
    document.addEventListener('click', (e) => {
      if (!panel.hidden && !d.contains(e.target)) {
        panel.hidden = true; btn.setAttribute('aria-expanded', 'false');
      }
    }, true);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !panel.hidden) {
        panel.hidden = true; btn.setAttribute('aria-expanded', 'false');
      }
    });
    return d;
  };
  gear.addTo(map);
}

function addStatusControl() {
  const status = L.control({ position: 'bottomleft' });
  status.onAdd = () => {
    const d = L.DomUtil.create('div', 'map-status');
    d.id = 'mapScope';
    return d;
  };
  status.addTo(map);
}

function initInput() {
  ac = attachSuggestions({
    input: $('addr'),
    suggest: suggestWithNeighbors,
    onChoose: choose,
    onMiss(text) { showError(missExplanation(text)); }
  });
}

function loadJson(name, optional) {
  const p = fetch(`data/${name}.json`).then((r) => r.json());
  return optional ? p.catch(() => null) : p;
}

// Chunks are fetched a few ahead but parsed one at a time and dropped: all thirty parsed
// at once peaked at 102 MiB against a 13 MiB steady state, too much for older phones.
const CHUNK_LOOKAHEAD = 4;

function loadCountyGraph(onProgress) {
  return loadJson('graph/index').then((index) => {
    const g = Graph.streaming(index);
    const chunks = index.chunks, inFlight = [];

    function fetchAt(i) {
      return i < chunks.length ? loadJson(`graph/${chunks[i].mcd}`) : null;
    }
    for (let k = 0; k < CHUNK_LOOKAHEAD && k < chunks.length; k++) {
      inFlight.push(fetchAt(k));
    }

    let at = 0;
    function next() {
      if (at >= chunks.length) return g.finish();
      const pending = inFlight[at];
      const ahead = at + CHUNK_LOOKAHEAD;
      if (ahead < chunks.length) inFlight[ahead] = fetchAt(ahead);
      at++;
      return pending.then((doc) => {
        g.addChunk(doc);
        doc = null;
        inFlight[at - 1] = null;      // release the settled promise's value
        if (onProgress) onProgress(at, chunks.length);
        return next();
      });
    }
    return next();
  });
}

// polling.json is the city's hand-transcribed source of record (entrance notes, consolidation).
function loadCountyIndex() {
  return loadJson('precincts').then((index) => {
    const mcds = (index.jurisdictions || []).map((j) => j.mcd);
    return Promise.all([
      Promise.all(mcds.map((m) => loadJson(`addresses/${m}`))),
      Promise.all(mcds.map((m) => loadJson(`polling/${m}`, true))),
      loadJson('polling', true)
    ]).then(([addresses, polling, cityPolling]) => ({
      index,
      P: Precincts.county({
        index,
        addresses,
        polling: polling.filter(Boolean),
        cityPolling,
        cityMcd: GR_MCD
      })
    }));
  });
}

const IDLE_PLACEHOLDER = '300 Monroe Ave NW';

// ?debug loads debug.js, which reaches the engine only through the object given to mount().
const DEBUG = /[?&]debug\b/.test(location.search);

function mountDebug() {
  import('./debug.js').then((debug) => {
    debug.mount({
      graph, cameras,
      resolve: resolveEnd, computeRoutes, draw: drawDebugRoutes,
      suggest: suggestWithNeighbors,
      attachSuggestions, metersPerMile: METERS_PER_MILE
    });
  });
}

// Takes an address or "lat,lng" and returns everything the debug panel shows about it.
function resolveEnd(text) {
  const out = { input: text };
  const ll = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(text || '');
  const t0 = performance.now();
  if (ll) {
    out.lat = Number(ll[1]); out.lng = Number(ll[2]); out.how = 'coordinates';
  } else {
    const parsed = P.parseTyped(text);
    out.parsed = parsed;
    let hit = graph.geocode(parsed.number, parsed.rest);
    if (!hit) {
      const lk = P.lookup(text);
      out.lookup = lk.error ? { error: lk.error } : { street: lk.street };
      if (!lk.error) hit = graph.geocode(lk.number, lk.street);
    }
    if (!hit) { out.error = 'could not geocode'; return out; }
    out.lat = hit.lat; out.lng = hit.lng;
    out.geocode = { street: hit.street, exact: hit.exact, edge: hit.edge };
    out.how = hit.exact ? 'centreline, exact range' : 'centreline, interpolated';
  }
  const pr = precinctAt(out.lat, out.lng);
  out.precinct = pr ? { code: pr.code, jurisdiction: pr.jurisdiction, ward: pr.ward,
                        precinct: pr.precinct } : null;
  const snap = graph.snapToRoad(out.lat, out.lng);
  out.snap = { node: snap.node, edge: snap.edge, metres: Math.round(snap.meters),
               street: snap.edge != null ? graph.edgeName(snap.edge) : null };
  out.ms = Math.round(performance.now() - t0);
  return out;
}

function drawDebugRoutes(origin, place, computed) {
  $('col').classList.add('has-result');
  document.body.classList.add('has-result');
  revealMap();
  routes = Object.assign(computed, {
    opts: [], origin, place, destSub: 'Debug destination'
  });
  selected = 'avoid';
  renderAll(true);
}

function loadData() {
  const input = $('addr');
  input.disabled = true;
  input.placeholder = 'Loading Kent County\u2026';
  setHint('Loading the county\u2019s roads and addresses. This happens once.');

  // The calendar loads on its own so the countdown does not wait for the roads.
  const calendarP = loadJson('elections', true).then((calendar) => {
    // Election day hours are statewide statute, so the file gives them once.
    electionDayHours = calendar?.election_day_hours || null;
    electionList = calendar?.elections || [];
    activeEl = Elections.next(electionList);
    startCountdown();
    return calendar;
  });

  Promise.all([
    loadCountyGraph((done, total) => {
      setHint(`Loading the county\u2019s roads, ${done} of ${total}` +
              ' jurisdictions. This happens once.');
    }),
    loadJson('cameras'), loadCountyIndex(),
    calendarP, loadJson('landcover', true),
    loadJson('neighbors', true),
    loadJson('gr-clerk', true), loadJson('sources', true)
  ]).then((res) => {
    const cameraData = res[1], county = res[2], landcover = res[4];
    const neighborData = res[5], clerkData = res[6];
    const sourceData = res[7];

    graph = res[0];
    P = county.P;
    const precinctData = county.index;
    drawPollingPlaces();
    // Only streets the list lacks: neighbors.json repeats many under the state's spelling.
    neighbors = neighborData?.streets ? P.unindexed(neighborData.streets) : null;
    precincts = precinctData?.precincts || null;
    if (precincts) ownBase.setPrecincts(precincts);
    if (precinctData) ownBase.setJurisdictions(precinctData.jurisdictions);
    ownBase.setData(graph, landcover || null);
    // Every camera, unfiltered by jurisdiction: a route can use any road in the county.
    cameras = cameraData.cameras;
    sources = sourceData?.sources || {};
    clerk = placeCoords(clerkData);
    // Restarted so the clock repaints before warm() holds the main thread again.
    startCountdown();
    graph.assignCameras(cameras);
    // Builds the lazy street index and snap grid now rather than on the first lookup.
    graph.warm();
    drawCameras();
    input.disabled = false;
    paintLegendSites();
    if (DEBUG) mountDebug();
    input.placeholder = IDLE_PLACEHOLDER;
    setHint('');
    // Desktop only: on a phone, autofocus pops the keyboard over the map.
    if (!isPhone()) input.focus();
  }).catch(() => {
    showError('Could not load the map data files. If you are hosting this ' +
      'yourself, check that the data folder sits next to this page.');
  });
}

// Told apart by shape, not only colour. Drawn at 22 units and scaled for map and legend.
const SITE_ART = {
  polling:
    '<svg viewBox="0 0 22 22" aria-hidden="true">' +
    '<circle cx="11" cy="11" r="8.4" class="sm-face"/>' +
    '<path d="M7 11.3l2.7 2.7L15.2 8.5" class="sm-ink" fill="none"/></svg>',
  dropbox:
    '<svg viewBox="0 0 22 22" aria-hidden="true">' +
    '<rect x="3.2" y="6.6" width="15.6" height="12.2" rx="2.4" class="sm-face"/>' +
    '<path d="M7.2 10.6h7.6" class="sm-ink" fill="none"/>' +
    '<path d="M11 2.6v5.2M8.6 5.6L11 8.1l2.4-2.5" class="sm-ink" fill="none"/></svg>',
  early:
    '<svg viewBox="0 0 22 22" aria-hidden="true">' +
    '<circle cx="11" cy="11" r="8.4" class="sm-face"/>' +
    '<path d="M11 6.2v5.1l3.3 2" class="sm-ink" fill="none"/></svg>'
};

function siteIcon(kind, active) {
  const S = active ? 26 : 19;
  return L.divIcon({
    className: `site-mark site-${kind}${active ? ' active' : ''}`,
    html: SITE_ART[kind] || SITE_ART.polling,
    iconSize: [S, S], iconAnchor: [S / 2, S / 2]
  });
}

function paintLegendSites() {
  document.querySelectorAll('.sitek').forEach((el) => {
    const kind = el.dataset.kind;
    el.className = `sitek site-mark site-${kind}`;
    el.innerHTML = SITE_ART[kind] || '';
  });
}

// "Ward 3 · Precincts 45, 51", one line per ward: on its own, "3-45" reads as a range.
function precinctLines(ids) {
  const order = [], byWard = {};
  ids.map((id) => P.describe(id))
    .sort((a, b) => (a.ward || 0) - (b.ward || 0) || (a.precinct - b.precinct))
    .forEach((d) => {
      const key = d.ward == null || d.ward === '' ? '' : String(d.ward);
      if (!byWard[key]) { byWard[key] = []; order.push(key); }
      byWard[key].push(String(d.precinct));
    });
  return order.map((ward) => {
    const nums = byWard[ward];
    return '<div class="dw">' +
      (ward ? `Ward ${esc(ward)} \u00b7 ` : '') +
      `Precinct${nums.length > 1 ? 's ' : ' '}${esc(nums.join(', '))}</div>`;
  }).join('');
}

function drawPollingPlaces(activePrecinct) {
  if (!P || !pollLayer) return;
  pollLayer.clearLayers();
  const seen = {};
  // Match by building, not precinct: a consolidated precinct's marker carries its host's key.
  const activePlace = activePrecinct && P.pollingPlace(activePrecinct);
  const activeKey = activePlace?.lat != null
    ? `${activePlace.lat.toFixed(5)},${activePlace.lng.toFixed(5)}` : null;
  Object.keys(P.polling).forEach((pk) => {
    const pl = P.pollingPlace(pk);
    if (!pl || pl.lat == null) return;
    // One marker per building; its detail is built on open, after every precinct has joined.
    const key = `${pl.lat.toFixed(5)},${pl.lng.toFixed(5)}`;
    if (seen[key]) { seen[key].push(pk); return; }
    const atThisSpot = seen[key] = [pk];
    const isActive = !!activeKey && key === activeKey;
    const m = L.marker([pl.lat, pl.lng], {
      icon: siteIcon('polling', isActive),
      zIndexOffset: isActive ? 500 : 300, keyboard: false, riseOnHover: true
    }).addTo(pollLayer);
    bindDetail(m, () => placePopup('Polling place', displayCase(pl.name), pl,
                                   precinctLines(atThisSpot)), 280);
  });
}

function drawSites(r) {
  if (!siteLayer) return;
  siteLayer.clearLayers();
  if (!r) return;
  destinations(r).forEach((opt) => {
    if (opt.kind === 'polling') return;      // drawn with all the others
    const list = opt.all?.length ? opt.all : [opt.place];
    list.forEach((place) => {
      if (!place || place.lat == null) return;
      const isPick = place === opt.place;
      const m = L.marker([place.lat, place.lng], {
        icon: siteIcon(opt.kind, isPick),
        zIndexOffset: isPick ? 450 : 250, keyboard: false, riseOnHover: true
      }).addTo(siteLayer);
      bindDetail(m, placePopup(
        opt.kind === 'early' ? 'Early voting site' : 'Absentee ballot drop box',
        boxLabel(place), place,
        place.hours ? `<div class="dw">${esc(place.hours)}</div>` : ''), 280);
    });
  });
}

// ---- Cameras ----

// The drawing and popup text come from Cameras in map.js; this wraps them for Leaflet.
function cameraIcon(c, flagged) {
  const art = Cameras.markerSvg(c, flagged, getVar('--pin-ring'));
  return L.divIcon({ className: 'cam-icon', html: art.html,
                     iconSize: [art.size, art.size],
                     iconAnchor: [art.centre, art.centre] });
}

function paintLegendCamera() {
  const el = document.querySelector('.map-legend .dotk');
  if (!el) return;
  el.innerHTML = Cameras.legendSvg(getVar('--pin-ring'));
  el.setAttribute('title', 'RoboCop');
}

// OSM maps the pole, beside the road; the dot is drawn snapped onto the road it watches.
function cameraDisplayPos(c) {
  return graph ? graph.cameraPos(c.id, c.lat, c.lng) : [c.lat, c.lng];
}

// The only camera source is cameras.json (scripts/refresh_cameras.py); no server is asked.
function renderCameraCount() {
  const fold = $('camCountFold');
  if (!fold) return;
  const n = cameras ? cameras.length : 0;
  fold.textContent = `${n} reported camera${n === 1 ? '' : 's'}` +
    ' in Kent County, from OpenStreetMap as of the last time this page ' +
    'was published. Volunteer-mapped and certainly incomplete, so treat ' +
    'it as a floor rather than a full count.';
}

// Cameras show only once there is a route; the toggle, the draw and the label obstacles
// all ask here.
function camerasInScope() { return !!routes; }

// map.js keeps street labels off camera dots; hidden cameras are not obstacles. The
// signature skips setObstacles, which forces a canvas redraw, when nothing moved.
let obstacleSig = null;
function syncLabelObstacles() {
  const visible = layerState().cameras && camerasInScope();
  const pts = visible && cameras
    ? cameras.map((c) => cameraDisplayPos(c))
    : [];
  // Count alone is not enough: a re-snap moves markers without changing how many.
  const sig = `${visible}:${pts.length}` +
    (pts.length ? `:${pts[0][0].toFixed(6)},${pts[0][1].toFixed(6)}` : '');
  if (sig === obstacleSig) return;
  obstacleSig = sig;
  ownBase.setObstacles(pts);
}

function drawCameras(flagged) {
  renderCameraCount();
  camLayer.clearLayers();
  if (!camerasInScope()) {
    if (map.hasLayer(camLayer)) map.removeLayer(camLayer);
    syncLabelObstacles();
    return;
  }
  if (layerState().cameras && !map.hasLayer(camLayer)) camLayer.addTo(map);
  const flag = flagged || {};
  cameras.forEach((c) => {
    const mk = L.marker(cameraDisplayPos(c), {
      icon: cameraIcon(c, !!flag[c.id]),
      zIndexOffset: flag[c.id] ? 600 : 400,
      keyboard: false
    });
    bindDetail(mk, () => Cameras.popupHtml(c), 300);
    mk.addTo(camLayer);
  });
  syncLabelObstacles();
}

// ---- Address lookup ----

function reset() {
  hideDetail();
  hideMap();
  routeLayer.clearLayers(); pinLayer.clearLayers();
  current = null;
  $('addr').value = ''; ac.close();
  $('resultBlock').hidden = true; $('routeBlock').hidden = true;
  $('routeBlock').classList.remove('map-only');
  routes = null;   // out of scope: reset also takes the cameras off the map
  $('col').classList.remove('has-result');
  document.body.classList.remove('has-result');
  if ($('sectionNav')) $('sectionNav').hidden = true;
  window.scrollTo({ top: 0, behavior: 'smooth' });
  disarmPin();
  ownBase.setRouteStreets([], null);
  ownBase.setActivePrecinct(null);
  ownBase.setScope(null);
  drawPollingPlaces();
  drawSites(null);
  drawCameras();
  map.setView(GR, 13);
  $('addr').focus();
}

function choose(item) {
  if (!item) return;
  ac.close();
  if (item.kind === 'outside') {
    $('addr').value = (item.number != null ? `${item.number} ` : '') +
      displayCase(item.street);
    $('addr').blur();
    chooseOutside(item);
    return;
  }
  const input = $('addr');
  // Shown as written, not in the index's capitals; the lookup uppercases anyway.
  input.value = `${item.number} ${displayCase(item.street)}`;
  resetChoices();
  // The row's own jurisdiction: the same number and street can be real in two places.
  const r = P.lookup(input.value, item.mcd);
  if (r.error === 'several_places') {
    const places = r.places.map((p) => esc(p.jurisdiction)).join(' and in ');
    showError(`${esc(input.value)} is an address in ${places}` +
      '. Pick yours from the list as you type.');
    return;
  }
  if (r.error) {
    showError(`Could not resolve ${esc(input.value)}.`);
    return;
  }
  // An address inferred from its neighbors is checked against the precinct polygons (voting.js).
  P.refineWithPolygon(r, (n, st) => graph.geocode(n, st, within(r.mcd)), precincts);
  setHint('');
  // Blur first, so show() fits the map to the viewport without the phone keyboard.
  input.blur();
  show(r);
}

// Grand Rapids is the only jurisdiction whose clerk file this page carries. Elsewhere drop
// boxes come from the county or state, and early voting is not shown (no current source).
function inGrandRapids(r) {
  return r?.mcd === GR_MCD;
}

// The state's index omits "City"; Grand Rapids and Grand Rapids Township are different places.
function jurisdictionLabel(name) {
  return /Township$/i.test(name) ? name : `${name} City`;
}

// The index's own matches first; streets it cannot answer only fill the remaining slots.
function suggestWithNeighbors(text, limit) {
  if (P.parseTyped(text).number == null) return [];
  const out = P.suggest(text, limit) || [];
  // Every row names its jurisdiction, not only the unanswerable ones.
  out.forEach((o) => {
    o.where = (o.where || []).map(jurisdictionLabel);
  });
  if (out.length >= limit || !neighbors) return out;

  const typed = P.parseTyped(text);
  if (!typed.rest || typed.rest.length < 2) return out;
  const have = {};
  out.forEach((o) => { have[o.street] = 1; });

  const names = Object.keys(neighbors)
    .filter((name) => !have[name] && name.startsWith(typed.rest))
    .sort();

  for (let i = 0; i < names.length && out.length < limit; i++) {
    const jurisdictions = neighbors[names[i]] || [];
    out.push({ street: names[i], number: typed.number, kind: 'outside',
               where: jurisdictions.map(jurisdictionLabel),
               jurisdictions });
  }
  return out;
}

function chooseOutside(item) {
  setHint('');
  showError(unansweredStreet(item.jurisdictions || []));
}

function unansweredStreet(jurisdictions) {
  const labels = jurisdictions.map(jurisdictionLabel);
  const where = !labels.length ? 'another jurisdiction'
    : labels.length === 1 ? esc(labels[0])
    : `${esc(labels.slice(0, -1).join(', '))} or ${esc(labels[labels.length - 1])}`;
  const covered = jurisdictions.some((j) => P.coversJurisdiction(j));
  if (covered) {
    return `That street is in ${where}, but the address list this ` +
      'tool uses has no address on it, so it cannot be looked up by ' +
      'address. Use the pin button beside the search box and drop the ' +
      'pin where you live, and it will find your precinct from there.';
  }
  return `That address is in ${where}, which this tool does not ` +
    'cover, so it cannot say where you vote. The Michigan Voter ' +
    'Information Center at mvic.sos.state.mi.us will have your polling place.';
}

function missExplanation(typed) {
  // parseTyped's rest (uppercased, no house number) is exactly how neighbors.json is keyed.
  const parsed = P.parseTyped(typed), street = parsed.rest;
  if (parsed.number == null) {
    return 'Start with the house number, like 300 Monroe Ave NW.';
  }
  const hit = neighbors && street ? neighbors[street] : null;
  if (hit?.length) return unansweredStreet(hit);
  return 'No Kent County street matches that. Check the spelling and the ' +
    'direction, like 300 Monroe Ave NW. This tool covers Kent County, ' +
    'Michigan; an address in Ottawa, Allegan, Barry, Ionia, Montcalm or ' +
    'Newaygo County is not in it.';
}

// ---- Dropped pin ----

// The one point-in-polygon test lives in voting.js, so the lookup and the map agree.
function precinctAt(lat, lng) {
  if (!P || !precincts) return null;
  return P.precinctAt(lat, lng, precincts);
}

// Prefer the address's own jurisdiction: Rockford's 113 N Main St NE otherwise lands in
// Cedar Springs. The ~45 m nudges catch section-line roads that are the boundary itself.
const NUDGES = [[0, 0], [4e-4, 0], [-4e-4, 0], [0, 5.5e-4], [0, -5.5e-4]];
const withinCache = {};
function within(mcd) {
  if (!mcd || !precincts) return null;
  if (!withinCache[mcd]) {
    const mine = precincts.filter((p) => p.mcd === mcd);
    withinCache[mcd] = (lat, lng) => NUDGES.some((d) =>
      mine.some((p) => Precincts.pointInRings(lat + d[0], lng + d[1], p.rings)));
  }
  return withinCache[mcd];
}

function addressPoint(r) {
  return r.pin ? { lat: r.lat, lng: r.lng }
               : graph.geocode(r.number, r.street, within(r.mcd));
}

function armPin() {
  pinArmed = true;
  const fresh = $('mapBlock').hidden;
  revealMap();
  if (fresh && map) map.setView(GR, 12);
  // An open popup would turn its own close button into a pin drop.
  if (map) map.closePopup();
  $('pinBtn').classList.add('armed');
  $('pinBtn').setAttribute('aria-pressed', 'true');
  $('map').classList.add('pin-armed');
  setHint('Tap the map where you want to start from. Esc cancels.');
  $('pinCue').textContent = 'Tap anywhere in Kent County to start from that spot.';
  $('pinCue').hidden = false;
  scrollToResult('mapBlock');
}

function disarmPin() {
  $('pinCue').hidden = true;
  pinArmed = false;
  $('pinBtn').classList.remove('armed');
  $('pinBtn').setAttribute('aria-pressed', 'false');
  $('map').classList.remove('pin-armed');
  setHint('');
}

function pinLookup(lat, lng) {
  if (!graph || !P) return;
  resetChoices();
  const pr = precinctAt(lat, lng);
  if (!pr) {
    $('addr').value = ''; ac.close();
    showError('That spot is outside Kent County, or not in any precinct ' +
      'we have. This tool covers Kent County, Michigan. Try dropping the ' +
      'pin on a street, or type the address instead.');
    return;
  }
  const who = P.describe(P.idOf(pr));
  const place = P.pollingPlace(who.code);
  $('addr').value = ''; ac.close();
  setHint('Routing from your dropped pin. Type an address to switch back.');
  // Land on the map: scrolling it away would move the thing under the finger that tapped.
  show({ pin: true, lat, lng, code: who.code,
         precinct: who.precinct, ward: who.ward,
         jurisdiction: who.jurisdiction, mcd: who.mcd, place },
       null, 'mapBlock');
}

// ---- The answer ----

function showError(msg) {
  $('resultBlock').hidden = false; $('routeBlock').hidden = true;
  $('precinctInfo').innerHTML = `<div class="err">${msg}</div>`;
  $('advisory').innerHTML = '';
  routeLayer.clearLayers(); pinLayer.clearLayers();
  routes = null;   // or a theme change redraws the last answer's route
  drawCameras();
}

function dropBoxCard(r) {
  const box = destinations(r).find((o) => o.kind === 'dropbox');
  if (!box) return '';
  const label = placeLabel('dropbox', box.place.office
    ? 'Where to return an absentee ballot'
    : 'Ballot drop box nearest to you');
  const addr = box.place.address ? esc(addressForDisplay(box.place.address)) : '';
  const where =
    `<div class="vi-where vi-dropbox${customClass('dropbox')}" data-kind="dropbox">` +
    `<div class="vi-lbl">${esc(label)}</div>` +
    `<div class="pp-name">${esc(boxLabel(box.place))}</div>` +
    `<div class="pp-addr">${addr}</div>` +
    metaBlock([locLine(box.place.note), boxHoursHtml(box.place, 'div', {})]) +
    actionRow('dropbox', box.place.office ? '' :
      '<button type="button" class="box-open" id="boxListBtn">' +
      'Show all drop box locations</button>') +
    '</div>';

  const st = absenteeState();
  return section('dropbox', where, whenCell('dropbox', st, ''),
                 { collapsed: !/open/i.test(st.label) });
}

function earlyVotingCard(r) {
  const evState = earlyVotingForBlock(r);
  if (!evState) return '';
  // ev may be empty though a window is published: destinations() needs coords and an origin.
  const dest = destinations(r).find((o) => o.kind === 'early');
  const ranked = evState.site && !dest ? evRanked(r) : null;
  const ev = !evState.site ? null : dest || (ranked && { place: ranked[0], all: ranked });
  // Over: shown disabled with no data-kind, so nothing routes to it. destinations()
  // leaves it out too: no picker, no map.
  const routable = !!dest;
  const label = routable ? placeLabel('early', 'Early voting site nearest to you')
              : ev ? 'Early voting site nearest to you' : 'Early voting sites';
  const where = `<div class="vi-where vi-ev-site${routable ? customClass('early') : ''}` +
    `${evState.off ? ' is-off' : ''}"` +
    `${routable ? ' data-kind="early"' : ''}>` +
    `<div class="vi-lbl">${esc(label)}</div>` +
    (ev
      ? `<div class="pp-name">${esc(displayCase(ev.place.name))}</div>` +
        `<div class="pp-addr">${esc(addressForDisplay(ev.place.address))}</div>` +
        metaBlock([locLine(ev.place.entrance_note)]) +
        (ev.all.length > 1 && !evState.ended
          ? '<div class="pp-note">Early voting is not tied to your ' +
            'precinct. Any Grand Rapids voter may use any of these ' +
            `${ev.all.length} sites.</div>`
          : '')
      : '<div class="pp-addr">No site published yet.</div>') +
    (routable ? actionRow('early', ev.all.length > 1
          ? '<button type="button" class="box-open" id="evListBtn">' +
            'Show all locations</button>'
          : '') : '') +
    '</div>';
  return section('early', where,
    whenCell('early', { label: evState.label, status: evState.status, note: evState.note,
                        live: !evState.off, off: evState.off,
                        now: nowKind(r) === 'early' ? 'Open now' : null },
             routable ? evHoursHtml(activeEl) : ''),
    { collapsed: evState.off || (!!ev && !/open/i.test(evState.label)) });
}

// multi: there are other destinations to choose between.
function pollingCard(r, multi) {
  let html = `<div class="vi-where${activeEl ? '' : ' vi-full'}" data-kind="polling">` +
    '<div class="vi-lbl">Election day polling place</div>';
  const place = r.place;
  if (place) {
    // Alone, the place itself shows the map; with other destinations the whole cell routes.
    const clickable = !!(place.lat && place.lng);
    const showAttrs = clickable && !multi
      ? ' id="showPlaceBtn" role="button" tabindex="0" title="Show it on the map"'
      : '';
    html += `<div${clickable ? ' class="pp-place"' : ''}${showAttrs}>` +
      `<div class="pp-name">${esc(displayCase(place.name))}</div>` +
      `<div class="pp-addr">${esc(addressForDisplay(place.address))}</div>` +
      metaBlock([locLine(place.entrance_note)]) +
      '</div>' +
      (clickable ? actionRow('polling') : '');
    if (place.consolidated_with) {
      html += `<div class="pp-note">Precinct ${esc(r.precinct)} votes with precinct ` +
        `${esc(precinctNumber(place.consolidated_with, r.ward))} this election` +
        (place.note ? `, because ${esc(place.note).toLowerCase()}` : '') + '.</div>';
    }
  } else {
    html += `<div class="err">No polling place on file for precinct ${esc(r.precinct)}.</div>`;
  }
  html += '</div>';

  let when = null;
  if (activeEl) {
    when = whenCell('polling',
      { label: 'Election day', status: Elections.withWeekday(activeEl.date),
        now: nowKind(r) === 'polling' ? 'Today' : null },
      electionDayHours?.open && electionDayHours.close
        ? '<div class="vi-hours"><span class="vi-hours-lbl">Hours:</span> ' +
          `${esc(Elections.shortTime(electionDayHours.open))} to ` +
          `${esc(Elections.shortTime(electionDayHours.close))}</div>`
        : '');
  }
  return section('polling', html, when, { collapsed: false });
}

// landOn: the block to scroll to afterwards, the voting info by default.
function show(r, focusKind, landOn) {
  current = r;
  $('col').classList.add('has-result');
  document.body.classList.add('has-result');
  const nav = $('sectionNav');
  if (nav) { nav.hidden = false; requestAnimationFrame(syncSectionNav); }
  revealMap();
  const place = r.place;
  $('resultBlock').hidden = false;

  // Rows may omit their where-cell, so style.css places the grid columns explicitly.
  let html = '<div class="vi-rows"><div class="vi-grid"><div class="vi-rail">' +
    (r.jurisdiction ? '<div><div class="vi-lbl">Where you vote</div>' +
                      `<div class="vi-name">${esc(r.jurisdiction)}</div></div>` : '') +
    // .vi-idn marks the Ward and Precinct rows; tests/test_page.mjs finds them by it.
    (r.ward != null && r.ward !== ''
      ? '<div class="vi-idn"><div class="vi-lbl">Ward</div>' +
        `<div class="vi-num">${esc(r.ward)}</div></div>` : '') +
    '<div class="vi-idn"><div class="vi-lbl">Precinct</div>' +
    `<div class="vi-num">${esc(r.precinct)}</div></div></div>`;

  const multi = destinations(r).length > 1;
  const boxHtml = dropBoxCard(r), evHtml = earlyVotingCard(r),
      pollHtml = pollingCard(r, multi);

  // The drop box first, the order a voter can act in, except on election day, when the
  // polls come first. destinations() puts the routed default in the same place.
  html += isElectionDay() ? pollHtml + boxHtml + evHtml
                          : boxHtml + evHtml + pollHtml;

  html += '</div></div>';
  $('precinctInfo').innerHTML = html;
  wirePlaceLists(r);

  // Stopped here: the cell around the button is a tap target too, and would route again.
  $('precinctInfo').querySelectorAll('.dir-btn').forEach((b) => {
    b.onclick = (e) => {
      e.stopPropagation();
      if (!current) return;
      routeTo(current, b.dataset.dir);
      scrollToDirections();
    };
  });

  const destCells = $('precinctInfo').querySelectorAll('[data-kind]');
  const phone = isPhone();
  destCells.forEach((cell) => {
    const kind = cell.dataset.kind;
    if (!multi && !phone) return;
    cell.classList.add('vi-dest');
    cell.setAttribute('role', 'button');
    cell.setAttribute('tabindex', '0');
    cell.setAttribute('aria-pressed', 'false');
    cell.title = phone ? 'Directions here' : 'Get directions here instead';
    cell.onclick = () => {
      if (!current) return;
      routeTo(current, kind);
      if (phone) scrollToDirections();
    };
    cell.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); cell.click(); }
    };
  });

  // Present only when the polling place is the one destination.
  const spb = $('showPlaceBtn');
  if (spb) {
    spb.onkeydown = (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault(); e.stopPropagation(); spb.click();
    };
    spb.onclick = (e) => {
      // Stopped: on a phone the surrounding cell would route and scroll away from this view.
      e.stopPropagation();
      if (!place?.lat) return;
      revealMap();
      map.setView([place.lat, place.lng], 16);
      $('mapBlock').scrollIntoView({ block: 'center', behavior: 'smooth' });
      pollLayer.eachLayer((m) => {
        const ll = m.getLatLng();
        if (Math.abs(ll.lat - place.lat) < 1e-6 && Math.abs(ll.lng - place.lng) < 1e-6) {
          const el = m.getElement();
          if (el) {
            el.classList.remove('pulse');
            void el.offsetWidth;   // restart the animation on repeat clicks
            el.classList.add('pulse');
          }
        }
      });
    };
  }

  // The page's only disclaimer (tests check it appears once). The ballot follows the voter's
  // registration, not the address typed here; the clerk named is the jurisdiction's own.
  const office = !inGrandRapids(r) && P && r.mcd ? P.clerkOf(r.mcd) : null;
  const whom = inGrandRapids(r)
    ? 'the <a href="https://www.grandrapidsmi.gov/departments/clerks-office/" ' +
      'target="_blank" rel="noopener">Grand Rapids City Clerk</a>'
    : r.jurisdiction
    ? `the ${esc(r.jurisdiction)} clerk` +
      (office?.phone ? ` (${esc(office.phone)})` : '')
    : 'your clerk';
  const adv = ['<strong>Not an official government tool.</strong> Your voting ' +
    'location is based on the address where you registered to vote, not ' +
    'what you enter here. If you are not sure the entered address is the ' +
    `same, double-check with ${whom} or the ` +
    '<a href="https://mvic.sos.state.mi.us/" target="_blank" ' +
    'rel="noopener">Michigan Voter Information Center</a>.'];
  if (r.rivals) adv.push('This address sits on a precinct line and could be in ' +
    `${esc(r.rivals.join(' or '))}.`);
  else if (r.inferred) adv.push('This exact number is not in ' +
    'the address list, so the precinct was taken from its neighbors and ' +
    'checked against the precinct boundary.');
  if (r.edgeMetres < 30) adv.push('This address is close ' +
    'to a precinct boundary, so the answer is less certain.');
  if (r.ambiguousStreet) adv.push(`Read as ${esc(displayCase(r.street))}` +
    '. Other streets also match what you typed.');
  adv.push('Obey all traffic signs and laws.');
  $('advisory').innerHTML = `<div class="advisory">${adv.join(' ')}</div>`;

  routeTo(r, focusKind);
  // After routeTo and a frame later: the blocks it fills have no position until laid out.
  requestAnimationFrame(() => { scrollToResult(landOn || 'resultBlock'); });
}

// ---- Election and destination ----
// In an early voting window any Grand Rapids voter may use any site, so the nearest is
// offered; on election day only the voter's own polling place will do. The calendar
// arithmetic is Elections in voting.js, shared with /simple; only the wording is here.

// Same shape as /simple's hours, so the two pages read alike.
function evHoursHtml(e) {
  const rules = e?.early_voting_hours || [];
  if (!rules.length) return '';
  const today = Elections.todayAbbr();
  let out = '<div class="vi-hours-lbl ev-hours-lbl">Hours:</div>' +
            '<div class="ev-hours">';
  for (const rule of rules) {
    const days = rule.days || [];
    const mark = days.includes(today) ? ' class="is-today"' : '';
    out += `<span${mark}>${esc(days.join(', '))}${mark ? ' (today)' : ''}</span>` +
           `<span${mark}>${esc(Elections.shortTime(rule.open))} to ` +
           `${esc(Elections.shortTime(rule.close))}</span>`;
  }
  return `${out}</div>`;
}

// One accessor for the answer block and the destination list, so they cannot disagree.
// Grand Rapids only: other clerks set their own dates and this page has no source for them.
function evWindow(r) {
  if (!inGrandRapids(r)) return null;
  if (clerkForThisElection(r)) {
    return { early_voting_from: clerk.early_voting.from,
             early_voting_to: clerk.early_voting.to,
             early_voting_days: clerk.early_voting.days || [],
             early_voting_sites: clerk.sites };
  }
  return activeEl;
}

// gr-clerk.json describes only the election it names; it must never date another one.
function clerkForThisElection(r) {
  return !!(inGrandRapids(r) && clerk?.early_voting && activeEl &&
            clerk.election === activeEl.date);
}

// 'none' (a half-published window) yields no row at all.
function earlyVotingForBlock(r) {
  const w = activeEl && evWindow(r);
  if (!w) return null;
  const to = w.early_voting_to;
  switch (Elections.windowState(w)) {
    case 'none':
      return null;
    case 'closed':
      return { label: 'Early voting closed',
               status: `Ended ${Elections.dayMonth(to)}`, site: inGrandRapids(r), off: true,
               ended: true,
               note: 'Early voting has ended. Its sites no longer take ballots, ' +
                     'so they are not offered for directions.' };
    // Not off: a reader may plan the trip ahead (destinations()), so every mention of a
    // site before its first day says when that day is.
    case 'before':
      return { label: 'Early voting dates',
               status: `${Elections.dayMonth(w.early_voting_from)} to ${Elections.dayMonth(to)}`,
               site: inGrandRapids(r),
               note: 'Early voting has not opened yet. Its sites take ballots from ' +
                     `${Elections.dayMonth(w.early_voting_from)}, and you can plan ` +
                     'directions to any of them now.' };
    default:
      return { label: 'Early voting open',
               status: `Through ${Elections.dayMonth(to)}`,
               site: inGrandRapids(r) };
  }
}

// ---- Election day countdown ----
// Counts to local midnight starting election day. Each tick recomputes from the current
// instant rather than decrementing, so sleep, throttling and clock changes cannot drift it.
// Elapsed time, not calendar days: across the November DST change it shows the extra hour.

let cdTimer = null;

function startCountdown() {
  if (cdTimer) { clearInterval(cdTimer); cdTimer = null; }
  renderCountdown();
  if (activeEl) cdTimer = setInterval(renderCountdown, 1000);
}

function noteLine() {
  return `<span class="cd-for">${esc(activeEl.name)}:</span> ` +
    `<span class="cd-when">${esc(Elections.withWeekday(activeEl.date))}</span>`;
}

function renderCountdown() {
  const box = $('countdown'), clock = $('cdClock'), note = $('cdNote'),
      said = $('cdSaid'), label = $('cdLabel');
  if (!box || !clock) return;

  // A page left open past midnight moves on to the next election.
  if (activeEl && activeEl.date < Elections.todayISO()) {
    activeEl = Elections.next(electionList);
  }

  if (!activeEl) {
    box.hidden = true;
    if (cdTimer) { clearInterval(cdTimer); cdTimer = null; }
    return;
  }

  const target = Elections.dayStart(activeEl.date);
  if (!target) { box.hidden = true; return; }
  const left = target.getTime() - Date.now();

  // Days unpadded; the rest zero-padded so the row keeps its width as the seconds tick.
  const unit = (n, name, pad) => {
    const num = pad ? String(n).padStart(2, '0') : String(n);
    return `<span class="cd-unit"><b class="cd-num">${num}</b>` +
      `<span class="cd-lab">${name}</span></span>`;
  };
  const hms = (ms) => {
    let s = Math.max(0, Math.floor(ms / 1000));
    const hrs = Math.floor(s / 3600); s -= hrs * 3600;
    const mins = Math.floor(s / 60); s -= mins * 60;
    return unit(hrs, 'Hours', true) + unit(mins, 'Minutes', true) +
           unit(s, 'Seconds', true);
  };

  if (left <= 0) {
    // Election day: count to the polls opening, then to closing, then say they have closed.
    const now = new Date();
    const phase = Elections.pollsPhase(activeEl, electionDayHours, now);
    if (phase === 'before') {
      if (label) label.textContent = 'Polls Open In:';
      clock.innerHTML = hms(Elections.atTime(activeEl.date, electionDayHours.open) - now);
      if (said) said.textContent = 'Polls open at ' +
        `${Elections.shortTime(electionDayHours.open)} today for the ${activeEl.name}.`;
    } else if (phase === 'open') {
      if (label) label.textContent = 'Polls Close In:';
      clock.innerHTML = hms(Elections.atTime(activeEl.date, electionDayHours.close) - now);
      if (said) said.textContent = 'Polls are open until ' +
        `${Elections.shortTime(electionDayHours.close)} today for the ${activeEl.name}.`;
    } else if (phase === 'closed') {
      if (label) label.textContent = 'Polls Have Closed:';
      clock.innerHTML =
        `<span class="cd-today">${esc(Elections.shortTime(electionDayHours.close))}</span>`;
      if (said) said.textContent = (electionDayHours.in_line_note ||
        'Everyone in line when the polls closed must be allowed to vote.');
    } else {
      if (label) label.textContent = 'Election Day:';
      clock.innerHTML = '<span class="cd-today">Today</span>';
      if (said) said.textContent = `The ${activeEl.name} is today, ` +
        `${Elections.withWeekday(activeEl.date)}.`;
    }
    if (note) note.innerHTML = noteLine();
    box.hidden = false;
    return;
  }

  if (label) label.textContent = 'Election Day is In:';
  const days = Math.floor(left / 86400000);
  clock.innerHTML = unit(days, 'Days', false) + hms(left - days * 86400000);

  if (note) note.innerHTML = noteLine();
  if (said) said.textContent = `${days}${days === 1 ? ' day' : ' days'} until the ` +
    `${activeEl.name} on ${Elections.withWeekday(activeEl.date)}.`;
  box.hidden = false;
}

// The clerk publishes addresses only; geocoding them against the routing graph keeps them
// on their streets, which a stored coordinate would not. canonStreet (router.js) absorbs
// the clerk's spelled-out or missing street types.
function placeCoords(data) {
  if (!data || !graph) return null;
  function fix(place) {
    const m = /^(\d+)\s+(.+)$/.exec(place.address || '');
    const hit = m && graph.geocode(Number(m[1]), m[2], within(GR_MCD));
    return hit ? Object.assign({}, place, { lat: hit.lat, lng: hit.lng }) : null;
  }
  return {
    election: data.election,
    early_voting: data.early_voting || null,
    sites: (data.early_voting_sites || []).map(fix).filter(Boolean),
    // Boxes without a street address go to unrouted, which the full list still names.
    boxes: (data.drop_boxes || []).map(fix).filter(Boolean),
    unrouted: (data.drop_boxes || []).filter((b) => !b.address)
  };
}

// Straight-line distance, not driving: a route search per place is not worth it here.
function nearest(origin, places) {
  if (!origin || !places || !places.length) return null;
  return places.map((p) => Object.assign({}, p, {
    metres: haversine(origin.lat, origin.lng, p.lat, p.lng)
  })).sort((a, b) => a.metres - b.metres);
}

function resetChoices() { chosen = { dropbox: 0, early: 0 }; }

// Grand Rapids: the clerk's file. Elsewhere: county or state lists, geocoded at build time.
function boxesFor(r) {
  if (!r) return [];
  if (inGrandRapids(r)) return clerk?.boxes || [];
  const boxes = (P ? P.dropBoxes(r.mcd) : [])
    .filter((b) => b.lat && b.lng)
    .map(normaliseHours);
  if (boxes.length) return boxes;
  // No box published: by law the ballot goes back to the voter's own clerk. office: true
  // keeps anything downstream from calling it a box or giving it box hours.
  const office = P ? P.clerkOf(r.mcd) : null;
  if (!office || !office.lat || !office.lng) return [];
  // The county often trails a P.O. Box after the street line, so keep the first part.
  const street = String(office.address || '').split(',')[0].trim();
  return [{
    name: `${r.jurisdiction || 'Your'} Clerk\u2019s Office`,
    address: street || String(office.address || '').trim() || null,
    phone: (office.phone && String(office.phone).trim()) || null,
    lat: office.lat, lng: office.lng,
    hours: null, office: true
  }];
}

// Other hours are labelled, in amber, so they do not read as the building's hours. The
// county publishes no clerk office hours, so an office can only say it keeps some.
function boxHoursHtml(b, tag, cls) {
  function line(c, text) {
    const attr = c ? ` class="${c}"` : '';
    return `<${tag}${attr}>${text}</${tag}>`;
  }
  if (b.office) {
    return line('bx-hours-odd', 'Open during office hours') +
      (b.phone ? line(cls.phone, esc(b.phone)) : '');
  }
  if (!b.hours) return '';
  return ALWAYS_OPEN.test(b.hours) ? line(cls.open, 'Open 24/7')
                                   : line('bx-hours-odd', `Open hours: ${esc(b.hours)}`);
}

function officeOnly(list) {
  return !!(list?.length && list[0].office);
}

// The county writes "24 hours a day, 7 days a week" where the city writes "24/7".
const ROUND_THE_CLOCK = /24\s*hours?\s*(a|per)\s*day.*7\s*days/i;
function normaliseHours(b) {
  if (b.hours && ROUND_THE_CLOCK.test(b.hours)) {
    return Object.assign({}, b, { hours: '24/7' });
  }
  return b;
}

function destSub(pick, r) {
  const opens = evOpensOn(pick, r);
  return pick.kind === 'early' ? `Early voting site${opens ? `, opens ${opens}` : ''}`
       : pick.kind === 'dropbox' ? 'Absentee ballot drop box'
       : `Precinct ${r.precinct}`;
}

// 'Tuesday, October 20' for an early voting pick whose window has not opened, else null.
function evOpensOn(pick, r) {
  if (pick?.kind !== 'early' || pick.state !== 'before') return null;
  const from = evWindow(r)?.early_voting_from;
  return from ? Elections.dayMonth(from) : null;
}

// Grand Rapids sites only: offering them elsewhere would send voters to the wrong clerk.
function evRanked(r) {
  const sites = !inGrandRapids(r) ? []
            : (clerkForThisElection(r) && clerk.sites.length) ? clerk.sites
            : Elections.sites(activeEl).filter((s) => s.lat && s.lng);
  return nearest(addressPoint(r), sites);
}

function destinations(r) {
  const out = [];
  const origin = addressPoint(r);

  const evState = Elections.windowState(evWindow(r));
  const ranked = evRanked(r);
  // Open, or not open yet, so a trip can be planned ahead; the ranking below never makes
  // a site that has not opened the default. Never once closed, and never undated
  // ('none'), since nothing says when those take ballots.
  if (ranked && (evState === 'open' || evState === 'before')) {
    out.push({ kind: 'early', label: 'Early voting',
               place: ranked[chosen.early] || ranked[0],
               all: ranked, state: evState });
  }

  if (r.place?.lat) {
    out.push({ kind: 'polling', label: 'Election day', place: r.place });
  }

  const boxes = nearest(origin, boxesFor(r));
  if (boxes) {
    out.push({ kind: 'dropbox', label: 'Drop box',
               place: boxes[chosen.dropbox] || boxes[0],
               all: boxes });
  }

  // The first is where the directions point before anything is clicked. On election day
  // the polls; otherwise the drop box while absentee ballots are out, which covers every
  // early voting window; otherwise early voting if open, then the polls.
  const evNow = nowKind(r) === 'early';
  const rank = evNow ? { early: 1, polling: 2, dropbox: 3 }
                     : { polling: 1, early: 2, dropbox: 3 };
  rank[isElectionDay() ? 'polling'
     : absenteePhase() === 'open' ? 'dropbox'
     : evNow ? 'early' : 'polling'] = 0;
  out.sort((a, b) => rank[a.kind] - rank[b.kind]);
  return out;
}

// ---- Routing and drawing ----

// Metres. About a block: covers an address geocoded to the middle of a long parcel.
const ARRIVED_M = 150;

function routeTo(r, forcedKind) {
  const opts = destinations(r);
  routeLayer.clearLayers(); pinLayer.clearLayers();

  if (!opts.length) {
    routes = null;
    $('routeBlock').hidden = true;
    return;
  }
  let pick = null;
  if (forcedKind) pick = opts.find((o) => o.kind === forcedKind);
  if (!pick) pick = opts[0];
  destChoice = pick;
  markDestination();

  const origin = addressPoint(r);
  if (!origin) {
    routeError();
    $('routes').innerHTML = '<div class="err">Found where you vote, but could not ' +
      'place your address on the street map, so no route is drawn.</div>';
    return;
  }
  const place = pick.place;

  if (haversine(origin.lat, origin.lng, place.lat, place.lng) <= ARRIVED_M) {
    // Still a routes object, so the destination picker stays live.
    routes = { here: true, opts, origin, place,
               destSub: destSub(pick, r) };
    renderAll(true);
    return;
  }

  const computed = computeRoutes(origin, place);
  if (!computed) {
    routeError();
    $('routes').innerHTML = '<div class="err">No drivable route between your address ' +
      `and ${esc(place.name)} on this road network.</div>`;
    map.fitBounds(L.latLngBounds([[origin.lat, origin.lng], [place.lat, place.lng]]).pad(.35), fitOpts());
    return;
  }

  routes = Object.assign(computed, {
    opts, origin, place,
    destSub: destSub(pick, r)
  });
  if (routes.identical) selected = 'avoid';
  renderAll(true);
}

// Clears routes, or a theme change redraws the old route under this error, and drops
// map-only, which would hide the message.
function routeError() {
  routes = null;
  drawCameras();
  $('routeBlock').hidden = false;
  $('routeBlock').classList.remove('map-only');
  $('steps').innerHTML = ''; $('unavoid').innerHTML = '';
}

// Page-free, so debug.js can drive it too. Null when there is no drivable path.
function computeRoutes(origin, place) {
  // Both ends are split into the graph and released in finally, so points and steps must
  // be read before then: the temporary edges are gone afterwards.
  const oSplit = graph.splitAt(origin.lat, origin.lng);
  const dSplit = graph.splitAt(place.lat, place.lng);
  const originNode = oSplit ? oSplit.node : graph.snapToRoad(origin.lat, origin.lng).node;
  const destNode = dSplit ? dSplit.node : graph.snapToRoad(place.lat, place.lng).node;

  let fast, avoid;
  const t0 = performance.now();
  try {
    // Fastest ignores cameras: hide the table for one search, restored even if it throws.
    const saved = graph._edgeCams;
    graph._edgeCams = null;
    try { fast = graph.route(originNode, destNode); }
    finally { graph._edgeCams = saved; }
    avoid = graph.route(originNode, destNode);
    if (fast) { fast.pts = routePoints(fast); fast.steps = graph.steps(fast); }
    if (avoid) {
      avoid.pts = routePoints(avoid);
      avoid.steps = graph.steps(avoid);
      avoid.camsOnRoute = camsOn(avoid.edges);
    }
    if (fast) fast.camsOnRoute = camsOn(fast.edges);
  } finally {
    if (dSplit) dSplit.release();
    if (oSplit) oSplit.release();
  }
  if (!fast || !avoid) return null;

  const fastExp = Object.keys(fast.camsOnRoute).length;
  let identical = sameRoute(fast, avoid, fastExp, avoid.cameraCount);

  // A camera route that is not actually faster (noRealSaving) is not offered at all.
  let fastDropped = false;
  if (!identical && fastExp > avoid.cameraCount && noRealSaving(fast, avoid)) {
    identical = true;
    fastDropped = true;
  }
  return {
    fast, avoid, identical, fastDropped,
    fastExp, avoidExp: avoid.cameraCount, flagged: fast.camsOnRoute,
    originNode, destNode,
    originSplit: !!oSplit, destSplit: !!dSplit,
    ms: Math.round(performance.now() - t0)
  };
}

function renderAll(fit) {
  if (!routes) return;

  // Unhide before measuring: a hidden section gives the map a zero size.
  $('routeBlock').hidden = false;
  $('routeBlock').classList.remove('map-only');
  // Unconditional: dropping map-only also changes the map's width.
  map.invalidateSize(false);

  routeLayer.clearLayers();
  pinLayer.clearLayers();

  if (routes.here) {
    drawCameras({});
    // The other destinations still belong on the map, and redrawing clears the last
    // answer's: the drop box default lands here for any address beside one.
    drawSites(current);
    renderDestPicker();
    $('routes').innerHTML =
      '<div class="here"><div class="here-h">You\u2019re already here</div>' +
      `<div class="here-b">${esc(displayCase(routes.place.name || ''))}` +
      ' is at the address you searched, so there is nothing here to navigate. ' +
      'Pick another destination above for directions.</div></div>';
    $('steps').innerHTML = ''; $('unavoid').innerHTML = '';
    renderRouteKey();
    bindDetail(marker([routes.place.lat, routes.place.lng], 'dest'),
      placePopup('You are here', displayCase(routes.place.name), routes.place,
                 `<div class="dw">${esc(routes.destSub)}</div>`), 280);
    if (fit) map.setView([routes.place.lat, routes.place.lng], 17, { animate: false });
    return;
  }

  drawCameras(routes.flagged);

  if (!routes.identical) {
    const other = selected === 'avoid' ? 'fast' : 'avoid';
    drawRoute(routes[other], 'muted', other);
  }
  drawRoute(routes[selected], selected === 'avoid' ? 'avoid' : 'fastmain', selected);
  renderRouteKey();

  // Drawn here, not in routeTo: the start arrow follows the selected route.
  const rp = routes[selected].pts;
  const brg = (rp && rp.length > 1) ? bearing(rp[0], rp[1]) : 0;
  originArrow = marker([routes.origin.lat, routes.origin.lng], 'origin', brg);
  bindDetail(marker([routes.place.lat, routes.place.lng], 'dest'),
    placePopup('Finish', displayCase(routes.place.name), routes.place,
               `<div class="dw">${esc(routes.destSub)}</div>`), 280);

  // Connectors show only when a split failed and the route starts at a junction. The ends
  // come from the geometry: the split nodes no longer exist.
  const pts = routes[selected].pts;
  if (pts?.length) {
    connector([routes.origin.lat, routes.origin.lng], pts[0]);
    connector([routes.place.lat, routes.place.lng], pts[pts.length - 1]);
  }
  if (fit) {
    // Fit both routes and both ends, so the frame does not move when the toggle flips.
    const fitB = L.latLngBounds(routes[selected].pts);
    if (!routes.identical) {
      const otherKey = selected === 'avoid' ? 'fast' : 'avoid';
      fitB.extend(L.latLngBounds(routes[otherKey].pts));
    }
    fitB.extend([routes.origin.lat, routes.origin.lng]);
    fitB.extend([routes.place.lat, routes.place.lng]);
    // Reflect the bounds through the start-finish midpoint so fitBounds centres on it.
    const midLat = (routes.origin.lat + routes.place.lat) / 2;
    const midLng = (routes.origin.lng + routes.place.lng) / 2;
    const sw = fitB.getSouthWest(), ne = fitB.getNorthEast();
    fitB.extend([2 * midLat - sw.lat, 2 * midLng - sw.lng]);
    fitB.extend([2 * midLat - ne.lat, 2 * midLng - ne.lng]);
    map.fitBounds(fitB, fitOpts());
  }

  ownBase.setActivePrecinct(current && (current.code || current.precinct));
  ownBase.setScope(current && current.mcd);
  // Polling places are keyed by code: asking by precinct number matched nothing.
  drawPollingPlaces(current && (current.code || current.precinct));
  drawSites(current);
  // Tell the basemap which streets this route uses so it names them first.
  ownBase.setRouteStreets(
    (routes[selected].steps || []).map((st) => st.street).filter(Boolean),
    routes[selected].pts);

  renderDestPicker();
  renderRouteCards();
  renderSteps();
  renderUnavoidable();
}

// Follows destChoice, not the click, so every way of choosing a destination shows here.
function markDestination() {
  const box = $('precinctInfo');
  if (!box) return;
  const cells = box.querySelectorAll('[data-kind]');
  cells.forEach((cell) => {
    const on = !!(destChoice && cell.dataset.kind === destChoice.kind);
    cell.classList.toggle('is-dest', on && cell.classList.contains('vi-dest'));
    if (cell.hasAttribute('aria-pressed')) {
      cell.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  });
}

function renderDestPicker() {
  const el = $('destPick');
  if (!el) return;
  el.innerHTML = routes
    ? destPickerHtml(routes.opts, destChoice?.kind) : '';
  el.querySelectorAll('button').forEach((b) => {
    b.onclick = () => { if (current) routeTo(current, b.dataset.kind); };
  });
}

function fitOpts() {
  const pad = isPhone() ? 24 : 38;
  // Top headroom covers the finish flag, which stands 32px above its anchor; the bottom
  // clears Leaflet's attribution strip.
  return { paddingTopLeft: [pad, Math.max(pad, 36)],
           paddingBottomRight: [pad, pad + 26] };
}

function camsOn(edges) {
  const s = {};
  edges.forEach((id) => {
    const cc = graph._edgeCams?.[id];
    if (cc) cc.forEach((x) => { s[x] = 1; });
  });
  return s;
}

function routePoints(r) {
  const pts = [];
  r.edges.forEach((id, i) => {
    const poly = graph.edgePoly(id);
    if (r.nodes[i] !== graph.edgeA(id)) poly.reverse();
    poly.forEach((p) => { pts.push(p); });
  });
  return pts;
}

// which: 'avoid' or 'fast'. kind: how prominently to draw it ('muted' when unselected).
function drawRoute(r, kind, which) {
  const pts = r.pts;
  const casing = getVar('--case');
  if (kind === 'muted') {
    // Solid, since dashes mean boundaries on this map, and in its own colour so the
    // unselected alternative never fades into the basemap.
    const tone = which === 'avoid' ? getVar('--route-avoid') : getVar('--route-fastsel');
    L.polyline(pts, { color: casing, weight: 9.5, opacity: .55,
      lineCap: 'round', lineJoin: 'round' }).addTo(routeLayer);
    L.polyline(pts, { color: tone, weight: 5.5, opacity: .95,
      lineCap: 'round', lineJoin: 'round' }).addTo(routeLayer);
    // The camera route keeps its stripes unselected, so the lines differ without the toggle.
    if (which !== 'avoid') {
      L.polyline(pts, { color: '#ffffff', weight: 5.5, opacity: .55,
        lineCap: 'butt', dashArray: '6 10', interactive: false }).addTo(routeLayer);
    }
    return;
  }
  const color = kind === 'avoid' ? getVar('--route-avoid') : getVar('--route-fastsel');
  L.polyline(pts, { color: casing, weight: 13, opacity: .75,
    lineCap: 'round', lineJoin: 'round' }).addTo(routeLayer);
  L.polyline(pts, { color, weight: 7.5, opacity: 1,
    lineCap: 'round', lineJoin: 'round' }).addTo(routeLayer);
  if (kind === 'avoid') {
    L.polyline(pts, { color: '#ffffff', weight: 7.5, opacity: .3, lineCap: 'butt',
      dashArray: '3 25', className: 'route-flow', interactive: false }).addTo(routeLayer);
  } else {
    // Stripes over a red duller than the camera dots, so the dots stay the loudest red.
    L.polyline(pts, { color: '#ffffff', weight: 7.5, opacity: .75, lineCap: 'butt',
      dashArray: '7 11', interactive: false }).addTo(routeLayer);
  }
}

// Below the map, not on it: any control inside the map eventually covers a marker.
function renderRouteKey() {
  const k = $('routeKey');
  if (!k) return;
  if (!routes || routes.here || routes.identical) { k.hidden = true; k.innerHTML = ''; return; }
  const row = (kind, label) => `<span class="rk-row${selected === kind ? ' on' : ''}">` +
    `<i class="rk-sw ${kind}"></i>${label}</span>`;
  k.innerHTML = row('avoid', 'Avoiding') + row('fast', 'Fastest');
  k.hidden = false;
}

function connector(from, to) {
  if (!from || !to) return;
  if (haversine(from[0], from[1], to[0], to[1]) < 12) return;
  L.polyline([from, [to[0], to[1]]], {
    color: getVar('--dim'), weight: 2.5, opacity: .8, dashArray: '2 6',
    lineCap: 'round', interactive: false
  }).addTo(routeLayer);
}

function marker(latlng, kind, bearingDeg) {
  const ring = getVar('--pin-ring');
  let html, anchor;
  if (kind === 'origin') {
    anchor = [17, 17];
    html = '<div style="width:34px;height:34px;border-radius:50%;' +
      `background:${getVar('--accent')};border:3px solid ${ring};` +
      'box-shadow:0 1px 8px rgba(0,0,0,.5);display:flex;align-items:center;' +
      `justify-content:center;transform:rotate(${bearingDeg || 0}deg)">` +
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="#fff">' +
      '<path d="M12 3l6 15-6-4-6 4z"/></svg></div>';
  } else {
    anchor = [6, 32];
    html = '<div style="width:34px;height:34px;position:relative">' +
      '<div style="position:absolute;left:4px;top:0;width:3px;height:32px;' +
      `border-radius:2px;background:${ring};box-shadow:0 1px 5px rgba(0,0,0,.45)"></div>` +
      '<svg style="position:absolute;left:7px;top:1px" width="22" height="15" viewBox="0 0 22 15">' +
      `<rect width="22" height="15" rx="2" fill="${getVar('--warn')}"/>` +
      '<g fill="rgba(20,16,6,.82)"><rect x="0" y="0" width="5.5" height="5"/>' +
      '<rect x="11" y="0" width="5.5" height="5"/><rect x="5.5" y="5" width="5.5" height="5"/>' +
      '<rect x="16.5" y="5" width="5.5" height="5"/><rect x="0" y="10" width="5.5" height="5"/>' +
      '<rect x="11" y="10" width="5.5" height="5"/></g></svg></div>';
  }
  const m = L.marker(latlng, {
    icon: L.divIcon({ className: '', html, iconSize: [34, 34],
      iconAnchor: anchor }),
    zIndexOffset: 1000
  }).addTo(pinLayer);
  if (kind === 'origin') {
    m.bindTooltip('Start', { direction: 'top', offset: [0, -10] });
  }
  return m;
}

function renderRouteCards() {
  $('routes').innerHTML = cardsHtml(routes, selected);
  $('routes').querySelectorAll('button[data-key]').forEach((b) => {
    b.onclick = () => { selected = b.dataset.key; renderAll(false); };
  });
}

function renderSteps() {
  // Read, never recomputed: the steps were taken while the split edges existed.
  const steps = routes[selected].steps;
  $('steps').innerHTML = stepsHtml(steps);

  // Clicking a step frames it; maxZoom 17 keeps a 40-foot leg from zooming to rooftops.
  $('steps').querySelectorAll('li').forEach((li) => {
    li.addEventListener('click', () => {
      const st = steps[Number(li.dataset.i)];
      if (!st?.points?.length) return;
      const cur = $('steps').querySelector('li.cur');
      if (cur) cur.classList.remove('cur');
      li.classList.add('cur');
      const o = fitOpts(); o.maxZoom = 17;
      map.fitBounds(L.latLngBounds(st.points).pad(.25), o);
      // Move the arrow here, facing the way this step leaves; a one-point step faces the end.
      if (originArrow) {
        pinLayer.removeLayer(originArrow);
        const hb = st.points.length > 1
          ? bearing(st.points[0], st.points[1])
          : (() => {
              const rp2 = routes[selected].pts;
              return rp2 && rp2.length > 1
                ? bearing(rp2[rp2.length - 2], rp2[rp2.length - 1]) : 0;
            })();
        originArrow = marker(st.points[0], 'origin', hb);
      }
      // Top of the map under the sticky bar; 'nearest' left the flag off the top of a phone.
      if (isPhone()) scrollToResult('mapBlock');
    });
  });
}

function renderUnavoidable() {
  const exp = selected === 'avoid' ? routes.avoidExp : routes.fastExp;
  if (selected !== 'avoid' || exp === 0) { $('unavoid').innerHTML = ''; return; }
  // From the steps, not the edges: the split edges are gone.
  const names = {};
  (routes.avoid.steps || []).forEach((st) => {
    if (st.cameras?.length) names[st.street || 'an unnamed road'] = 1;
  });
  $('unavoid').innerHTML = unavoidableHtml(exp, Object.keys(names));
}

// ---- Route panel wording ----
// Route data in, strings out; nothing here touches the map, the graph or the page.

function fmtMi(m) { return `${(m / METERS_PER_MILE).toFixed(1)} mi`; }
function fmtMin(s) { return `${Math.max(1, Math.round(s / 60))} min`; }
function plural(n) { return n > 1 ? 's' : ''; }

// Under 0.05 mi and half a minute is no saving: the display cannot show it. Decides both
// whether Fastest is offered and how its cost reads.
function noRealSaving(fast, avoid) {
  const dMi = (avoid.meters - fast.meters) / METERS_PER_MILE;
  const dMin = (avoid.seconds - fast.seconds) / 60;
  return dMi <= .05 && dMin <= .5;
}

// Same roads, or the same on every figure shown. Exposures are passed in because the
// fastest route was searched with cameras off, so its own cameraCount is always 0.
function sameRoute(a, b, aExp, bExp) {
  if (!a || !b) return false;
  if (a.edges.length === b.edges.length &&
      a.edges.every((e, i) => e === b.edges[i])) return true;
  return aExp === bExp &&
         Math.round(a.seconds) === Math.round(b.seconds) &&
         Math.round(a.meters) === Math.round(b.meters);
}

function camWord(n) {
  return n === 0 ? '<span class="cam-zero">no cameras</span>'
    : `<span class="cam-big">${n} camera${plural(n)}</span>`;
}

function turnGlyph(text) {
  if (/^Head/i.test(text)) return '↑';
  if (/sharp right/i.test(text)) return '↱';
  if (/sharp left/i.test(text)) return '↰';
  if (/turn right/i.test(text)) return '→';
  if (/turn left/i.test(text)) return '←';
  if (/bear right/i.test(text)) return '↗';
  if (/bear left/i.test(text)) return '↖';
  if (/u-turn/i.test(text)) return '↺';
  return '↑';
}

// router.js puts st.street verbatim into st.text, so one replace cases just the name.
function stepText(st) {
  if (!st.street) return st.text;
  const c = displayCase(st.street);
  return c === st.street ? st.text : st.text.replace(st.street, c);
}

function option(key, r, exp, saved, selected) {
  // Avoiding counts cameras dodged relative to Fastest; Fastest counts cameras passed. With
  // no camera-free route the search settles for fewest, so it says Passing, not Avoiding.
  let label;
  if (key === 'avoid') {
    label = exp > 0 ? `Passing ${exp} camera${plural(exp)}`
      : saved > 0 ? `Avoiding ${saved} camera${plural(saved)}`
      : 'No cameras';
  } else {
    label = exp === 0 ? 'No cameras'
      : `Traversing ${exp} camera${plural(exp)}`;
  }

  return `<button type="button" class="${key}${selected === key ? ' on' : ''}"` +
    ` data-key="${key}">` +
    `<span class="rt-top"><span class="sw ${key}"></span>${label}</span>` +
    `<span class="rt-sub">${fmtMi(r.meters)} · ${fmtMin(r.seconds)}</span>` +
    '</button>';
}

function cardsHtml(routes, selected) {
  const { fast, avoid } = routes;
  const dMi = (avoid.meters - fast.meters) / METERS_PER_MILE;
  const dMin = (avoid.seconds - fast.seconds) / 60;
  const saved = routes.avoidExp < routes.fastExp ? routes.fastExp - routes.avoidExp : 0;

  if (routes.identical) {
    const clean = routes.avoidExp === 0;
    const note = routes.fastDropped
      ? '<div class="verdict">Going through the cameras would not get you ' +
        'there any faster, so only this route is offered.</div>'
      : clean ? ''
      : '<div class="verdict">This is also the way that passes ' +
        'the fewest cameras.</div>';
    return `<div class="one-route"><b>${fmtMi(avoid.meters)}</b> · ` +
      `<b>${fmtMin(avoid.seconds)}</b>` +
      (clean ? '' : ` · ${camWord(routes.avoidExp)}`) + `</div>${note}`;
  }

  let html = '<div class="route-toggle">' +
    option('avoid', avoid, routes.avoidExp, saved, selected) +
    option('fast', fast, routes.fastExp, saved, selected) + '</div>';

  if (saved > 0 && selected === 'avoid') {
    let cost;
    if (noRealSaving(fast, avoid)) cost = 'costs you nothing';
    else {
      const parts = [];
      if (dMi > .05) parts.push(`${dMi.toFixed(1)} mi`);
      if (dMin > .5) parts.push(`${Math.round(dMin)} min`);
      cost = `costs an extra ${parts.join(' and ')}`;
    }
    html += `<div class="verdict">Going around them ${cost}.</div>`;
  }
  return html;
}

function stepsHtml(steps) {
  const items = steps.map((st, i) => {
    const dist = st.meters ? '<span class="sd">' +
      (st.meters < 160 ? `${Math.round(st.meters * 3.28084)} ft` : fmtMi(st.meters)) +
      '</span>' : '';
    const cam = st.cameras.length
      ? `<span class="scam">${st.cameras.length} camera${plural(st.cameras.length)}</span>`
      : '';
    return `<li data-i="${i}"${st.arrive ? ' class="arrive"' : ''}` +
      ' title="Show this part of the route on the map">' +
      (st.arrive ? '' : `<span class="glyph">${turnGlyph(st.text)}</span>`) +
      `<span class="stext">${esc(stepText(st))}</span>${dist}${cam}</li>`;
  });
  return `<ol class="steps">${items.join('')}</ol>`;
}

function unavoidableHtml(count, streets) {
  return '<div class="unavoid">There is no way to reach this destination ' +
    `without passing ${count} known camera${plural(count)}` +
    `, on ${esc(streets.join(', '))}. This route passes the fewest it can.</div>`;
}

function destPickerHtml(opts, chosenKind) {
  if (!opts || opts.length < 2) return '';
  const buttons = opts.map((o) => `<button type="button" data-kind="${o.kind}"` +
    `${o.kind === chosenKind ? ' class="on"' : ''}>${esc(o.label)}</button>`);
  return `<div class="seg">${buttons.join('')}</div>`;
}

// ---- Suggestion list ----
// The address box's suggestion widget; the page supplies suggest, onChoose and onMiss.

// The grey note on an inexact row, keyed by the kind Precincts.suggest assigns (voting.js).
const SUGGESTION_WHY = {
  inferred: 'estimated', quadrant: 'did you mean',
  near: 'nearest on this street'
};

const LIMIT = 8;
const DEBOUNCE_MS = 120;
// Long enough for a click on a row to land before the blur closes the list.
const BLUR_MS = 150;

function attachSuggestions(opts) {
  const input = opts.input;
  let items = [], index = -1, timer = null, box = null;

  function element() {
    if (!box) {
      box = document.createElement('div');
      // One list per input: debug.js attaches this to two more fields, and ids must stay unique.
      box.id = `ac-${input.id || 'x'}`;
      box.className = 'ac';
      box.hidden = true;
      box.setAttribute('role', 'listbox');
      input.parentNode.appendChild(box);
    }
    return box;
  }

  function close() { element().hidden = true; index = -1; }

  // Filled, not stroked: a 2px outline turns to a blob at 15px. evenodd keeps the hole open.
  const PIN_SVG =
    '<svg class="pin-glyph" viewBox="0 0 24 24" width="15" height="15" ' +
    'aria-hidden="true" fill="currentColor" fill-rule="evenodd">' +
    '<path d="M12 2c-3.87 0-7 3.13-7 7 0 5.25 6.3 12.3 6.57 12.6a.58.58 0 0 0 .86 0' +
    'C12.7 21.3 19 14.25 19 9c0-3.87-3.13-7-7-7z' +
    'M12 6.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z"/></svg>';

  function itemHtml(it, i) {
    const why = SUGGESTION_WHY[it.kind] || '';
    return `<button type="button" class="ac-item" role="option" data-i="${i}">` +
      `<span class="ac-pin">${PIN_SVG}</span>` +
      (it.number != null ? `<span class="num">${it.number}</span>` : '') +
      `<span class="st">${esc(displayCase(it.street))}</span>` +
      (why ? `<span class="why">${why}</span>` : '') +
      (it.where?.length
        ? `<span class="ac-where">${esc(it.where.join(' or '))}</span>`
        : '') + '</button>';
  }

  function refresh() {
    const text = input.value.trim();
    if (text.length < 2) { close(); return; }
    items = opts.suggest(text, LIMIT) || [];
    if (!items.length) { close(); return; }

    const el = element();
    el.innerHTML = items.map(itemHtml).join('');
    el.querySelectorAll('.ac-item').forEach((button) => {
      // mousedown, not click: the input's blur would otherwise close the
      // list before the click could land on it.
      button.addEventListener('mousedown', (e) => {
        e.preventDefault();
        swallowNextClick();
        opts.onChoose(items[Number(button.dataset.i)]);
      });
    });
    el.hidden = false;
    index = -1;
  }

  // On a phone the tap's click arrives after the answer is drawn and hits a place card.
  // Eat that one click; anything later is a real tap.
  function swallowNextClick() {
    const t = setTimeout(off, 700);
    function eat(e) { e.stopPropagation(); e.preventDefault(); off(); }
    function off() { document.removeEventListener('click', eat, true); clearTimeout(t); }
    document.addEventListener('click', eat, true);
  }

  function highlight(n) {
    const els = element().querySelectorAll('.ac-item');
    if (!els.length) return;
    if (index >= 0 && els[index]) els[index].classList.remove('active');
    index = (n + els.length) % els.length;
    els[index].classList.add('active');
    els[index].scrollIntoView({ block: 'nearest' });
  }

  // A best match marked choice is one of several, so Enter opens the list instead of guessing.
  function enter() {
    if (!element().hidden && index >= 0) { opts.onChoose(items[index]); return; }
    const text = input.value.trim();
    const best = opts.suggest(text, 1) || [];
    if (best.length && best[0].choice) { refresh(); return; }
    if (best.length) { opts.onChoose(best[0]); return; }
    opts.onMiss(text);
  }

  function onKey(e) {
    const open = !element().hidden;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) refresh();
      highlight(index + 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (open) highlight(index - 1);
    } else if (e.key === 'Escape') {
      close();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      enter();
    }
  }

  input.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(refresh, DEBOUNCE_MS);
  });
  input.addEventListener('keydown', onKey);
  input.addEventListener('blur', () => { setTimeout(close, BLUR_MS); });
  document.addEventListener('click', (e) => {
    if (!input.parentNode.contains(e.target)) close();
  });

  return { refresh, close };
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
