#!/usr/bin/env python3
# Released into the public domain under the Unlicense, see UNLICENSE.
"""Fill in the drop boxes Kent County's own pages do not publish, from the
state's list.

refresh_polling.py reads thirty county pages and gets 24 drop boxes out of
six jurisdictions. The other twenty-four publish none, and for those the page
falls back to the clerk's office, because an absentee ballot has to reach the
voter's own clerk under MCL 168.764a and the office is somewhere it can go.

That fallback was right when there was nothing better. There is now: the
Bureau of Elections maintains a statewide drop box report, released under
FOIA on 2026-09-21, and it carries 53 boxes for Kent County against the
county's 24 -- a box in all thirty jurisdictions, with the clerk's name and
per-day hours. Twenty-four jurisdictions that the page tells to drive to an
office during business hours in fact have a box, most of them open all hours.

THE COUNTY STAYS THE SOURCE OF RECORD WHERE IT SPEAKS. This only fills
silence: a jurisdiction whose county page lists a box is left exactly as
scraped, and nothing here is compared against or merged into those. The state
is a different level of government reading a different system, and where the
two describe the same jurisdiction the closer one wins. Every row this adds
carries `src`, pointing at the release in sources.json, so the origin is on
the record and the page can name it rather than it living in a commit message.

The release is a file that arrived in a FOIA response, not a page anyone can
fetch. So it is registered as NOT carried -- nothing refreshes it and nothing
here will notice when the Bureau's data changes -- with the request, the
release date, and the gaps found in the other two files it came with all
written into the registry entry. There is no URL to archive with cite(), so
the file itself is committed instead, under records/, with the request and
those findings written up beside it. Running this with no argument reads that
copy; pass a path when a later release arrives. Either way it is idempotent,
replacing any rows it wrote before.

Coordinates are not fetched. Most of these boxes stand at a building this
repo has already placed -- the township hall that is also the polling place,
or the clerk's office -- so the coordinate on that record is reused, along
with the note of how it was found, because reusing a point means inheriting
its provenance rather than upgrading it. What is left goes to the street
centrelines through the same helper and the same site/router.js the browser
runs, so a coordinate here cannot drift from one the page would compute.
Nothing is geocoded over the network: the county parcel layer that
geocode_places.py prefers is not reachable from every environment.

A row that cannot be placed either way is written anyway, without
coordinates, and reported. The site drops an uncoordinated box from the list
on its own, so it will not send anyone to a guess, and a box recorded without
a marker is still a true thing to have written down.

Usage: python3 merge_foia_dropboxes.py                   # the committed release
       python3 merge_foia_dropboxes.py NEWER_RELEASE.csv
"""
import argparse
import csv
import json
import pathlib
import re
import sys

from geocode_places import (centreline, inside, load_bboxes, neighbours_of,
                            split_address, street_core)
from sources import register

ROOT = pathlib.Path(__file__).resolve().parent.parent
POLLING_DIR = ROOT / "site" / "data" / "polling"
COUNTY = "KENT"

SOURCE_ID = "mdos-dropbox-report-2026-11"
RELEASED = "2026-09-21"
# The Bureau publishes no page for this. The URL is the Bureau itself, so the
# page can name and link who the records belong to; the registry note says how
# they were actually obtained. Recording the Bureau with no explanation would
# imply these were downloaded from a state website, which is not what happened.
PUBLISHER_URL = "https://www.michigan.gov/sos/elections"
REPORT_FILE = "November_2026_DropboxLocationReport_09212026.csv"
# The release travels with the repository, under the Bureau's own file names and
# outside site/ so the published bundle does not carry it. That is what makes a
# run reproducible: a FOIA response is a file that arrives once, and a script
# that reads one is not reproducible unless the file is here to read.
RECORDS = ROOT / "records" / "mdos-foia-2026-09-21"

# The state writes hours as "MONDAY 24HR;TUESDAY 24HR;...", one term per day
# with a trailing semicolon. The county writes "24 hours a day, 7 days a
# week", and the page keys its 24/7 badge off that phrasing. So a box open
# every day around the clock is written the county's way and reads the same
# on the page; anything else is left day by day, which is what it is.
DAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY",
        "SUNDAY"]
ALL_HOURS = "24 hours a day, 7 days a week"


def read_hours(text):
    """The state's per-day string -> (readable hours, was it every day)."""
    terms = {}
    for part in (text or "").split(";"):
        part = part.strip()
        if not part:
            continue
        day, _, rest = part.partition(" ")
        if day.upper() in DAYS and rest.strip():
            terms[day.upper()] = rest.strip()
    if not terms:
        return None, False
    listed = [d for d in DAYS if d in terms]
    if all(terms[d].upper() == "24HR" for d in listed):
        # Every day it is open, it is open around the clock. Seven days of
        # that is the county's phrase, which the page reads as 24/7; fewer is
        # still worth saying plainly rather than as six semicolons. Grand
        # Rapids Township publishes Monday to Saturday and no Sunday, and a
        # box that is shut one day a week is not 24/7.
        if len(listed) == 7:
            return ALL_HOURS, True
        span = (f"{listed[0].title()} to {listed[-1].title()}"
                if listed == DAYS[:len(listed)]
                else ", ".join(d.title() for d in listed))
        return f"24 hours a day, {span}", False
    return "; ".join(f"{d.title()} {terms[d].lower()}" for d in listed), False


def read_address(text):
    """The state's Address field -> (street line, note).

    The field is comma separated and the parts are not in a fixed order. A
    note about where the box sits can come before the street ("DRIVE UP DROP
    BOX @ REAR OF BUILDING,66 S. MAIN STREET,CEDAR SPRINGS,MI,49319") or
    after it ("750 LAKESIDE DRIVE SE,NEXT TO FRONT ENTRY DOORS,GRAND RAPIDS,
    MI,49506"). Taking the part before the city put a voter at "NEXT TO FRONT
    ENTRY DOORS", so the street is found by its shape, the way
    split_address already finds one, and whatever else is left is the note.
    """
    parts = [p.strip() for p in (text or "").split(",") if p.strip()]
    if len(parts) >= 3 and re.fullmatch(r"\d{5}(-\d{4})?", parts[-1]):
        parts = parts[:-3]          # drop city, state, ZIP
    street = next((p for p in parts if split_address(p)), None)
    note = "; ".join(p for p in parts if p != street) or None
    # "160  E DIVISION ST" arrives with a double space. Collapsing runs of
    # whitespace is not editing the record, and the page prints this.
    return street and " ".join(street.split()), note


def load_rows(path):
    """Kent County's rows from the release, de-duplicated."""
    with open(path, encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle))
    seen, out = set(), []
    for row in rows:
        if row["County"].strip().upper() != COUNTY:
            continue
        signature = tuple(v.strip() for v in row.values())
        if signature in seen:
            continue
        seen.add(signature)
        out.append(row)
    return out


def match_jurisdiction(rows):
    """State jurisdiction name -> the MCD file it belongs to.

    The state writes "GRAND RAPIDS CHARTER TOWNSHIP" and "CEDAR SPRINGS CITY"
    where the county writes "Grand Rapids Township" and "Cedar Springs", so
    both sides are folded to the same shape rather than either being trusted.
    """
    def fold(name):
        name = name.upper().replace(" CHARTER TOWNSHIP", " TWP")
        name = name.replace(" TOWNSHIP", " TWP").replace(" CITY", "")
        return " ".join(name.split())

    files = {}
    for path in sorted(POLLING_DIR.glob("*.json")):
        document = json.loads(path.read_text())
        files[fold(document["jurisdiction"])] = (path, document)

    matched, unmatched = {}, []
    for row in rows:
        key = fold(row["Jurisdiction"].strip())
        if key in files:
            matched.setdefault(key, []).append(row)
        else:
            unmatched.append(row["Jurisdiction"].strip())
    return files, matched, unmatched


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("report", type=pathlib.Path, nargs="?",
                        default=RECORDS / REPORT_FILE,
                        help="the Bureau's drop box location report, as CSV. "
                             "Defaults to the committed release; pass a path "
                             "when a later one arrives.")
    parser.add_argument("--dry-run", action="store_true",
                        help="report what would change and write nothing")
    args = parser.parse_args()

    if not args.report.exists():
        sys.exit(f"REFUSE: no such file: {args.report}")

    rows = load_rows(args.report)
    if not rows:
        sys.exit(f"REFUSE: no {COUNTY} County rows in {args.report.name}. "
                 "Is this the statewide report?")
    files, matched, unmatched = match_jurisdiction(rows)
    print(f"{len(rows)} {COUNTY} rows in the release, "
          f"{len(matched)} jurisdictions matched")
    if unmatched:
        sys.exit(f"REFUSE: {len(unmatched)} jurisdiction(s) in the release "
                 f"match no polling file: {sorted(set(unmatched))}. A renamed "
                 "jurisdiction would otherwise be dropped silently.")

    # Each row points at the registry entry by id. The entry itself is
    # written after the dry-run exit below, so --dry-run leaves
    # sources.json alone.
    src = SOURCE_ID

    bboxes = load_bboxes()
    neighbours = neighbours_of(bboxes)

    # Coordinates this repo already holds, keyed by the address they belong to.
    # Most came from the parcel layer, which is the building itself and beats
    # anything interpolated, so a state row at an address already placed -- a
    # township hall that is also the polling place -- reuses that point rather
    # than being sent down the centreline path for a worse one.
    #
    # Two indexes, because the two sources write a street differently. `exact`
    # is the whole street as split_address normalises it, and is county-wide: a
    # jurisdiction sometimes votes at a building the county addresses to the
    # next town over. `loose` drops the type word and keys the quadrant
    # separately, so "421 68TH ST" can still find "421 68th Street SE" -- but
    # only within the same jurisdiction, and only when that jurisdiction holds
    # exactly one candidate. Gaines Township writes its drop box without the
    # SE, and 68th Street runs through four quadrants of this county; guessing
    # between them would put a voter miles away, so one candidate settles it
    # and two refuse.
    #
    # Rows this script wrote on an earlier run are deliberately NOT indexed.
    # They are the only records here whose coordinate did not come from the
    # parcel layer, and indexing them made a re-run find its own output:
    # Cedar Springs was placed from the centrelines the first time, then found
    # itself the second time and was relabelled "exact". The coordinate did
    # not move, but the provenance on it became a lie, and a re-run stopped
    # being a no-op. Only the county's and city's own records seed this.
    exact, loose = {}, {}
    for _, document in files.values():
        mcd = document["mcd"]
        records = list((document.get("precincts") or {}).values())
        records += [b for b in (document.get("drop_boxes") or [])
                    if not b.get("src")]
        if document.get("clerk"):
            records.append(document["clerk"])
        for record in records:
            key = split_address(record.get("address"))
            if not key or not record.get("lat") or not record.get("lng"):
                continue
            # The point AND how it was found. Reusing a coordinate means
            # inheriting its provenance, not upgrading it: Nelson Township's
            # box is at the clerk's office, and that office was placed from the
            # centrelines, so calling the box "exact" would claim a parcel hit
            # that never happened.
            point = (record["lat"], record["lng"], record.get("geocode"))
            exact.setdefault(key, point)
            core, quadrant = street_core(key[1])
            loose.setdefault((mcd, key[0], core, quadrant), point)

    def already_placed(mcd, parsed):
        """(lat, lng, how) this repo already carries for that address, or None."""
        if parsed in exact:
            return exact[parsed]
        core, quadrant = street_core(parsed[1])
        if quadrant is not None:
            return loose.get((mcd, parsed[0], core, quadrant))
        rivals = {v for (m, n, c, _), v in loose.items()
                  if m == mcd and n == parsed[0] and c == core}
        return rivals.pop() if len(rivals) == 1 else None

    pending, added, skipped, nostreet = [], {}, [], []
    for key, (path, document) in sorted(files.items()):
        mcd, where = document["mcd"], document["jurisdiction"]
        # Anything the county published stays exactly as scraped.
        kept = [b for b in (document.get("drop_boxes") or [])
                if b.get("src") != SOURCE_ID]
        if kept:
            skipped.append((where, len(kept)))
            continue

        boxes = []
        for row in matched.get(key, []):
            street, note = read_address(row["Address"])
            if not street:
                nostreet.append((where, row["Address"]))
                continue
            hours, always = read_hours(row["Hours"])
            box = {"name": f"{where} drop box", "address": street}
            if note:
                box["note"] = note
            if hours:
                box["hours"] = hours
                if not always:
                    box["hours_as_published"] = row["Hours"].strip()
            if row.get("Clerk", "").strip():
                box["clerk"] = row["Clerk"].strip().title()
            box["src"] = src
            parsed = split_address(street)
            point = already_placed(mcd, parsed)
            if point:
                box["lat"], box["lng"], how = point
                box["geocode"] = how or "exact"
            else:
                pending.append({"mcd": mcd, "key": f"{mcd}:{len(boxes)}",
                                "number": parsed[0], "street": parsed[1],
                                "neighbours": neighbours.get(mcd, []),
                                "_record": box, "_bbox": bboxes.get(mcd),
                                "_label": f"{where} drop box"})
            boxes.append(box)
        if boxes:
            document["drop_boxes"] = boxes
            added[key] = (path, document, where, boxes)

    print(f"\n{len(pending)} row(s) need a centreline coordinate")
    found = centreline([{k: v for k, v in item.items()
                         if not k.startswith("_")} for item in pending])
    misses = []
    for item in pending:
        hit = found.get(item["key"])
        if not hit:
            misses.append((item["_label"], f"{item['number']} {item['street']}"))
            continue
        if item["_bbox"] and not inside(item["_bbox"], hit["lat"], hit["lng"]):
            misses.append((item["_label"], f"{item['number']} {item['street']} "
                                           "[matched outside the jurisdiction]"))
            continue
        item["_record"]["lat"], item["_record"]["lng"] = hit["lat"], hit["lng"]
        item["_record"]["geocode"] = ("centreline" if hit.get("exact")
                                      else "centreline interpolated")

    total = sum(len(b) for _, _, _, b in added.values())
    located = sum(1 for _, _, _, boxes in added.values()
                  for b in boxes if b.get("lat"))
    print(f"\n{'jurisdiction':<30}{'boxes':>7}{'located':>9}")
    for key in sorted(added):
        _, _, where, boxes = added[key]
        print(f"  {where:<28}{len(boxes):>7}"
              f"{sum(1 for b in boxes if b.get('lat')):>9}")
    print(f"\n{total} box(es) added across {len(added)} jurisdiction(s); "
          f"{located} located")
    if skipped:
        print(f"\n{len(skipped)} jurisdiction(s) left as the county published "
              f"them: {', '.join(f'{w} ({n})' for w, n in sorted(skipped))}")
    if nostreet:
        print(f"\n{len(nostreet)} row(s) carried no street address:")
        for where, text in nostreet:
            print(f"  {where:<28}{text!r}")
    if misses:
        print(f"\n{len(misses)} written without a coordinate (the page will "
              "not offer these as a destination):")
        for label, text in misses:
            print(f"  {label:<40}{text!r}")

    if args.dry_run:
        print("\n--dry-run: nothing written")
        return

    # The source goes in the registry; each row points at it with `src`, and
    # the page resolves that to a publisher, a licence and a date. Registered
    # as NOT carried, the same as the MVIC reading in refresh_gr_clerk.py: this
    # arrived as a file in a FOIA response, no script refreshes it, and nothing
    # here will notice when the Bureau's own data changes. That is a fact about
    # the source and belongs on the record, not in a commit message.
    register(
        SOURCE_ID,
        publisher="Michigan Department of State, Bureau of Elections",
        url=PUBLISHER_URL,
        licence="Public record of the State of Michigan.",
        retrieved=RELEASED,
        covers="Absentee ballot drop box locations, hours and clerk, statewide, "
               "for the November 3 2026 general election",
        carried=False,
        note=f"Obtained by FOIA request, released {RELEASED} as "
             f"{REPORT_FILE}; the Bureau publishes it at no URL, so the link "
             "above is the Bureau rather than the release and there is no "
             "archive copy to take. The release is committed instead, at "
             f"records/{RECORDS.name}/, with the request and these findings "
             "written up beside it. The request asked for three statewide "
             "records: election day polling places at precinct level, early "
             "voting sites with their dates and hours, and drop boxes. Only "
             "the drop box report is read here, and only for the 24 Kent "
             "County jurisdictions whose county page publishes no box. "
             "VERIFIED AGAINST THIS PROJECT: the release agrees with "
             "precincts.json on all 202 Kent precincts, 30 jurisdictions and "
             "every ward. GAPS IN THE RELEASE, so it is not treated as "
             "authoritative beyond drop boxes: the early voting file covers "
             "36 of 83 counties and 375 of 1,521 jurisdictions, omitting "
             "Oakland County entirely; the polling place file has three Grand "
             "Rapids ZIPs wrong, checked against USPS (see polling.json).")

    for key in sorted(added):
        path, document, _, _ = added[key]
        document["provenance"]["drop_boxes_source"] = (
            "Drop boxes for this jurisdiction come from the state, not from "
            f"the county page, which publishes none. Each carries "
            f"\"src\": \"{SOURCE_ID}\"; sources.json says what that release "
            "is and how it was obtained. Re-run merge_foia_dropboxes.py after "
            "refresh_polling.py to restore them.")
        path.write_text(json.dumps(document, separators=(",", ":")) + "\n")
    print(f"\nwrote {len(added)} files to {POLLING_DIR}")


if __name__ == "__main__":
    main()
