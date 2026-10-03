// Client-side route planner that avoids ALPR cameras. Runs in the browser and
// under node (tests and scripts).

// Route cost = cameras passed * CAMERA_PENALTY + seconds. The penalty outweighs
// any trip time, so a camera-free route always wins where one exists, and
// otherwise the same search returns the route past the fewest cameras.
const CAMERA_PENALTY = 1e9;      // seconds-equivalent per camera passed
const UTURN_PENALTY = 90;        // seconds; discourages, does not forbid
const STANDOFF_M = 50;           // a camera "watches" edges within this radius
const MAX_SPEED = 31.3;          // ~70mph in m/s, the A* heuristic's bound

// Turn costs in seconds. Without them routes zigzag across the street grid; a
// left costs more than a right because it waits for oncoming traffic.
const TURN_STRAIGHT_DEG = 25;
const TURN_COST_RIGHT = 6;
const TURN_COST_LEFT = 12;
const TURN_COST_SHARP = 25;

function turnCost(fromBearing, toBearing) {
  const d = ((toBearing - fromBearing + 540) % 360) - 180;
  const a = Math.abs(d);
  if (a < TURN_STRAIGHT_DEG) return 0;
  if (a > 150) return TURN_COST_SHARP;
  return d > 0 ? TURN_COST_RIGHT : TURN_COST_LEFT;
}

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000, toR = Math.PI / 180;
  const dLat = (lat2 - lat1) * toR, dLng = (lng2 - lng1) * toR;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * toR) * Math.cos(lat2 * toR) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Coordinates are packed into typed arrays as Int32 microdegrees (1e-6 degree
// is about 11 cm): the county takes 12.9 MiB packed against 69.7 MiB as objects.
const MICRO = 1e6;

// Snap grid cell in degrees (~550 m of latitude), measured on the county: 0.75 ms
// per snap; 0.0025 snaps faster but takes 340 ms to build.
const SNAP_CELL = 0.005;

// Snapping penalizes alleys rather than excluding them: some addresses touch
// only an alley.
const ALLEY = /\bALY\b|\bALLEY\b/;

// ---- Graph ----

// Built from a whole-city document (nodes and edges as dense arrays), a chunk
// from build_graph_chunks.py (maps keyed by the county-wide ids build_graph.py
// assigns), or an array of chunks. Ids are compacted to dense indexes once, on
// the way in, so the adjacency, splitAt and the A* only ever index dense arrays.
class Graph {
  constructor(data) {
    const docs = Array.isArray(data) ? data : [data];
    if (!docs.length) throw new Error('Graph: nothing to build from');

    if (isChunk(docs[0])) {
      this._beginPack(totalsOf(docs));
      for (const chunk of docs) this.addChunk(chunk);
      this.finish();
      return;
    }

    if (docs.length > 1) throw new Error('Graph: only chunks can be merged');
    const doc = docs[0];
    this._pack(doc.nodes, doc.edges);
    this._buildAdjacency();
    this._indexRestrictions(doc.restrictions || []);
  }

  // ---- Streaming construction ----

  // Graph.streaming(index), then addChunk() per chunk, then finish(). Arrays are
  // sized once from data/graph/index.json so only one parsed chunk is alive at a
  // time; holding all thirty peaked at 102 MiB, too much for older phones. The
  // 150 m overlap between chunks makes the totals ~14% high, under 2 MiB, which
  // is cheaper than a counting pass.
  static streaming(index) {
    const g = Object.create(Graph.prototype);
    g._beginPack(totalsOf(index));
    return g;
  }

  _beginPack(totals) {
    const { nodes, edges, points } = totals;
    this._nodeCount = 0;
    this._edgeCount = 0;
    this._pointAt = 0;
    this._nodeXY = new Int32Array(nodes * 2);
    this._eA = new Int32Array(edges);
    this._eB = new Int32Array(edges);
    this._eLen = new Float32Array(edges);
    this._eSec = new Float32Array(edges);
    this._eDir = new Uint8Array(edges);
    this._eCls = new Uint8Array(edges);
    this._eName = new Array(edges);
    // Four house-number slots per edge (left from/to, right from/to); -1 means
    // no range on that side, which is not the same as 0.
    this._eRange = new Int32Array(edges * 4);
    this._pOff = new Uint32Array(edges + 1);
    this._pXY = new Int32Array(points * 2);
    // Global id -> dense index. Kept after finish() because the tests map wire
    // ids back to points.
    this.nodeId = {};
    this.edgeId = {};
    this._pendingRestrictions = [];
    this._build = totals.build || null;
    // splitAt's temporary nodes and half-edges, as plain objects indexed past
    // the packed arrays. Every accessor falls through to them.
    this._extraNodes = [];
    this._extraEdges = [];
  }

  addChunk(doc) {
    if (!isChunk(doc)) throw new Error('Graph.addChunk: not a chunk document');
    const meta = doc.meta || {};

    // Ids only mean the same road within one build: merging chunks from two
    // builds would silently splice unrelated streets together.
    if (this._build === null) this._build = meta.build || null;
    else if ((meta.build || null) !== this._build) {
      throw new Error(`Graph: chunk ${meta.mcd || '?'} is from build ` +
                      `${meta.build}, expected ${this._build}`);
    }

    for (const id in doc.nodes) {
      if (!Object.hasOwn(doc.nodes, id)) continue;
      // Border nodes arrive in two chunks; the second sighting is the same node.
      if (this.nodeId[id] !== undefined) continue;
      const at = this._nodeCount++;
      if (at * 2 + 1 >= this._nodeXY.length) {
        throw new Error('Graph: more nodes than the index reserved');
      }
      this.nodeId[id] = at;
      this._nodeXY[at * 2] = Math.round(doc.nodes[id][0] * MICRO);
      this._nodeXY[at * 2 + 1] = Math.round(doc.nodes[id][1] * MICRO);
    }

    for (const id in doc.edges) {
      if (!Object.hasOwn(doc.edges, id)) continue;
      if (this.edgeId[id] !== undefined) continue;    // shared border segment
      const e = doc.edges[id];
      const a = this.nodeId[e.a], b = this.nodeId[e.b];
      // An endpoint outside the chunk: the edge cannot be wired, so drop it.
      if (a === undefined || b === undefined) continue;
      const ei = this._edgeCount++;
      if (ei >= this._eA.length) {
        throw new Error('Graph: more edges than the index reserved');
      }
      this.edgeId[id] = ei;
      this._putEdge(ei, a, b, e);
    }

    // Resolved in finish(): a restriction can name an edge from a later chunk.
    const list = doc.restrictions || [];
    for (const r of list) this._pendingRestrictions.push(r);
    return this;
  }

  finish() {
    this._pOff[this._edgeCount] = this._pointAt;

    const resolved = [];
    for (const r of this._pendingRestrictions) {
      const f = this.edgeId[r.f], v = this.nodeId[r.v], t = this.edgeId[r.t];
      if (f === undefined || v === undefined || t === undefined) continue;
      resolved.push({ f, v, t, no: r.no });
    }
    this._pendingRestrictions = null;

    this._buildAdjacency();
    this._indexRestrictions(resolved);
    return this;
  }

  // The whole-city document: data/graph.json still ships in this shape, and the
  // tests build small graphs by hand in it. Ids are array positions.
  _pack(nodes, edges) {
    let i, points = 0;
    for (i = 0; i < edges.length; i++) points += edges[i].p.length;
    this._beginPack({ nodes: nodes.length, edges: edges.length,
                      points, build: null });
    this.nodeId = null;
    this.edgeId = null;
    for (i = 0; i < nodes.length; i++) {
      this._nodeXY[i * 2] = Math.round(nodes[i][0] * MICRO);
      this._nodeXY[i * 2 + 1] = Math.round(nodes[i][1] * MICRO);
    }
    this._nodeCount = nodes.length;
    for (i = 0; i < edges.length; i++) this._putEdge(i, edges[i].a, edges[i].b, edges[i]);
    this._edgeCount = edges.length;
    this._pOff[this._edgeCount] = this._pointAt;
    this._pendingRestrictions = null;
  }

  // Edge wire format, from build_graph.py: a, b node ids; l metres; t seconds;
  // d 0 two-way, 1 a->b only, 2 b->a only; c road class (1 is freeway); n name;
  // r house-number ranges; p polyline as [[lat, lng], ...]. Nodes are [lat, lng].
  _putEdge(ei, a, b, e) {
    const r = e.r || [];
    this._eA[ei] = a; this._eB[ei] = b;
    this._eLen[ei] = e.l; this._eSec[ei] = e.t;
    this._eDir[ei] = e.d; this._eCls[ei] = e.c || 5;
    this._eName[ei] = e.n || '';
    for (let j = 0; j < 4; j++) {
      this._eRange[ei * 4 + j] = r[j] ?? -1;
    }
    this._pOff[ei] = this._pointAt;
    for (let j = 0; j < e.p.length; j++) {
      if (this._pointAt * 2 + 1 >= this._pXY.length) {
        throw new Error('Graph: more polyline points than the index reserved');
      }
      this._pXY[this._pointAt * 2] = Math.round(e.p[j][0] * MICRO);
      this._pXY[this._pointAt * 2 + 1] = Math.round(e.p[j][1] * MICRO);
      this._pointAt++;
    }
  }

  // ---- Accessors ----

  nodeCount() {
    return this._nodeCount + this._extraNodes.length;
  }

  edgeCount() {
    return this._edgeCount + this._extraEdges.length;
  }

  nodeLat(i) {
    return i < this._nodeCount ? this._nodeXY[i * 2] / MICRO
                               : this._extraNodes[i - this._nodeCount][0];
  }

  nodeLng(i) {
    return i < this._nodeCount ? this._nodeXY[i * 2 + 1] / MICRO
                               : this._extraNodes[i - this._nodeCount][1];
  }

  // Allocates; in a loop over the graph, use nodeLat/nodeLng.
  node(i) {
    return [this.nodeLat(i), this.nodeLng(i)];
  }

  edgeA(i) {
    return i < this._edgeCount ? this._eA[i] : this._extraEdges[i - this._edgeCount].a;
  }

  edgeB(i) {
    return i < this._edgeCount ? this._eB[i] : this._extraEdges[i - this._edgeCount].b;
  }

  edgeLen(i) {
    return i < this._edgeCount ? this._eLen[i] : this._extraEdges[i - this._edgeCount].l;
  }

  edgeSec(i) {
    return i < this._edgeCount ? this._eSec[i] : this._extraEdges[i - this._edgeCount].t;
  }

  edgeDir(i) {
    return i < this._edgeCount ? this._eDir[i] : this._extraEdges[i - this._edgeCount].d;
  }

  edgeClass(i) {
    return i < this._edgeCount ? this._eCls[i] : this._extraEdges[i - this._edgeCount].c;
  }

  edgeName(i) {
    return i < this._edgeCount ? this._eName[i] : this._extraEdges[i - this._edgeCount].n;
  }

  // slot: 0 left from, 1 left to, 2 right from, 3 right to. null for no range.
  edgeRange(i, slot) {
    if (i >= this._edgeCount) {
      const r = this._extraEdges[i - this._edgeCount].r || [];
      return r[slot] ?? null;
    }
    const v = this._eRange[i * 4 + slot];
    return v === -1 ? null : v;
  }

  edgePointCount(i) {
    return i < this._edgeCount ? this._pOff[i + 1] - this._pOff[i]
                               : this._extraEdges[i - this._edgeCount].p.length;
  }

  edgePointLat(i, k) {
    return i < this._edgeCount ? this._pXY[(this._pOff[i] + k) * 2] / MICRO
                               : this._extraEdges[i - this._edgeCount].p[k][0];
  }

  edgePointLng(i, k) {
    return i < this._edgeCount ? this._pXY[(this._pOff[i] + k) * 2 + 1] / MICRO
                               : this._extraEdges[i - this._edgeCount].p[k][1];
  }

  // [[lat, lng], ...]. Allocates the polyline, so not for scanning.
  edgePoly(i) {
    const n = this.edgePointCount(i), out = new Array(n);
    for (let k = 0; k < n; k++) {
      out[k] = [this.edgePointLat(i, k), this.edgePointLng(i, k)];
    }
    return out;
  }

  // Restrictions from build_restrictions.py: f from edge, v via node, t to edge;
  // no is true for a no_ turn and false for an only_ turn.
  _indexRestrictions(list) {
    const idx = {};
    for (const r of list) {
      const k = `${r.f}|${r.v}`;
      const slot = (idx[k] ||= { no: null, only: null });
      if (r.no) (slot.no ||= {})[r.t] = 1;
      else (slot.only ||= {})[r.t] = 1;
    }
    this._restr = idx;
    this.restrictionCount = list.length;
  }

  turnAllowed(fromEdge, node, toEdge) {
    if (fromEdge == null) return true;          // start of the route
    // U-turns stay legal (the only way out of a dead end) at UTURN_PENALTY.
    if (fromEdge === toEdge) return true;
    const slot = this._restr?.[`${fromEdge}|${node}`];
    if (!slot) return true;
    if (slot.no && slot.no[toEdge]) return false;
    if (slot.only && !slot.only[toEdge]) return false;
    return true;
  }

  // Directed adjacency in compressed sparse row form, with each link's leaving
  // and arriving bearings for the turn cost. Cameras are priced at search time,
  // so a new camera set needs no rebuild. Freeways (class 1) are left out on
  // purpose: voting trips are local, and the camera data covers surface streets.
  _buildAdjacency() {
    const n = this._nodeCount, m = this._edgeCount;

    const counts = new Uint32Array(n);
    for (let ei = 0; ei < m; ei++) {
      if (this._eCls[ei] === 1) continue;
      if (this._pOff[ei + 1] - this._pOff[ei] < 2) continue;
      const d = this._eDir[ei];
      if (d === 0 || d === 1) counts[this._eA[ei]]++;
      if (d === 0 || d === 2) counts[this._eB[ei]]++;
    }
    const off = new Uint32Array(n + 1);
    let run = 0;
    for (let i = 0; i < n; i++) { off[i] = run; run += counts[i]; }
    off[n] = run;

    this._adjOff = off;
    this._adjTo = new Int32Array(run);
    this._adjEdge = new Int32Array(run);
    this._adjDep = new Float32Array(run);
    this._adjArr = new Float32Array(run);
    this._extraLinks = {};        // node -> [{to, edge, depB, arrB}]
    this._hidden = [];            // edges splitAt has taken out of service

    const fill = off.slice();
    for (let ei = 0; ei < m; ei++) {
      if (this._eCls[ei] === 1) continue;
      const pts = this._pOff[ei + 1] - this._pOff[ei];
      if (pts < 2) continue;
      const fB = this._segBearing(ei, 0, 1);
      const lB = this._segBearing(ei, pts - 2, pts - 1);
      const dir = this._eDir[ei];
      if (dir === 0 || dir === 1) {
        const a = fill[this._eA[ei]]++;
        this._adjTo[a] = this._eB[ei]; this._adjEdge[a] = ei;
        this._adjDep[a] = fB; this._adjArr[a] = lB;
      }
      if (dir === 0 || dir === 2) {
        const b = fill[this._eB[ei]]++;
        this._adjTo[b] = this._eA[ei]; this._adjEdge[b] = ei;
        this._adjDep[b] = (lB + 180) % 360; this._adjArr[b] = (fB + 180) % 360;
      }
    }
  }

  _segBearing(ei, j, k) {
    return bearing([this.edgePointLat(ei, j), this.edgePointLng(ei, j)],
                   [this.edgePointLat(ei, k), this.edgePointLng(ei, k)]);
  }

  // Refills and returns `into`, a scratch array reused on every expansion.
  linksFrom(node, into) {
    const out = into || [];
    out.length = 0;
    if (node < this._nodeCount) {
      const lo = this._adjOff[node], hi = this._adjOff[node + 1];
      for (let i = lo; i < hi; i++) {
        if (this._isHidden(this._adjEdge[i])) continue;
        out.push({ to: this._adjTo[i], edge: this._adjEdge[i],
                   depB: this._adjDep[i], arrB: this._adjArr[i] });
      }
    }
    // A second split on one street hides the first split's half, which is here.
    const extra = this._extraLinks[node];
    if (extra) {
      for (let j = 0; j < extra.length; j++) {
        if (!this._isHidden(extra[j].edge)) out.push(extra[j]);
      }
    }
    return out;
  }

  // At most two entries, one per split, so a scan beats any structure.
  _isHidden(ei) {
    for (let k = 0; k < this._hidden.length; k++) {
      if (this._hidden[k] === ei) return true;
    }
    return false;
  }

  _linkExtraEdge(ei) {
    const e = this._extraEdges[ei - this._edgeCount];
    if (e.c === 1 || e.p.length < 2) return;
    const fB = bearing(e.p[0], e.p[1]);
    const lB = bearing(e.p[e.p.length - 2], e.p[e.p.length - 1]);
    const add = (node, link) => {
      (this._extraLinks[node] ||= []).push(link);
    };
    if (e.d === 0 || e.d === 1) {
      add(e.a, { to: e.b, edge: ei, depB: fB, arrB: lB });
    }
    if (e.d === 0 || e.d === 2) {
      add(e.b, { to: e.a, edge: ei,
                 depB: (lB + 180) % 360, arrB: (fB + 180) % 360 });
    }
  }

  // ---- Cameras ----

  // Also works out where each camera is drawn (cameraPos) in the same pass.
  assignCameras(cameras) {
    const CELL = 0.005; // degrees, ~500 m of latitude; broad phase only
    const grid = {};
    const key = (la, ln) => `${Math.round(la / CELL)}:${Math.round(ln / CELL)}`;
    const edgeTotal = this.edgeCount();
    for (let ei = 0; ei < edgeTotal; ei++) {
      const pts = this.edgePointCount(ei), seen = {};
      for (let k = 0; k < pts; k++) {
        const kk = key(this.edgePointLat(ei, k), this.edgePointLng(ei, k));
        if (!seen[kk]) { seen[kk] = 1; (grid[kk] ||= []).push(ei); }
      }
    }
    this._edgeCams = [];
    for (let z = 0; z < edgeTotal; z++) this._edgeCams.push(null);
    this._camSnap = {};

    for (const cam of cameras) {
      const candidates = {};
      for (let dla = -1; dla <= 1; dla++) {
        for (let dln = -1; dln <= 1; dln++) {
          const cell = `${Math.round(cam.lat / CELL) + dla}:${Math.round(cam.lng / CELL) + dln}`;
          const list = grid[cell];
          if (!list) continue;
          for (const ei of list) candidates[ei] = 1;
        }
      }
      // Watching (routing) is purely distance-based. The drawn position also
      // prefers the road aligned with a declared facing and steps along it, so
      // cameras at one intersection do not pile onto one point. The facing is
      // read exactly as bearing() in map.js reads it for the cone.
      const faceRaw = cam.f && (cam.f.direction ?? cam.f['camera:direction']);
      const face = (faceRaw != null && faceRaw !== '' && !isNaN(parseFloat(faceRaw)))
        ? parseFloat(faceRaw) : null;
      let bestSnap = null;
      for (const eid in candidates) {
        const id = +eid;
        const np = this.edgePointCount(id);
        let near = null, nearA = null, nearB = null;
        for (let sg = 0; sg < np - 1; sg++) {
          const segA = [this.edgePointLat(id, sg), this.edgePointLng(id, sg)];
          const segB2 = [this.edgePointLat(id, sg + 1), this.edgePointLng(id, sg + 1)];
          const pr = projectOnSeg(cam.lat, cam.lng, segA, segB2);
          if (!near || pr.d < near.d) { near = pr; nearA = segA; nearB = segB2; }
        }
        if (!near) continue;
        if (near.d <= STANDOFF_M) {
          (this._edgeCams[eid] ||= []).push(cam.id);
        }
        // Misalignment of 0 to 90 degrees, priced in metres: a road at right
        // angles to the facing costs ~30 m.
        let score = near.d;
        if (face != null) {
          const segB = bearing(nearA, nearB);
          let diff = Math.abs(((segB - face) % 180 + 180) % 180);
          if (diff > 90) diff = 180 - diff;
          score += diff * 0.35;
        }
        if (!bestSnap || score < bestSnap.score) {
          bestSnap = { pt: near, score, d: near.d, A: nearA, B: nearB };
        }
      }
      let snap = null;
      if (bestSnap && bestSnap.d <= STANDOFF_M) {
        snap = [bestSnap.pt.lat, bestSnap.pt.lng];
        if (face != null) {
          // Up to 12 m along the segment toward the facing.
          const segBrg = bearing(bestSnap.A, bestSnap.B);
          let d1 = Math.abs(((segBrg - face) % 360 + 360) % 360);
          if (d1 > 180) d1 = 360 - d1;
          const sign = d1 <= 90 ? 1 : -1;
          const target = sign > 0 ? bestSnap.B : bestSnap.A;
          const room = haversine(snap[0], snap[1], target[0], target[1]);
          const step = Math.min(12, room);
          if (room > 0.5) {
            const t = step / room;
            snap = [snap[0] + (target[0] - snap[0]) * t,
                    snap[1] + (target[1] - snap[1]) * t];
          }
        }
      }
      this._camSnap[cam.id] = snap || [cam.lat, cam.lng];
    }
    return this._edgeCams;
  }

  // Metres from a point to an edge, read through two scratch pairs: calling
  // edgePoly() here was the page's largest allocation.
  _distToEdge(lat, lng, ei) {
    const n = this.edgePointCount(ei);
    if (n === 0) return Infinity;
    const A = (this._segA ||= [0, 0]);
    const B = (this._segB ||= [0, 0]);
    A[0] = this.edgePointLat(ei, 0); A[1] = this.edgePointLng(ei, 0);
    if (n === 1) return haversine(lat, lng, A[0], A[1]);
    let best = Infinity;
    for (let i = 0; i < n - 1; i++) {
      B[0] = this.edgePointLat(ei, i + 1); B[1] = this.edgePointLng(ei, i + 1);
      const d = projectOnSeg(lat, lng, A, B).d;
      if (d < best) best = d;
      A[0] = B[0]; A[1] = B[1];
    }
    return best;
  }

  // ---- Routing ----

  // A* between two nodes: null if unreachable, else {edges, nodes, seconds,
  // meters, cameras, cameraCount}. The search state is (node, edge arrived on),
  // because whether a turn is legal depends on how you got there.
  route(srcId, dstId) {
    const dstLat = this.nodeLat(dstId), dstLng = this.nodeLng(dstId);
    const h = (nid) =>
      haversine(this.nodeLat(nid), this.nodeLng(nid), dstLat, dstLng) / MAX_SPEED;
    const scratch = [];
    const g = {}, cam = {}, prev = {}, closed = {};
    const key = (n, e) => `${n}|${e ?? '-'}`;

    const startKey = key(srcId, null);
    g[startKey] = 0; cam[startKey] = 0;
    const open = new Heap();
    open.push({ node: srcId, edge: null, k: startKey, arrB: null, f: h(srcId) });
    let endKey = null;

    while (open.size()) {
      const cur = open.pop();
      if (closed[cur.k]) continue;
      closed[cur.k] = 1;
      if (cur.node === dstId) { endKey = cur.k; break; }

      const outs = this.linksFrom(cur.node, scratch);
      for (let i = 0; i < outs.length; i++) {
        const ev = outs[i];
        if (!this.turnAllowed(cur.edge, cur.node, ev.edge)) continue;
        const passCams = this._edgeCams ? this._edgeCams[ev.edge] : null;
        const addCam = passCams ? passCams.length : 0;
        const nk = key(ev.to, ev.edge);
        const ng = g[cur.k] + this.edgeSec(ev.edge) +
                 (ev.edge === cur.edge ? UTURN_PENALTY : 0) +
                 (cur.arrB == null ? 0 : turnCost(cur.arrB, ev.depB));
        const nc = cam[cur.k] + addCam;
        const cost = nc * CAMERA_PENALTY + ng;
        const known = (g[nk] === undefined) ? Infinity
          : cam[nk] * CAMERA_PENALTY + g[nk];
        if (cost < known) {
          g[nk] = ng; cam[nk] = nc;
          prev[nk] = { k: cur.k, edge: ev.edge, node: cur.node };
          open.push({ node: ev.to, edge: ev.edge, k: nk, arrB: ev.arrB,
                      f: cost + h(ev.to) });
        }
      }
    }

    if (endKey === null) return null;

    const eids = [], nids = [], camSet = {}, camList = [];
    let k = endKey, curNode = dstId;
    nids.push(curNode);
    while (k !== startKey) {
      const p = prev[k];
      eids.push(p.edge);
      const pc = this._edgeCams ? this._edgeCams[p.edge] : null;
      if (pc) for (const c of pc) {
        if (!camSet[c]) { camSet[c] = 1; camList.push(c); }
      }
      curNode = p.node;
      nids.push(curNode);
      k = p.k;
    }
    eids.reverse(); nids.reverse();
    return {
      edges: eids, nodes: nids,
      seconds: g[endKey], meters: eids.reduce((s, id) => s + this.edgeLen(id), 0),
      cameras: camList, cameraCount: cam[endKey]
    };
  }

  // ---- Snapping ----

  // Splits the nearest street at the point closest to (lat, lng) with a
  // temporary node, so a route starts mid-block rather than at a corner. Call
  // release() after the lookup; after two splits, release the second first.
  splitAt(lat, lng) {
    const snap = this.snapToRoad(lat, lng);
    if (snap?.edge == null) return null;

    const parent = snap.edge;
    const poly = this.edgePoly(parent);
    const eA = this.edgeA(parent), eB = this.edgeB(parent);

    let best = { i: 0, t: 0, d: Infinity };
    for (let i = 0; i < poly.length - 1; i++) {
      const pr = projectOnSeg(lat, lng, poly[i], poly[i + 1]);
      if (pr.d < best.d) best = { i, t: pr.t, d: pr.d, lat: pr.lat, lng: pr.lng };
    }
    if (best.d === Infinity) return null;

    // Within 8 m of an end, use the real node.
    const head = poly.slice(0, best.i + 1).concat([[best.lat, best.lng]]);
    const tail = [[best.lat, best.lng]].concat(poly.slice(best.i + 1));
    const headLen = polyLength(head), tailLen = polyLength(tail);
    if (headLen < 8) return { node: eA, lat: poly[0][0], lng: poly[0][1],
                              release() {} };
    if (tailLen < 8) return { node: eB, lat: poly[poly.length - 1][0],
                              lng: poly[poly.length - 1][1], release() {} };

    const extraNodes = this._extraNodes.length, extraEdges = this._extraEdges.length;
    const mid = this._nodeCount + extraNodes;
    this._extraNodes.push([best.lat, best.lng]);

    // The halves take proportional shares of the parent's length and time, not
    // values recomputed from geometry, so they always sum to the parent's.
    const total = headLen + tailLen;
    const frac = total > 0 ? headLen / total : 0.5;
    const self = this;
    const pLen = this.edgeLen(parent), pSec = this.edgeSec(parent);
    const pDir = this.edgeDir(parent), pCls = this.edgeClass(parent);
    const pName = this.edgeName(parent);
    const pRange = [this.edgeRange(parent, 0), this.edgeRange(parent, 1),
                    this.edgeRange(parent, 2), this.edgeRange(parent, 3)];
    function piece(a, b, pts, lenShare, secShare) {
      return { a, b, d: pDir, c: pCls, l: Math.round(lenShare * 10) / 10,
               t: Math.round(secShare * 10) / 10, n: pName, r: pRange, p: pts };
    }
    const eHead = this._edgeCount + this._extraEdges.length;
    this._extraEdges.push(piece(eA, mid, head, pLen * frac, pSec * frac));
    const eTail = this._edgeCount + this._extraEdges.length;
    this._extraEdges.push(piece(mid, eB, tail, pLen * (1 - frac), pSec * (1 - frac)));

    if (this._edgeCams) {
      const parentCams = this._edgeCams[parent] || null;
      this._edgeCams[eHead] = parentCams ? parentCams.slice() : null;
      this._edgeCams[eTail] = parentCams ? parentCams.slice() : null;
    }

    // Hide the parent so no route bypasses the split. The parent can be an
    // earlier split's half when both ends of a trip are on one street.
    this._hidden.push(parent);
    this._linkExtraEdge(eHead);
    this._linkExtraEdge(eTail);

    const keep = this._edgeCount + extraEdges;
    return {
      node: mid, lat: best.lat, lng: best.lng, meters: best.d,
      release() {
        self._extraNodes.length = extraNodes;
        self._extraEdges.length = extraEdges;
        const at = self._hidden.indexOf(parent);
        if (at >= 0) self._hidden.splice(at, 1);
        // Drop only this split's links: an end can be an earlier split's
        // midpoint, whose own links are still live.
        [eA, eB, mid].forEach((n) => {
          let links = self._extraLinks[n];
          if (!links) return;
          links = links.filter((l) => l.edge < keep);
          if (links.length) self._extraLinks[n] = links;
          else delete self._extraLinks[n];
        });
        if (self._edgeCams) self._edgeCams.length = keep;
      }
    };
  }

  _snapGrid() {
    if (this._grid) return this._grid;
    const cells = {}, order = [], counts = [];
    let i;
    // Every cell under each segment's bounding box, not only the cells holding
    // vertices: a long rural segment can cross a cell with no vertex in it, and
    // points there used to snap to a farther road.
    const cellsOf = (ei, visit) => {
      const n = this.edgePointCount(ei), seen = {};
      let la1 = Math.round(this.edgePointLat(ei, 0) / SNAP_CELL);
      let ln1 = Math.round(this.edgePointLng(ei, 0) / SNAP_CELL);
      const mark = (la, ln) => {
        const key = `${la}:${ln}`;
        if (seen[key]) return;
        seen[key] = 1;
        visit(key);
      };
      if (n === 1) { mark(la1, ln1); return; }
      for (let q = 1; q < n; q++) {
        const la2 = Math.round(this.edgePointLat(ei, q) / SNAP_CELL);
        const ln2 = Math.round(this.edgePointLng(ei, q) / SNAP_CELL);
        const laLo = Math.min(la1, la2), laHi = Math.max(la1, la2);
        const lnLo = Math.min(ln1, ln2), lnHi = Math.max(ln1, ln2);
        for (let la = laLo; la <= laHi; la++) {
          for (let ln = lnLo; ln <= lnHi; ln++) mark(la, ln);
        }
        la1 = la2; ln1 = ln2;
      }
    };
    for (i = 0; i < this._edgeCount; i++) {
      if (this._eCls[i] === 1) continue;          // freeways are never snapped to
      cellsOf(i, (key) => {
        let at = cells[key];
        if (at === undefined) { at = cells[key] = order.length; order.push(key); counts.push(0); }
        counts[at]++;
      });
    }
    const off = new Uint32Array(order.length + 1);
    let run = 0;
    for (i = 0; i < order.length; i++) { off[i] = run; run += counts[i]; }
    off[order.length] = run;
    const ids = new Int32Array(run), fill = off.slice();
    for (i = 0; i < this._edgeCount; i++) {
      if (this._eCls[i] === 1) continue;
      cellsOf(i, (key) => { ids[fill[cells[key]]++] = i; });
    }
    // The grid's extent tells snapToRoad when every occupied cell is covered.
    let laLo = Infinity, laHi = -Infinity, lnLo = Infinity, lnHi = -Infinity;
    for (i = 0; i < order.length; i++) {
      const parts = order[i].split(':');
      const la = +parts[0], ln = +parts[1];
      if (la < laLo) laLo = la; if (la > laHi) laHi = la;
      if (ln < lnLo) lnLo = ln; if (ln > lnHi) lnHi = ln;
    }
    this._grid = { cell: cells, off, ids, laLo, laHi, lnLo, lnHi };
    return this._grid;
  }

  // Builds the lazy indexes at load: a few hundred ms on a phone, which would
  // otherwise stall the first lookup.
  warm() {
    this._streetIndex();
    this._snapGrid();
    return this;
  }

  // Nearest edge to the point, and the end of it a route can start from. The
  // nearest node alone could be an alley mouth.
  snapToRoad(lat, lng) {
    let bestEdge = -1, bestD = Infinity;
    const grid = this._snapGrid();
    const la = Math.round(lat / SNAP_CELL), ln = Math.round(lng / SNAP_CELL);
    const seen = {};
    const consider = (self, ei) => {
      if (seen[ei] || self._isHidden(ei)) return;
      seen[ei] = 1;
      let d = self._distToEdge(lat, lng, ei);
      if (ALLEY.test(self.edgeName(ei))) d += 120;   // metres of penalty
      if (d < bestD) { bestD = d; bestEdge = ei; }
    };
    // Do not stop at the first hit: ring r is only complete out to r - 0.5
    // cells, so widen until the best distance is inside that or the grid is
    // covered. The answer then matches a scan of every edge.
    const cellM = SNAP_CELL * 111320 * Math.cos(lat * Math.PI / 180);   // the shorter side
    const reach = Math.max(Math.abs(la - grid.laLo), Math.abs(la - grid.laHi),
                           Math.abs(ln - grid.lnLo), Math.abs(ln - grid.lnHi));
    for (let ring = 1; ring <= reach + 1; ring++) {
      for (let dla = -ring; dla <= ring; dla++) {
        for (let dln = -ring; dln <= ring; dln++) {
          // Only the new perimeter on each widening.
          if (ring > 1 && Math.abs(dla) !== ring && Math.abs(dln) !== ring) continue;
          const at = grid.cell[`${la + dla}:${ln + dln}`];
          if (at === undefined) continue;
          for (let i = grid.off[at]; i < grid.off[at + 1]; i++) consider(this, grid.ids[i]);
        }
      }
      if (bestEdge >= 0 && bestD < (ring - 0.5) * cellM) break;
    }
    // splitAt's temporaries are not in the grid, and a second split must be
    // able to snap to the first one's halves.
    for (let i = this._edgeCount; i < this.edgeCount(); i++) {
      if (this.edgeClass(i) !== 1) consider(this, i);
    }
    if (bestEdge < 0) return this.nearestNode(lat, lng);
    const ea = this.edgeA(bestEdge), eb = this.edgeB(bestEdge);
    const da = haversine(lat, lng, this.nodeLat(ea), this.nodeLng(ea));
    const db = haversine(lat, lng, this.nodeLat(eb), this.nodeLng(eb));
    // A one-way edge can only be entered at its tail.
    const dir = this.edgeDir(bestEdge);
    let node;
    if (dir === 1) node = ea;
    else if (dir === 2) node = eb;
    else node = da <= db ? ea : eb;
    return { node, meters: bestD, edge: bestEdge };
  }

  // Where to draw a camera: on the road it watches, as found by assignCameras.
  cameraPos(id, lat, lng) {
    return this._camSnap?.[id] || [lat, lng];
  }

  nearestNode(lat, lng) {
    const n = this.nodeCount();
    let best = -1, bestD = Infinity;
    for (let i = 0; i < n; i++) {
      const d = haversine(lat, lng, this.nodeLat(i), this.nodeLng(i));
      if (d < bestD) { bestD = d; best = i; }
    }
    return { node: best, meters: bestD };
  }

  // canonStreet(name) -> [edge ids], built lazily.
  _streetIndex() {
    if (this._sidx) return this._sidx;
    const idx = {};
    for (let i = 0; i < this._edgeCount; i++) {
      const k = canonStreet(this._eName[i]);
      if (!k) continue;
      (idx[k] ||= []).push(i);
    }
    this._sidx = idx;
    return idx;
  }

  // House number + street text -> {lat, lng, edge, street, exact} or null.
  // prefer(lat, lng), when given, favours the address's own jurisdiction:
  // street names repeat across the county (Rockford and Cedar Springs each have
  // a N Main St NE numbered from 1).
  geocode(number, streetText, prefer) {
    const idx = this._streetIndex();
    const key = canonStreet(streetText);
    const ids = idx[key];
    if (!ids?.length || number == null) return null;
    const self = this;

    function inRangeHit(id) {
      const lf = self.edgeRange(id, 0), lt = self.edgeRange(id, 1);
      const rf = self.edgeRange(id, 2), rt = self.edgeRange(id, 3);
      const onLeft = inRange(number, lf, lt);
      const onRight = inRange(number, rf, rt);
      if (!onLeft && !onRight) return null;
      // prefer the side whose parity matches (ranges are odd/even per side)
      let from, to;
      if (onLeft && (!onRight || (lf % 2 === number % 2))) { from = lf; to = lt; }
      else { from = rf; to = rt; }
      const span = (to - from);
      const f = span ? (number - from) / span : 0.5;
      const pt = pointAtFraction(self.edgePoly(id), f);
      return { lat: pt[0], lng: pt[1], edge: id, street: self.edgeName(id),
               exact: true };
    }

    // For a number outside every range: the midpoint of the nearest-numbered
    // segment, flagged inexact.
    function nearestNumbered(pool) {
      let closest = -1, bestGap = Infinity;
      for (const ee of pool) {
        const pairs = [[self.edgeRange(ee, 0), self.edgeRange(ee, 1)],
                       [self.edgeRange(ee, 2), self.edgeRange(ee, 3)]];
        for (const [from, to] of pairs) {
          if (from == null || to == null) continue;
          const gap = Math.min(Math.abs(number - from), Math.abs(number - to));
          if (gap < bestGap) { bestGap = gap; closest = ee; }
        }
      }
      if (closest < 0) return null;
      const mid = pointAtFraction(self.edgePoly(closest), 0.5);
      return { lat: mid[0], lng: mid[1], edge: -1, street: self.edgeName(closest),
               exact: false };
    }

    const hits = [];
    for (const id of ids) {
      const h = inRangeHit(id);
      if (h) hits.push(h);
    }
    if (!prefer) return hits[0] || nearestNumbered(ids);

    // An inexact point in the right town beats an exact one in the wrong town.
    for (const hit of hits) if (prefer(hit.lat, hit.lng)) return hit;
    const passing = ids.filter((e) => {
      const m = pointAtFraction(self.edgePoly(e), 0.5);
      return prefer(m[0], m[1]);
    });
    if (passing.length) {
      const there = nearestNumbered(passing);
      if (there) return there;
    }
    return hits[0] || nearestNumbered(ids);
  }

  // route -> [{text, street, meters, cameras, points}], then an arrive step.
  steps(route) {
    if (!route || !route.edges.length) return [];

    const legs = [];
    route.edges.forEach((id, i) => {
      const poly = this.edgePoly(id);
      if (route.nodes[i] !== this.edgeA(id)) poly.reverse();
      const name = this.edgeName(id) || '';
      const cams = this._edgeCams?.[id] || [];
      const last = legs[legs.length - 1];
      if (last && last.name === name) {
        last.meters += this.edgeLen(id);
        last.points = last.points.concat(poly.slice(1));
        cams.forEach((c) => { if (!last.cameras.includes(c)) last.cameras.push(c); });
      } else {
        legs.push({ name, meters: this.edgeLen(id), points: poly,
                    cameras: cams.slice() });
      }
    });

    function legBearing(pts, atStart) {
      if (pts.length < 2) return 0;
      return atStart ? bearing(pts[0], pts[1])
                     : bearing(pts[pts.length - 2], pts[pts.length - 1]);
    }

    // A corner camera can watch both legs; count it on the first only, so the
    // steps sum to the route's total.
    const claimed = {};
    legs.forEach((leg) => {
      leg.cameras = leg.cameras.filter((c) => {
        if (claimed[c]) return false;
        claimed[c] = 1; return true;
      });
    });

    const out = [];
    for (let i = 0; i < legs.length; i++) {
      const leg = legs[i];
      let text;
      if (i === 0) {
        text = `Head ${compassWord(legBearing(leg.points, true))}` +
               (leg.name ? ` on ${leg.name}` : '');
      } else {
        const delta = legBearing(leg.points, true) - legBearing(legs[i - 1].points, false);
        text = turnWord(delta) + (leg.name ? ` onto ${leg.name}` : '');
      }
      out.push({ text, street: leg.name, meters: leg.meters,
                 cameras: leg.cameras, points: leg.points });
    }
    const lastLeg = legs[legs.length - 1];
    out.push({ text: 'Arrive at your destination', street: '', meters: 0,
               cameras: [], arrive: true,
               points: lastLeg ? [lastLeg.points[lastLeg.points.length - 1]] : [] });
    return out;
  }
}

// Totals from index.json or from chunk documents. A missing count reads as 0,
// so addChunk throws rather than guessing.
function totalsOf(source) {
  const list = source?.chunks ? source.chunks : (Array.isArray(source) ? source : [source]);
  const t = { nodes: 0, edges: 0, points: 0, build: null };
  for (const item of list) {
    const m = item.meta || item;
    t.nodes += m.nodes || 0;
    t.edges += m.edges || 0;
    t.points += m.points || 0;
    if (t.build === null) t.build = m.build || null;
  }
  if (source?.build) t.build = source.build;
  return t;
}

function isChunk(doc) {
  return !!doc && doc.nodes && !Array.isArray(doc.nodes);
}

// ---- A* ----

// Binary min-heap keyed by f.
class Heap {
  constructor() { this.a = []; }

  push(item) {
    const a = this.a; a.push(item); let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      const t = a[p]; a[p] = a[i]; a[i] = t; i = p;
    }
  }

  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      a[0] = last;
      const n = a.length;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let s = i;
        if (l < n && a[l].f < a[s].f) s = l;
        if (r < n && a[r].f < a[s].f) s = r;
        if (s === i) break;
        const t = a[s]; a[s] = a[i]; a[i] = t; i = s;
      }
    }
    return top;
  }

  size() { return this.a.length; }
}

function polyLength(pts) {
  let t = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    t += haversine(pts[i][0], pts[i][1], pts[i+1][0], pts[i+1][1]);
  }
  return t;
}

// Closest point on segment A-B: {t, d in metres, lat, lng}, on a local flat
// projection.
function projectOnSeg(lat, lng, A, B) {
  const toR = Math.PI / 180, R = 6371000, latR = lat * toR;
  const mx = (ln) => R * ln * toR * Math.cos(latR);
  const my = (la) => R * la * toR;
  const px = mx(lng), py = my(lat);
  const ax = mx(A[1]), ay = my(A[0]), bx = mx(B[1]), by = my(B[0]);
  const dx = bx - ax, dy = by - ay, len2 = dx*dx + dy*dy;
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return {
    t, d: Math.sqrt((px - (ax + t*dx))**2 + (py - (ay + t*dy))**2),
    lat: A[0] + (B[0] - A[0]) * t,
    lng: A[1] + (B[1] - A[1]) * t
  };
}

// ---- Addresses ----

// Addresses resolve against the house-number ranges in the graph itself
// (REGIS centerlines), so nothing typed leaves the browser, and a result is a
// point on the centerline, never a rooftop.

// One canonical street form for every comparison. The precinct index and the
// road graph disagree on street type ("HAINES AVE" vs "HAINES ST") and spell
// out ordinals, so the type is dropped and name plus directional remain.
const TYPE_WORDS = {
  STREET: 'ST', ST: 'ST', AVENUE: 'AVE', AVE: 'AVE', ROAD: 'RD', RD: 'RD',
  DRIVE: 'DR', DR: 'DR', LANE: 'LN', LN: 'LN', COURT: 'CT', CT: 'CT',
  CIRCLE: 'CIR', CIR: 'CIR', BOULEVARD: 'BLVD', BLVD: 'BLVD',
  PLACE: 'PL', PL: 'PL', TERRACE: 'TER', TER: 'TER', TRAIL: 'TRL',
  TRAILS: 'TRL', TRL: 'TRL', PARKWAY: 'PKWY', PKWY: 'PKWY', WAY: 'WAY',
  HIGHWAY: 'HWY', HWY: 'HWY', SQUARE: 'SQ', SQ: 'SQ', RIDGE: 'RDG'
};
const ORDINALS = {
  FIRST: '1ST', SECOND: '2ND', THIRD: '3RD', FOURTH: '4TH', FIFTH: '5TH',
  SIXTH: '6TH', SEVENTH: '7TH', EIGHTH: '8TH', NINTH: '9TH', TENTH: '10TH',
  ELEVENTH: '11TH', TWELFTH: '12TH'
};
const DIRS = { N: 1, S: 1, E: 1, W: 1, NE: 1, NW: 1, SE: 1, SW: 1 };

// "HAINES AVE NW" / "SEVENTH ST NW" -> "HAINES|NW" / "7TH|NW"
function canonStreet(name) {
  if (!name) return '';
  const w = String(name).toUpperCase().replace(/[.,]/g, ' ')
    .replace(/\s+/g, ' ').trim().split(' ');
  // The sources disagree on where the directional goes ("W FULTON ST" vs
  // "FULTON ST W").
  let dir = '';
  if (w.length > 1 && DIRS[w[w.length - 1]]) dir = w.pop();
  if (!dir && w.length > 1 && DIRS[w[0]]) dir = w.shift();
  if (w.length > 1 && TYPE_WORDS[w[w.length - 1]]) w.pop();
  const core = w.map((t) => ORDINALS[t] || t).join(' ');
  return `${core}|${dir}`;
}

function inRange(n, a, b) {
  if (a == null || b == null || (!a && !b)) return false;
  const lo = Math.min(a, b), hi = Math.max(a, b);
  return n >= lo && n <= hi;
}

function pointAtFraction(poly, f) {
  if (poly.length === 1) return poly[0].slice();
  const segs = [];
  let total = 0;
  for (let i = 0; i < poly.length - 1; i++) {
    const d = haversine(poly[i][0], poly[i][1], poly[i + 1][0], poly[i + 1][1]);
    segs.push(d); total += d;
  }
  if (!total) return poly[0].slice();
  const target = Math.max(0, Math.min(1, f)) * total;
  let run = 0;
  for (let i = 0; i < segs.length; i++) {
    if (run + segs[i] >= target) {
      const t = segs[i] ? (target - run) / segs[i] : 0;
      return [poly[i][0] + (poly[i + 1][0] - poly[i][0]) * t,
              poly[i][1] + (poly[i + 1][1] - poly[i][1]) * t];
    }
    run += segs[i];
  }
  return poly[poly.length - 1].slice();
}

// ---- Turn-by-turn ----

// Consecutive edges with one street name form a leg, and the bearing change
// between legs is the turn. Restrictions OpenStreetMap has not mapped are
// unknown, so the page tells people to obey the signs.

// Degrees clockwise from north, from a to b, both [lat, lng].
function bearing(a, b) {
  const toR = Math.PI / 180;
  const y = Math.sin((b[1] - a[1]) * toR) * Math.cos(b[0] * toR);
  const x = Math.cos(a[0] * toR) * Math.sin(b[0] * toR) -
            Math.sin(a[0] * toR) * Math.cos(b[0] * toR) * Math.cos((b[1] - a[1]) * toR);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function turnWord(delta) {
  const d = ((delta + 540) % 360) - 180;      // normalize to [-180, 180]
  const a = Math.abs(d);
  if (a < 18) return 'Continue';
  if (a < 50) return d > 0 ? 'Bear right' : 'Bear left';
  if (a < 140) return d > 0 ? 'Turn right' : 'Turn left';
  if (a < 175) return d > 0 ? 'Sharp right' : 'Sharp left';
  return 'Make a U-turn';
}

function compassWord(deg) {
  const pts = ['north', 'northeast', 'east', 'southeast',
               'south', 'southwest', 'west', 'northwest'];
  return pts[Math.round((deg % 360) / 45) % 8];
}

export { Graph, haversine, bearing, canonStreet, CAMERA_PENALTY, UTURN_PENALTY };
