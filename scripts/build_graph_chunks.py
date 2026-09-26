#!/usr/bin/env python3
# Released into the public domain under the Unlicense, see UNLICENSE.
"""Cut build/graph.json into the per-jurisdiction chunks the browser loads,
under site/data/graph/.

Why chunks: the county graph is 39,209 segments, and parsing it as one
document peaks near 102 MiB of heap on a phone that also holds Leaflet and
the canvas basemap. Cut into thirty files, sized in advance by index.json,
the page streams them through one at a time and packs each as it arrives,
so the peak stays near the 13 MiB the packed county costs anyway.

Why an overlap ring: a chunk cut exactly at the jurisdiction line cannot route
across it, so a trip from a Wyoming address to a polling place two blocks
inside Kentwood would dead-end at the border. Every chunk therefore carries
the segments within RING_M metres of its boundary as well. Two adjacent
jurisdictions overlap in that ring, so their chunks share real nodes and a
merged pair is one connected graph.

Why ids are global: node and edge identity is assigned once, over the whole
county, in build_graph.py. A chunk keeps those ids and stores nodes and edges
as maps rather than arrays, so merging two chunks is a union and nothing has
to be renumbered. The cost is that chunks from different builds must never be
mixed -- ids are positions in one build -- so each chunk carries the build
fingerprint and the loader is expected to refuse a mismatch.

Restrictions ride along, filtered to those whose from-edge, via-node and
to-edge are all present in the chunk. A restriction with a leg outside the
ring is dropped rather than half-applied.

Usage: python3 build_graph_chunks.py    (after build_restrictions.py)
"""
import json
import math
import sys
from collections import defaultdict
from pathlib import Path

from shapely.geometry import LineString, shape
from shapely.ops import transform, unary_union
from shapely.strtree import STRtree

from provenance import provenance

ROOT = Path(__file__).resolve().parent.parent
GRAPH = ROOT / "build" / "graph.json"
PRECINCTS = ROOT / "site" / "data" / "precincts.geojson"
OUT_DIR = ROOT / "site" / "data" / "graph"

RING_M = 150              # how far past its own border a chunk reaches
EXPECTED_JURISDICTIONS = 30
MIN_EDGES = 50            # even Bowne Township has more road than this
SEAM_BORDER_M = 500       # a shared border longer than this must have a crossing


def metre_frame(polygon):
    """A local flat projection for one jurisdiction, in metres from its centre,
    so the ring can be a real distance rather than a number of degrees.

    Buffering in degrees would be elliptical on the ground -- a degree of
    longitude is 81 km here against 111 km for latitude -- and the ring would
    be 27% thinner east-west than north-south.
    """
    lng0, lat0 = polygon.centroid.x, polygon.centroid.y
    xs = 111_320 * math.cos(math.radians(lat0))
    ys = 110_540

    def to_metres(lng, lat, _z=None):
        return (lng - lng0) * xs, (lat - lat0) * ys

    def to_degrees(x, y, _z=None):
        return x / xs + lng0, y / ys + lat0

    return to_metres, to_degrees


def ringed(polygon):
    """The jurisdiction, grown by RING_M metres."""
    to_metres, to_degrees = metre_frame(polygon)
    return transform(to_degrees, transform(to_metres, polygon).buffer(RING_M))


def main():
    if not GRAPH.exists():
        sys.exit(f"missing {GRAPH}; run build_graph.py then build_restrictions.py")
    graph = json.loads(GRAPH.read_text())
    build_id = graph["meta"].get("build")
    if not build_id:
        sys.exit("graph has no build fingerprint; re-run build_graph.py")
    nodes, edges = graph["nodes"], graph["edges"]
    restrictions = graph.get("restrictions") or []
    print(f"county graph: {len(nodes):,} nodes, {len(edges):,} edges, "
          f"{len(restrictions)} restrictions, build {build_id}")

    features = json.loads(PRECINCTS.read_text())["features"]
    by_mcd = defaultdict(list)
    names = {}
    for f in features:
        by_mcd[f["properties"]["mcd"]].append(shape(f["geometry"]))
        names[f["properties"]["mcd"]] = f["properties"]["jurisdiction"]
    if len(by_mcd) != EXPECTED_JURISDICTIONS:
        sys.exit(f"REFUSE: {len(by_mcd)} jurisdictions in {PRECINCTS.name}, "
                 f"expected {EXPECTED_JURISDICTIONS}")

    # Precincts tile their jurisdiction, so their union is its outline.
    outlines = {mcd: unary_union(polys).buffer(0) for mcd, polys in by_mcd.items()}

    # One geometry per edge, indexed, so each jurisdiction asks the tree
    # instead of walking 39,209 polylines.
    lines = [LineString([(p[1], p[0]) for p in e["p"]]) for e in edges]
    tree = STRtree(lines)

    # Every file is built in memory first and written only once every guard
    # below has passed, so a refusal leaves the previous build's chunks and
    # index exactly as they were rather than a half-replaced directory.
    chunk_nodes = {}
    table = []
    metas = {}
    pending = []          # (path, body), written at the end
    for mcd, outline in sorted(outlines.items()):
        area = ringed(outline)
        keep = sorted(i for i in tree.query(area) if lines[i].intersects(area))
        if len(keep) < MIN_EDGES:
            sys.exit(f"REFUSE: {names[mcd]} kept only {len(keep)} edges")

        node_ids = set()
        for i in keep:
            node_ids.add(edges[i]["a"])
            node_ids.add(edges[i]["b"])
        chunk_nodes[mcd] = node_ids

        here_edges = {str(i): edges[i] for i in keep}
        here_nodes = {str(n): nodes[n] for n in sorted(node_ids)}
        here_restrictions = [
            r for r in restrictions
            if str(r["f"]) in here_edges and str(r["t"]) in here_edges
            and r["v"] in node_ids
        ]

        lats = [nodes[n][0] for n in node_ids]
        lngs = [nodes[n][1] for n in node_ids]
        document = {
            "meta": {
                "build": build_id,
                "mcd": mcd,
                "jurisdiction": names[mcd],
                "ring_m": RING_M,
                "nodes": len(here_nodes),
                "edges": len(here_edges),
                # Polyline vertices. The browser packs every coordinate in
                # the county into one typed array and has to size it before
                # it starts, so it needs this without opening the file.
                "points": sum(len(e["p"]) for e in here_edges.values()),
                "restrictions": len(here_restrictions),
                "oneway": sum(1 for e in here_edges.values() if e["d"]),
                "bbox": [round(min(lats), 6), round(min(lngs), 6),
                         round(max(lats), 6), round(max(lngs), 6)],
            },
            "provenance": provenance(
                source=f"{names[mcd]} share of the REGIS/Kent County street "
                       "centerlines, with OpenStreetMap turn restrictions.",
                source_url="build/graph.json",
                licence="Centerlines published as open data; turn restrictions "
                        "from OpenStreetMap are ODbL, so this file carries "
                        "that obligation.",
                made_by="build_graph_chunks.py",
                how_to_update="Run refresh_centerlines.py, build_graph.py, "
                              "build_restrictions.py, then this script. All "
                              "chunks are rebuilt together and must be "
                              "deployed together: node and edge ids are "
                              "positions in one county build, so mixing "
                              "chunks from two builds points them at "
                              "different roads.",
                derived_from="build/graph.json",
                build=build_id,
                ring_metres=RING_M,
                ring_note="Edges within this distance of the jurisdiction "
                          "boundary are included so a route can cross it. "
                          "Adjacent chunks therefore share nodes and can be "
                          "merged into one connected graph."),
            "nodes": here_nodes,
            "edges": here_edges,
            "restrictions": here_restrictions,
        }
        metas[mcd] = document["meta"]
        body = json.dumps(document, separators=(",", ":")) + "\n"
        pending.append((OUT_DIR / f"{mcd}.json", body))
        table.append((names[mcd], len(here_edges), len(here_nodes),
                      len(here_restrictions), len(body.encode("utf-8"))))

    # The loader reads this first and nothing else until it has: it says
    # which chunks exist and how big each one is, which is what lets the
    # browser allocate its arrays once and then stream the chunks through
    # one at a time, never holding more than one parsed document.
    index = {
        "note": "Written by build_graph_chunks.py. The sizes let a loader "
                "allocate exactly once before reading any chunk. All chunks "
                "share one build fingerprint and must be deployed together.",
        "build": build_id,
        "ring_m": RING_M,
        # The manifest is a data file like any other in this directory, and
        # the About sheet says every one of them records where it came from
        # and on what terms. It was the only file under site/data/ that did
        # not, which made that sentence false by one file.
        "provenance": provenance(
            source="Index of the per-jurisdiction chunks beside it, written "
                   "by the same run that writes them.",
            source_url="build/graph.json",
            licence="Follows the chunks it indexes: REGIS/Kent County "
                    "centerlines published as open data, with OpenStreetMap "
                    "turn restrictions under the ODbL. This file itself "
                    "carries only counts, bounding boxes and the build "
                    "fingerprint, and no road geometry.",
            made_by="build_graph_chunks.py",
            how_to_update="Never on its own. It is written with the chunks "
                          "by this script and shares their build "
                          "fingerprint, so rebuild them together."),
        "chunks": [
            {"mcd": mcd, "jurisdiction": names[mcd],
             "nodes": m["nodes"], "edges": m["edges"], "points": m["points"],
             "restrictions": m["restrictions"], "bbox": m["bbox"]}
            for mcd, m in sorted(metas.items())],
    }
    pending.append((OUT_DIR / "index.json",
                    json.dumps(index, separators=(",", ":")) + "\n"))

    verify_seams(outlines, chunk_nodes, names)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for stale in OUT_DIR.glob("*.json"):
        stale.unlink()
    for path, body in pending:
        path.write_text(body)
    print(f"wrote {len(index['chunks'])} chunks and {OUT_DIR / 'index.json'}")

    print(f"\n{'jurisdiction':<26}{'edges':>8}{'nodes':>8}{'turns':>7}{'KB':>7}")
    for name, e, n, r, size in sorted(table, key=lambda row: -row[1]):
        print(f"{name:<26}{e:>8,}{n:>8,}{r:>7}{size/1024:>7.0f}")
    total = sum(row[4] for row in table)
    print(f"{'ALL 30 CHUNKS':<26}{sum(r[1] for r in table):>8,}"
          f"{sum(r[2] for r in table):>8,}{sum(r[3] for r in table):>7}"
          f"{total/1024:>7.0f}")


def verify_seams(outlines, chunk_nodes, names):
    """The whole design rests on adjacent chunks sharing real nodes. Two
    jurisdictions whose outlines touch must share at least one crossing, or a
    route between them dead-ends at the border with no error to show for it.

    The test is on the border, not on a node count. A rural township line may
    genuinely have two roads over it, and three shared nodes there is complete
    connectivity rather than a thin seam -- an early version of this guard
    demanded five and failed six perfectly good borders. What cannot be
    tolerated is a substantial shared border with NO crossing at all. Two
    jurisdictions meeting at a corner get a pass, since there may be no road.
    """
    mcds = sorted(outlines)
    checked = broken = 0
    crossings = []
    for i, a in enumerate(mcds):
        for b in mcds[i + 1:]:
            if not outlines[a].intersects(outlines[b]):
                continue
            border = outlines[a].boundary.intersection(outlines[b].boundary)
            metres = border.length * 111_000     # rough, and only a threshold
            shared = chunk_nodes[a] & chunk_nodes[b]
            checked += 1
            crossings.append(len(shared))
            if not shared and metres > SEAM_BORDER_M:
                broken += 1
                print(f"  BROKEN SEAM: {names[a]} and {names[b]} share "
                      f"{metres:,.0f} m of border and no nodes at all")
    if broken:
        sys.exit(f"REFUSE: {broken} of {checked} shared borders would not route across")
    print(f"\nseams: {checked} touching jurisdiction pairs, all with a crossing "
          f"(thinnest {min(crossings)} shared nodes, median "
          f"{sorted(crossings)[len(crossings)//2]})")


if __name__ == "__main__":
    main()
