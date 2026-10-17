#!/usr/bin/env python3
# Released into the public domain under the Unlicense, see UNLICENSE.
"""Read the Grand Rapids City Clerk's current election page into
site/data/gr-clerk.json: early voting dates, sites and drop boxes for the city,
and where and when to register in person once registering by mail has closed.

This page is the SOURCE for Grand Rapids early voting, not a cross-check. It is
the only one that publishes the actual dates rather than a weekday pattern, and
those dates matter: for November 3 2026 the city opens on October 20, four days
before Michigan's statutory minimum of nine days ending the Sunday before. A
window derived from the statute would have told voters the sites were shut on
four days they are open, which is the wrong direction to be wrong in.

It also carries what the other sources drop -- which door to use (gymnasium,
old cafeteria) and where each drop box actually stands (curbside, bike rack,
east parking lot).

It is still prose, and it is not clean. Under the November heading the page
currently says "Deadline to register by mail or online and be eligible to vote
in the AUGUST Election": the clerk copied the block from the primary and did
not change the name. The date is right and the label is wrong. So this script
verifies what it can -- the election date, the site count, that every early
voting day falls before the election -- and leaves the rest for the human step
that BUILD.md describes. Nothing here should run unattended.

Usage: python3 refresh_gr_clerk.py
"""
import datetime
import html as html_module
import json
import pathlib
import re
import sys
import urllib.request

from archive import snapshot_or_note
from geocode_places import centreline, norm_street
from sources import register
from useragent import USER_AGENT

URL = ("https://www.grandrapidsmi.gov/departments/clerks-office/elections/"
       "current-election-information/")
SOURCE_ID = "gr-clerk-current-election"
MVIC_ID = "mvic-voter-lookup"
MVIC_URL = "https://mvic.sos.state.mi.us/"

# Corrections from a source we cannot read automatically.
#
# The clerk's page describes the City Hall boxes in a sentence -- "available
# during City Hall open hours on the Monroe and Calder Plaza levels" -- with
# no address, so the scrape produces a location nobody can be routed to and an
# hours string nobody can act on. The Michigan Voter Information Center, which
# is fed from the Qualified Voter File, gives the same box as 300 Monroe NW,
# Monroe lobby and plaza level, Monday to Friday 8am to 5pm.
#
# MVIC sits behind a bot challenge and this project does not drive one, so
# that reading was done by hand, in a browser, on the date below. It is here
# rather than hand-edited into the output because the output is generated: an
# edit there would vanish on the next run, and the reason for it with it.
#
# Matched on the clerk's own name for the row, so if the clerk starts
# publishing an address the override stops matching and their version wins.
MVIC_READ = "2026-09-08"
OVERRIDES = {
    "City Hall": {
        "name": "City Hall",
        "address": "300 Monroe NW",
        "note": "Monroe lobby and plaza level",
        "hours": "Mon-Fri, 8am to 5pm",
        "src": MVIC_ID,
    },
}
UA = {"User-Agent": USER_AGENT}
OUT = pathlib.Path(__file__).resolve().parent.parent / "site" / "data" / "gr-clerk.json"

MONTHS = ["January", "February", "March", "April", "May", "June", "July",
          "August", "September", "October", "November", "December"]
MONTH_DAY = re.compile(r"^\w+day,\s*(%s)\s+(\d{1,2})$" % "|".join(MONTHS), re.I)
ELECTION_DATE = re.compile(r"^(%s)\s+(\d{1,2}),\s*(\d{4})$" % "|".join(MONTHS), re.I)
SITE = re.compile(r"^(.+?)\s+-\s+(\d+\s+[^(]+?)(?:\s*\((.+)\))?$")
BOX = re.compile(r"^(.+?),\s*(\d+\s+[^(]+?)(?:\s*\((.+)\))?$")

MIN_SITES = 2
MIN_BOXES = 5
GR_MCD = "34000"

# "1430 Quarry, NW": the current-election page puts a comma before the
# quadrant on one site, and the early voting page writes the same site without.
QUADRANT_COMMA = re.compile(r",\s*(?=(?:NE|NW|SE|SW)\b)")


def street(text):
    return QUADRANT_COMMA.sub(" ", text.strip())


def full_streets(places):
    """Write each address the way the polling places do, street type included.

    The clerk writes "130 Delaware SW", and the polling place in the same
    building is 130 DELAWARE ST SW, so the page showed one building two ways.
    The road file names the street, through the page's own geocoder
    (centreline_geocode.mjs, which geocode_places.centreline runs), and only an
    EXACT house-number match is taken, so a guessed street type never replaces
    what the clerk wrote. The clerk's text is kept as address_as_published.
    Without node, every address stays as published. Returns how many changed.
    """
    pending = []
    for i, place in enumerate(places):
        match = re.match(r"^(\d+)\s+(.+)$", place.get("address") or "")
        if match:
            pending.append({"mcd": GR_MCD, "key": str(i), "number": int(match.group(1)),
                            "street": norm_street(match.group(2))})
    found = centreline(pending)
    changed = 0
    for item in pending:
        hit, place = found.get(item["key"]), places[int(item["key"])]
        full = hit and hit.get("exact") and f"{item['number']} {hit['street']}"
        if full and full.upper() != place["address"].upper():
            place["address_as_published"] = place["address"]
            place["address"] = full
            changed += 1
    return changed


def lines_of(page):
    text = re.sub(r"<script.*?</script>|<style.*?</style>", "", page, flags=re.S)
    text = re.sub(r"<[^>]+>", "\n", text)
    text = html_module.unescape(text).replace("\xa0", " ")
    return [line.strip() for line in text.split("\n") if line.strip()]


def section(lines, start_text, *stop_texts):
    """The lines between one heading and the next thing, by exact heading."""
    try:
        start = lines.index(start_text)
    except ValueError:
        return []
    stop = len(lines)
    for text in stop_texts:
        for i in range(start + 1, len(lines)):
            if lines[i] == text:
                stop = min(stop, i)
                break
    return lines[start + 1:stop]


def iso(month_name, day, year):
    return f"{year:04d}-{MONTHS.index(month_name.title()) + 1:02d}-{int(day):02d}"


def days_before(election, n):
    return (datetime.date.fromisoformat(election) - datetime.timedelta(days=n)).isoformat()


# The registration deadlines are statute (MCL 168.497), and the pages derive them
# from the election date. The clerk's printed dates are read only to check that
# derivation: a disagreement means one of the two is wrong, and that is a REFUSE.
BY_MAIL_DAYS, IN_PERSON_DAYS = 15, 14
MONTH = "(%s)" % "|".join(MONTHS)
BY_MAIL = re.compile(r"^\w+day,\s*%s\s+(\d{1,2}),\s*(\d{4})\s*-\s*Deadline to register "
                     r"by mail or online" % MONTH, re.I)
IN_PERSON = re.compile(r"^\w+day,\s*%s\s+(\d{1,2})\s*-\s*\w+day,\s*%s\s+(\d{1,2})\s*-\s*"
                       r"Registration must be done in person" % (MONTH, MONTH), re.I)
WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
OFFICE_HOURS = re.compile(r"^(%s)\s*-\s*(%s)\s+(\d.*[ap]m)$"
                          % ("|".join(WEEKDAYS), "|".join(WEEKDAYS)), re.I)
OFFICE = re.compile(r"^Clerk['\u2019]s Office\s+(.+?),\s*(\d+\s+.+)$", re.I)
EXTRA_DAY = re.compile(r"open on \w+day,\s*%s\s+(\d{1,2})\s+from\s+(.+?)\s+for voter "
                       r"registration" % MONTH, re.I)


def registration(lines, election):
    """Where and when Grand Rapids registers voters in person, or None.

    None, said on stdout, when the block is missing or reads differently: the
    pages then fall back to the county's record of the clerk's office, which
    early voting has no equivalent of, so this never holds up that data.
    """
    year = int(election[:4])
    by_mail = in_person = None
    for line in lines:
        match = BY_MAIL.match(line)
        if match and not by_mail:
            by_mail = iso(match.group(1), match.group(2), int(match.group(3)))
        match = IN_PERSON.match(line)
        if match and not in_person:
            in_person = (iso(match.group(1), match.group(2), year),
                         iso(match.group(3), match.group(4), year))
    if by_mail and by_mail != days_before(election, BY_MAIL_DAYS):
        sys.exit(f"REFUSE: the clerk says registering by mail closes {by_mail}, and "
                 f"statute says {days_before(election, BY_MAIL_DAYS)}")
    if in_person and in_person != (days_before(election, IN_PERSON_DAYS), election):
        sys.exit(f"REFUSE: the clerk says in-person registration runs {in_person[0]} "
                 f"to {in_person[1]}, and statute says "
                 f"{days_before(election, IN_PERSON_DAYS)} to {election}")

    office, office_hours, extra_days = None, [], []
    for line in section(lines, "Office Locations and Hours", "Drop Box Locations"):
        match = OFFICE_HOURS.match(line)
        if match:
            first = WEEKDAYS.index(match.group(1).title())
            last = WEEKDAYS.index(match.group(2).title())
            office_hours.append({"days": [d[:3] for d in WEEKDAYS[first:last + 1]],
                                 "hours": match.group(3).strip()})
            continue
        match = OFFICE.match(line)
        if match:
            office = {"address": street(match.group(2)), "note": match.group(1).strip(),
                      "src": SOURCE_ID}
            continue
        match = EXTRA_DAY.search(line)
        if match:
            date = iso(match.group(1), match.group(2), year)
            if days_before(election, IN_PERSON_DAYS) <= date < election:
                extra_days.append({"date": date, "hours": match.group(3).strip()})
            else:
                print(f"NOTE: an extra registration day on {date} falls outside "
                      f"in-person registration, so it is left out")

    if not (by_mail and in_person and office and office_hours):
        print("NOTE: no registration block read (deadlines "
              f"{'found' if by_mail and in_person else 'missing'}, office "
              f"{'found' if office else 'missing'}, hours "
              f"{'found' if office_hours else 'missing'}); writing none, and the "
              "pages fall back to the county's record of the clerk's office")
        return None
    return {"office": office, "office_hours": office_hours, "extra_days": extra_days}


def main():
    request = urllib.request.Request(URL, headers=UA)
    with urllib.request.urlopen(request, timeout=60) as response:
        lines = lines_of(response.read().decode("utf-8", "replace"))

    # "Next Election in the City of Grand Rapids" then the date on its own line.
    election = None
    for i, line in enumerate(lines):
        if line.startswith("Next Election in the City of Grand Rapids") and i + 1 < len(lines):
            match = ELECTION_DATE.match(lines[i + 1])
            if match:
                election = iso(match.group(1), match.group(2), int(match.group(3)))
            break
    if not election:
        sys.exit("REFUSE: could not read the next election date; the page has "
                 "been rewritten")
    year = int(election[:4])

    sites = []
    for line in section(lines, "Early Voting Sites", "Early Voting Dates and Times"):
        match = SITE.match(line)
        if match:
            sites.append({"name": match.group(1).strip(),
                          "address": street(match.group(2)),
                          "entrance_note": (match.group(3) or "").strip() or None,
                          "src": SOURCE_ID})

    # Dated, one day per pair of lines: "Tuesday, October 20" / "11 am - 7 pm".
    # Dated days, taken only while they run CONSECUTIVELY from the first. The
    # page keeps listing dates after early voting ends -- election night
    # closing, the deadlines table -- and a scan that takes every date it sees
    # reported a 21-day window ending November 2 for a schedule that actually
    # runs the 20th to the 1st. Early voting is a continuous stretch of days,
    # so the first gap is the end of it.
    days, block = [], section(lines, "Early Voting Dates and Times")
    expected = None
    for i, line in enumerate(block):
        match = MONTH_DAY.match(line)
        if not match or i + 1 >= len(block):
            continue
        when = iso(match.group(1), match.group(2), year)
        if expected and when != expected:
            break
        days.append({"date": when, "hours": block[i + 1]})
        expected = (datetime.date.fromisoformat(when)
                    + datetime.timedelta(days=1)).isoformat()
    if not days:
        sys.exit("REFUSE: no dated early voting days found")

    dates = sorted(d["date"] for d in days)
    if dates[-1] >= election:
        sys.exit(f"REFUSE: early voting runs to {dates[-1]}, on or after the "
                 f"election on {election}")

    boxes = []
    for line in section(lines, "Drop Box Locations", "Important Election Dates and Deadlines"):
        if line.lower().startswith("election drop boxes"):
            # The trailing sentence about City Hall is a location too, just
            # written as prose and with hours instead of an address.
            if "City Hall" in line:
                boxes.append({"name": "City Hall", "address": None,
                              "note": line, "hours": "City Hall open hours",
                              "src": SOURCE_ID})
            continue
        match = BOX.match(line)
        if match:
            boxes.append({"name": match.group(1).strip(),
                          "address": street(match.group(2)),
                          "note": (match.group(3) or "").strip() or None,
                          "hours": "24/7", "src": SOURCE_ID})
        elif re.match(r"^\d+\s", line):
            boxes.append({"name": None, "address": line, "note": None,
                          "hours": "24/7", "src": SOURCE_ID})
        elif boxes and boxes[-1].get("note") is None and boxes[-1]["name"] is None:
            boxes[-1]["note"] = line          # the description on its own line

    # Apply the hand-read corrections, and only to rows the clerk still
    # publishes the same way.
    corrected = 0
    for i, box in enumerate(boxes):
        fix = OVERRIDES.get(box.get("name"))
        if fix and not box.get("address"):
            boxes[i] = dict(box, **fix)
            corrected += 1

    if len(sites) < MIN_SITES or len(boxes) < MIN_BOXES:
        sys.exit(f"REFUSE: parsed {len(sites)} sites and {len(boxes)} drop "
                 f"boxes; the page has been rewritten")

    register_in_person = registration(lines, election)
    restreeted = full_streets(sites + boxes +
                              ([register_in_person["office"]] if register_in_person else []))

    # The source goes in the registry; the file keeps what is true of the file.
    snapshot = snapshot_or_note(URL)
    if corrected:
        register(MVIC_ID,
                 publisher="Michigan Voter Information Center, Bureau of Elections",
                 url=MVIC_URL,
                 licence="Public record of the State of Michigan.",
                 retrieved=MVIC_READ,
                 covers="Drop box addresses and hours the city clerk publishes "
                        "only as prose",
                 carried=False,
                 note="Read by hand from a voter lookup on the date above, and "
                      "NOT tracked: MVIC is behind a bot challenge, this "
                      "project does not drive one, and nothing here will "
                      "notice when it changes. Re-read it by hand whenever the "
                      "clerk's page changes. It is recorded because the fact "
                      "came from here and attributing it to the clerk would be "
                      "false.")

    src = register(
        SOURCE_ID,
        publisher="City of Grand Rapids, City Clerk's Office",
        url=URL,
        licence="Public record of the City of Grand Rapids.",
        archived=snapshot,
        covers="Grand Rapids early voting dates, sites and absentee drop boxes, "
               "and the clerk's office hours for registering in person",
        note="The source of record for the city. The county's pages are the "
             "cross-check, not the other way round. GAP: the City Hall drop "
             "box appears here only as prose, with no address and no hours, "
             "so it cannot be routed to or acted on from this page alone. "
             "Worth asking the clerk to publish it the way the other ten are.")

    document = {
        "src": src,
        "provenance": {
            "description": "Grand Rapids early voting dates, sites and absentee "
                           "drop boxes, and where and when to register in "
                           "person, from the City Clerk.",
            "source_registry": "sources.json",
            "generated": datetime.date.today().isoformat(),
            "how_to_update": "Run refresh_gr_clerk.py AND READ WHAT IT WROTE. "
                             "This is a prose page maintained by hand and it "
                             "carries copy errors: under the November heading "
                             "it currently names the August election in a "
                             "registration deadline. The script checks the "
                             "shape, not the sense.",
            "why_not_derived": "Michigan's minimum early voting window is nine "
                               "days ending the Sunday before an election. "
                               "Grand Rapids opens earlier than that, so the "
                               "window is read from this page and never "
                               "computed from the statute.",
        },
        "election": election,
        "early_voting": {"from": dates[0], "to": dates[-1], "days": days},
        "early_voting_sites": sites,
        "drop_boxes": boxes,
        "registration": register_in_person,
    }
    OUT.write_text(json.dumps(document, separators=(",", ":"), indent=1) + "\n")
    print(f"next election {election}")
    print(f"early voting {dates[0]} to {dates[-1]} ({len(days)} days, "
          f"{len(sites)} sites)")
    for site in sites:
        print(f"  {site['name']} - {site['address']}"
              f"{'  (' + site['entrance_note'] + ')' if site['entrance_note'] else ''}")
    print(f"{len(boxes)} drop boxes"
          + (f", {corrected} corrected from MVIC" if corrected else ""))
    print(f"{restreeted} address(es) given the street type the road file carries")
    if register_in_person:
        office = register_in_person["office"]
        print(f"registering in person: {office['address']} ({office['note']}), "
              + "; ".join(f"{'-'.join((h['days'][0], h['days'][-1]))} {h['hours']}"
                          for h in register_in_person["office_hours"])
              + "".join(f"; {d['date']} {d['hours']}"
                        for d in register_in_person["extra_days"]))
    print(f"wrote {OUT} ({OUT.stat().st_size/1024:.0f} KB)")


if __name__ == "__main__":
    main()
