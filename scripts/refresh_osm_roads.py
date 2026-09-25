#!/usr/bin/env python3
# Released into the public domain under the Unlicense, see UNLICENSE.
"""Fetch OpenStreetMap's drivable ways and turn-restriction relations across
Kent County into build/osm_roads.json.

The centerlines carry no turn restrictions at all, so this is where they come
from: build_restrictions.py matches each OSM restriction to the centerline
graph by the bearings of these ways at the via node.

Fetched once at build time. Nothing here runs in a browser.
"""
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path
from useragent import USER_AGENT as UA

# Paths are anchored to the repository root, one level up from this
# file, since these scripts live in scripts/ and write into site/data.
ROOT = Path(__file__).resolve().parent.parent
PRECINCTS = ROOT / "site" / "data" / "precincts.geojson"
OUT = ROOT / "build" / "osm_roads.json"

ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
]

# Everything a car may legally drive on, `service` included, so a restriction
# whose from- or to-way is a service road still has that way to match against.
DRIVABLE = ("motorway|trunk|primary|secondary|tertiary|unclassified|residential|"
            "living_street|service|motorway_link|trunk_link|primary_link|"
            "secondary_link|tertiary_link|road")

MIN_WAYS = 3000


def bbox_from_boundary():
    """The extent to ask OpenStreetMap about: every precinct in the county.

    Taken from the precinct polygons rather than from boundary.json, which is
    still the city limits. The precincts tile all 30 jurisdictions, so their
    extent is the county's, and this needs no second boundary file to be
    widened first.
    """
    lats, lngs = [], []
    for f in json.loads(PRECINCTS.read_text())["features"]:
        g = f["geometry"]
        rings = g["coordinates"] if g["type"] == "Polygon" else \
            [r for poly in g["coordinates"] for r in poly]
        for ring in rings:
            for p in ring:
                lngs.append(p[0]); lats.append(p[1])
    pad = 0.004
    return (min(lats) - pad, min(lngs) - pad, max(lats) + pad, max(lngs) + pad)


def query(ql):
    last = None
    for ep in ENDPOINTS:
        try:
            print(f"  trying {ep} ...")
            data = ("data=" + urllib.parse.quote(ql)).encode("utf-8")
            req = urllib.request.Request(
                ep, data=data,
                headers={"User-Agent": UA,
                         "Content-Type": "application/x-www-form-urlencoded"})
            with urllib.request.urlopen(req, timeout=300) as r:
                j = json.loads(r.read().decode("utf-8"))
            # A partial answer still arrives as HTTP 200, with a 'remark': a
            # timeout, a truncation, or another runtime error such as running
            # out of memory. Any of them means the elements are incomplete.
            remark = str(j.get("remark") or "").lower()
            if any(s in remark for s in ("runtime error", "timed out", "truncated")):
                print(f"    truncated: {j['remark']!r}")
                last = f"remark {j['remark']!r}"
                time.sleep(3)
                continue
            return j
        except Exception as e:  # noqa: BLE001
            print(f"    failed: {e}")
            last = e
            time.sleep(3)
    raise SystemExit(f"REFUSE: no complete Overpass result ({last})")


def main():
    OUT.parent.mkdir(exist_ok=True)
    bb = bbox_from_boundary()
    bbs = ",".join(f"{v:.5f}" for v in bb)
    print(f"bbox {bbs}")

    print("fetching ways ...")
    ways = query(f'[out:json][timeout:280];'
                 f'(way["highway"~"^({DRIVABLE})$"]({bbs}););'
                 f'out geom tags;')
    w = [e for e in ways.get("elements", []) if e.get("type") == "way"]
    print(f"  {len(w)} ways")
    if len(w) < MIN_WAYS:
        sys.exit(f"REFUSE: only {len(w)} ways (< {MIN_WAYS})")

    time.sleep(3)
    print("fetching turn restrictions ...")
    res = query(f'[out:json][timeout:280];'
                f'(relation["type"="restriction"]({bbs}););'
                f'out body;')
    rels = [e for e in res.get("elements", []) if e.get("type") == "relation"]
    print(f"  {len(rels)} restriction relations")

    slim_ways = []
    for e in w:
        t = e.get("tags", {})
        slim_ways.append({
            "id": e["id"],
            "geom": [[round(g["lat"], 6), round(g["lon"], 6)]
                     for g in (e.get("geometry") or [])],
            "highway": t.get("highway"),
            "name": t.get("name") or t.get("ref") or "",
            "oneway": t.get("oneway"),
            "junction": t.get("junction"),
            "maxspeed": t.get("maxspeed"),
            "access": t.get("access"),
        })

    slim_rels = []
    for r in rels:
        t = r.get("tags", {})
        slim_rels.append({
            "id": r["id"],
            "restriction": t.get("restriction") or t.get("restriction:motorcar"),
            "members": [{"type": m.get("type"), "ref": m.get("ref"),
                         "role": m.get("role")} for m in (r.get("members") or [])],
        })

    OUT.write_text(json.dumps({"ways": slim_ways, "restrictions": slim_rels},
                              separators=(",", ":")))
    print(f"wrote {len(slim_ways)} ways + {len(slim_rels)} restrictions -> {OUT} "
          f"({OUT.stat().st_size/1048576:.1f} MB)")


if __name__ == "__main__":
    main()
