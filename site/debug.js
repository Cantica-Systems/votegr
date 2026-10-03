// The routing engine's debug panel. app.js imports it only when the URL has ?debug,
// and it reaches the engine only through the object passed to mount().
//
//   /?debug                                                the panel, empty
//   /?debug&from=602 Alexander St SE&to=355 48th St SE     filled and run
//   /?debug&from=42.9276,-85.6353&to=42.878,-85.6565       coordinates work too

import { displayCase } from './voting.js';

function $(id) { return document.getElementById(id); }
function param(name) {
  try { return new URLSearchParams(location.search).get(name) || ''; } catch (e) { return ''; }
}

// mile is the route panel's metersPerMile, so the dump and the panel agree on miles.
function summarise(r, mile) {
  if (!r) return null;
  return {
    meters: Math.round(r.meters), miles: +(r.meters / mile).toFixed(2),
    seconds: Math.round(r.seconds), minutes: +(r.seconds / 60).toFixed(1),
    edges: r.edges.length, nodes: r.nodes.length,
    cameraCount: r.cameraCount, cameras: r.cameras,
    camerasOnRoute: Object.keys(r.camsOnRoute || {}).length,
    steps: (r.steps || []).map((s) =>
      s.text + (s.meters ? ` (${Math.round(s.meters)} m)` : ''))
  };
}

// The same text choose() in app.js puts in the main search box.
function label(item) {
  if (!item) return '';
  const street = displayCase(item.street);
  return (item.number != null ? `${item.number} ` : '') + street;
}

function mount(api) {
  const bar = $('searchBar');
  if (!bar || $('debugPanel')) return;
  const panel = document.createElement('section');
  panel.id = 'debugPanel';
  panel.className = 'debug-panel';
  panel.innerHTML =
    '<div class="dbg-head">Routing engine debug ' +
    `<span class="dbg-sub">${api.graph.nodeCount()} nodes · ` +
    `${api.graph.edgeCount()} edges · ${(api.cameras || []).length} cameras</span></div>` +
    '<div class="dbg-row">' +
    '<label>From<input id="dbgFrom" placeholder="address, or lat,lng" spellcheck="false"></label>' +
    '<label>To<input id="dbgTo" placeholder="address, or lat,lng" spellcheck="false"></label>' +
    '</div>' +
    '<div class="dbg-row dbg-actions">' +
    '<button type="button" id="dbgRun">Route</button>' +
    '<button type="button" id="dbgSwap">Swap</button>' +
    '<button type="button" id="dbgLink">Copy link</button>' +
    '<span class="dbg-status" id="dbgStatus"></span>' +
    '</div>' +
    '<pre id="dbgOut" class="dbg-out" hidden></pre>';
  bar.insertAdjacentElement('afterend', panel);

  const from = $('dbgFrom'), to = $('dbgTo'), out = $('dbgOut'), status = $('dbgStatus');
  from.value = param('from');
  to.value = param('to');

  // The page's own address picker. It offers nothing for text without a house number, so
  // lat,lng pairs fall straight through to run().
  const pickers = [];
  if (typeof api.suggest === 'function') {
    [from, to].forEach((el) => {
      const ac = api.attachSuggestions({
        input: el,
        suggest: api.suggest,
        onChoose(item) {
          el.value = label(item);
          ac.close();
        },
        // Silent on purpose: the dump shows what resolve() made of the text.
        onMiss() {}
      });
      pickers.push(ac);
    });
  }

  function shareUrl() {
    const u = new URL(location.href);
    u.search = '';
    u.searchParams.set('debug', '');
    if (from.value.trim()) u.searchParams.set('from', from.value.trim());
    if (to.value.trim()) u.searchParams.set('to', to.value.trim());
    return u.toString().replace('debug=&', 'debug&').replace(/debug=$/, 'debug');
  }

  function run() {
    const report = { from: null, to: null, route: null };
    out.hidden = false;
    status.textContent = 'working…';
    try {
      report.from = api.resolve(from.value);
      report.to = api.resolve(to.value);
      if (report.from.error || report.to.error) {
        status.textContent = 'could not place one end';
      } else {
        const origin = { lat: report.from.lat, lng: report.from.lng };
        const place = { lat: report.to.lat, lng: report.to.lng,
                        name: 'Debug destination', address: to.value };
        const computed = api.computeRoutes(origin, place);
        if (!computed) {
          report.route = { error: 'no drivable route on this road network' };
          status.textContent = 'no route';
        } else {
          report.route = {
            ms: computed.ms,
            identical: computed.identical, fastDropped: computed.fastDropped,
            originNode: computed.originNode, destNode: computed.destNode,
            originSplit: computed.originSplit, destSplit: computed.destSplit,
            fastest: summarise(computed.fast, api.metersPerMile),
            avoiding: summarise(computed.avoid, api.metersPerMile)
          };
          status.textContent = `${computed.ms} ms`;
          api.draw(origin, place, computed);
        }
      }
    } catch (e) {
      report.error = String(e?.stack || e);
      status.textContent = 'threw';
    }
    out.textContent = JSON.stringify(report, null, 2);
    try { history.replaceState(null, '', shareUrl()); } catch (e) {}
  }

  $('dbgRun').onclick = run;
  $('dbgSwap').onclick = () => {
    [from.value, to.value] = [to.value, from.value];
    pickers.forEach((p) => p.close());
  };
  $('dbgLink').onclick = () => {
    const url = shareUrl();
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(url).then(() => {
        status.textContent = 'link copied';
      }, () => { status.textContent = url; });
    } else {
      status.textContent = url;
    }
  };
  // Deferred a tick: Enter on a highlighted suggestion must let onChoose fill the box first.
  [from, to].forEach((el) => {
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') setTimeout(run, 0);
    });
  });
  if (from.value && to.value) run();
  else from.focus();
}

export { mount };
