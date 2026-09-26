// Released into the public domain under the Unlicense, see UNLICENSE.
// Differential test: our fastest route vs OSRM (the OSM reference router)
// over the same origin/destination pairs.
//
//   node scripts/compare_osrm.mjs [tripCount]
//
// OSRM knows nothing about cameras, so only the FASTEST route is compared.
// The demo profile cannot exclude motorways, so trips where OSRM chose a
// freeway are classified separately: we refuse freeways by design, and that
// divergence is a product decision, not a defect.
//
// The interesting output is the DIVERGENT list. OSRM carries the complete
// OSM turn-restriction set; every place it detours where we do not is a
// candidate turn restriction our graph lacks.
//
// Etiquette: this queries the public OSRM demo server. Small samples, one
// request at a time, 2.5s apart, identified user agent. Keep N modest.
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { execFileSync } from 'child_process';
const require = createRequire(import.meta.url);
process.chdir(fileURLToPath(new URL('..', import.meta.url)));   // paths below are from the repo root
const R = require('../site/router.js');
const { pointInRings } = require('../site/precinct.js');
const fs = require('fs');

// The county network the page actually loads, built the way the page and
// tests/audit_routes.mjs build it: the index, then every chunk, then finish.
// Not site/data/graph.json, which is the city alone, from before the county
// widening, and is not the graph anybody is routed over.
const index = JSON.parse(fs.readFileSync('site/data/graph/index.json'));
const graph = R.Graph.streaming(index);
for (const chunk of index.chunks) {
  graph.addChunk(JSON.parse(fs.readFileSync(`site/data/graph/${chunk.mcd}.json`)));
}
graph.finish();
graph.assignCameras([]);
// Trips are still sampled inside the city limits: it is a sample, and the
// county graph contains the city. boundary.json stores [lng, lat]; the shared
// ray cast wants [lat, lng].
const cityRings = JSON.parse(fs.readFileSync('site/data/boundary.json'))
  .rings.map(ring => ring.map(p => [p[1], p[0]]));
const inside = (lat, lng) => pointInRings(lat, lng, cityRings);
const UA = 'vote-gr/1.0 (+https://github.com/Cantica-Systems/votegr)';

const sleep = ms => new Promise(r => setTimeout(r, ms));
function osrm(a, b) {
  const url = `https://router.project-osrm.org/route/v1/driving/` +
    `${a[1]},${a[0]};${b[1]},${b[0]}?overview=full&geometries=geojson&steps=true`;
  try {
    const out = execFileSync('curl', ['-s', '--max-time', '30', '-A', UA, url],
                             { encoding: 'utf8' });
    const d = JSON.parse(out);
    if (d.code !== 'Ok' || !d.routes || !d.routes.length) return null;
    const r = d.routes[0];
    return {
      meters: r.distance, seconds: r.duration,
      pts: r.geometry.coordinates.map(c => [c[1], c[0]]),
      streets: [...new Set(r.legs.flatMap(l => l.steps.map(s => s.name)).filter(Boolean))],
    };
  } catch { return null; }
}

// metres between points, equirectangular (fine at city scale)
function dm(a, b) {
  const kx = 111320 * Math.cos(a[0] * Math.PI / 180), ky = 110574;
  return Math.hypot((a[1] - b[1]) * kx, (a[0] - b[0]) * ky);
}
// fraction of pts within tol metres of the other polyline (point sampling)
function overlap(pts, other, tol) {
  if (!pts.length || !other.length) return 0;
  let hit = 0;
  for (const p of pts) {
    let best = Infinity;
    for (const q of other) { const d = dm(p, q); if (d < best) best = d; if (d < tol) break; }
    if (best < tol) hit++;
  }
  return hit / pts.length;
}
// does the OSRM geometry ride one of OUR freeway edges?
const fwyPts = [];
// The graph is packed into typed arrays, so edges are read through its
// accessors rather than as objects.
for (let i = 0; i < graph.edgeCount(); i++) {
  if (graph.edgeClass(i) === 1) graph.edgePoly(i).forEach(p => fwyPts.push(p));
}
function usedFreeway(pts) {
  let run = 0;
  for (const p of pts) {
    let near = false;
    for (const q of fwyPts) { if (dm(p, q) < 40) { near = true; break; } }
    run = near ? run + 1 : 0;
    if (run >= 3) return true;      // a sustained stretch, not a crossing
  }
  return false;
}

const N = Number(process.argv[2] || 30);
const results = [];
console.log(`comparing ${N} trips against OSRM, one request per 2.5s...`);
const trips = [];
while (trips.length < N) {
  const A = [42.90 + Math.random() * 0.13, -85.72 + Math.random() * 0.12];
  const B = [42.90 + Math.random() * 0.13, -85.72 + Math.random() * 0.12];
  if (!inside(A[0], A[1]) || !inside(B[0], B[1])) continue;
  if (dm(A, B) < 1500) continue;
  trips.push([A, B]);
}

for (let i = 0; i < trips.length; i++) {
  const [A, B] = trips[i];
  const a = graph.snapToRoad(A[0], A[1]), b = graph.snapToRoad(B[0], B[1]);
  const ours = graph.route(a.node, b.node);
  if (!ours) continue;
  const ourPts = [];
  ours.edges.forEach((id, k) => {
    const p = graph.edgePoly(id);          // a fresh array, so reversing is safe
    if (ours.nodes[k] !== graph.edgeA(id)) p.reverse();
    p.forEach(pt => ourPts.push(pt));
  });
  const theirs = osrm(graph.node(a.node), graph.node(b.node));
  await sleep(2500);
  if (!theirs) continue;
  const ovOurs = overlap(ourPts, theirs.pts, 60);
  const ovTheirs = overlap(theirs.pts, ourPts, 60);
  results.push({
    i, ourMi: ours.meters / 1609.34, osrmMi: theirs.meters / 1609.34,
    ourMin: ours.seconds / 60, osrmMin: theirs.seconds / 60,
    ov: Math.min(ovOurs, ovTheirs), fwy: usedFreeway(theirs.pts),
    ourStreets: [...new Set(graph.steps(ours).map(s => s.street).filter(Boolean))],
    osrmStreets: theirs.streets,
  });
  process.stdout.write('.');
}
console.log(`\n\n${results.length} comparable trips`);
const nonFwy = results.filter(r => !r.fwy), fwy = results.filter(r => r.fwy);
console.log(`OSRM chose a freeway on ${fwy.length} (excluded by our design; not compared further)`);
const avg = a => a.reduce((x, y) => x + y, 0) / (a.length || 1);
console.log(`\nsurface-street trips (${nonFwy.length}):`);
console.log(`  avg corridor overlap: ${(100 * avg(nonFwy.map(r => r.ov))).toFixed(0)}%`);
console.log(`  avg distance: ours ${avg(nonFwy.map(r => r.ourMi)).toFixed(2)} mi, OSRM ${avg(nonFwy.map(r => r.osrmMi)).toFixed(2)} mi`);
const close = nonFwy.filter(r => r.ov >= 0.7);
const div = nonFwy.filter(r => r.ov < 0.5);
console.log(`  agree (overlap >=70%): ${close.length}   partially: ${nonFwy.length - close.length - div.length}   divergent (<50%): ${div.length}`);
for (const d of div.slice(0, 6)) {
  console.log(`\n  DIVERGENT trip ${d.i}: ours ${d.ourMi.toFixed(2)}mi/${d.ourMin.toFixed(0)}min vs OSRM ${d.osrmMi.toFixed(2)}mi/${d.osrmMin.toFixed(0)}min (overlap ${(100 * d.ov).toFixed(0)}%)`);
  console.log(`    ours: ${d.ourStreets.slice(0, 7).join(' > ')}`);
  console.log(`    OSRM: ${d.osrmStreets.slice(0, 7).join(' > ')}`);
}
// build/ is gitignored, so a fresh clone does not have it.
fs.mkdirSync('build', { recursive: true });
fs.writeFileSync('build/osrm_comparison.json', JSON.stringify(results, null, 1));
console.log('\nfull results -> build/osrm_comparison.json');
