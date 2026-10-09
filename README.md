# Vote Grand Rapids

Live at [votegr.org](https://votegr.org).

Type any address in Kent County, Michigan, or drop a pin, and get your
precinct, your ward where there is one, where you vote, where to return an
absentee ballot, and a driving route there that avoids the license plate
readers this project knows about. It covers all 30 cities and townships, 202
precincts and 200+ known plate readers.

The data loads once into your browser and every lookup and route is computed
there. Nothing you type leaves your device. The unlisted
[light version](https://votegr.org/simple/) gives the same answers from the
same code with no map or directions, for an old phone, a slow connection or a
screen reader.

This project is independent and unofficial, offered with no guarantee of
accuracy, and unaffiliated with the City of Grand Rapids, Kent County or the
State of Michigan. The Michigan Voter Information Center is the official
source of record; always verify there, or with your clerk.

## Why

Finding out where you vote should not require identifying yourself. The
state's Voter Information Center asks for your name, birth month and year and
ZIP code, runs the lookup on its servers, and notes that "information such as
a name or address may be disclosed in response to a FOIA request." Your voter
record is already public, but asking could create a second record, that you
looked yourself up from this address on this day, and whether that one is
disclosable is a separate question. This site is a proof of
concept that the lookup can happen entirely on your device, leaving no query
log that could identify you.

Getting there should not require identifying yourself either, including by
your vehicle. Plate readers on signals and poles track every passing car and
can alert an officer in real time when one is flagged, false positives
included. The directions here go around the cameras this project knows about,
and where every route passes one, the page says so and takes the route that
passes the fewest.

## Layout

There is no build step. Copy `site/` to any web host and it works.

- `site/` holds the page (`index.html`, `app.js`, `style.css`), the shared
  lookup in `voting.js`, the canvas map in `map.js`, routing and geocoding in
  `router.js`, and the light version in `simple/`.
- `site/data/` holds every data file, committed. A file named `<mcd>.json`
  covers one jurisdiction, named by the state's five-digit code (`34000` is
  Grand Rapids), which is also the middle of every 13-digit precinct code.
- `scripts/` regenerates the data. [BUILD.md](BUILD.md) has what makes what,
  the rebuild order and the per-election checklist.
- `tests/` holds the suites below.
- `records/` holds the state's FOIA release, which supplies the drop boxes the
  county's pages do not list.

## Routing

Streets, one-ways and speed limits come from the Kent County (REGIS) street
centerlines, which carry names and address ranges, so the road network doubles
as the geocoder. Turn restrictions come from OpenStreetMap alone. Freeways are
left out, since a trip to the polls is a neighborhood trip and surface streets
are where the camera data applies.

The whole county stays in memory. The page streams thirty per-jurisdiction
chunks, overlapping 150 m at each border, into flat typed arrays of about
13 MiB (about 70 as ordinary objects), so a route across a town line needs no
further fetch.

Add `?debug` to the URL for a panel that routes between any two addresses or
`lat,lng` pairs and dumps everything the engine computed as JSON. Its
`?debug&from=…&to=…` URL reproduces a case in one click.

## Checking the data

```bash
node tests/test_display_case.mjs         # display casing
node tests/test_precinct_outline.mjs     # each jurisdiction's outline is its border
node tests/test_polling_data.mjs         # every place to vote has an address and a coordinate
node tests/test_router.mjs               # routing, chunks, restrictions, the address index
node tests/audit_routes.mjs              # hundreds of real trips countywide, every route checked
node tests/test_page.mjs                 # the page in a browser, at three widths
node tests/test_simple_page.mjs          # /simple in a browser, at three widths
node tests/test_early_voting_states.mjs  # early voting states and election day, both pages
node tests/test_check_links.mjs          # what the link checker makes of a response
node tests/test_check_links_inputs.mjs   # that it can still read every file it names
node scripts/compare_osrm.mjs 30         # our routes against OSRM
node scripts/check_links.mjs             # every external link in the docs, pages and data
```

The three browser suites need `npm ci` and `npx playwright install chromium`
first, which is all `package.json` is for. The ten suites run on every pull
request and push to `main`. The last two commands reach other people's
servers, so they run by hand, and the link check also runs weekly.

`tests/audit_routes.mjs` is the one that matters. It drives seeded trips to
all 202 polling places and checks every route mechanically for broken edges,
wrong-way one-ways, freeways, restricted turns, needless U-turns and step
distances that do not add up.

## Limits

This tool is an estimate, and these are the ways it is wrong.

- Your precinct is legally set by the state voter file, not by a line on a
  map. Near a precinct boundary, or where it had to infer a number from the
  neighbors, the page says so.
- Coverage is Kent County parcel addresses, so a brand new build may be
  missing. 109 addresses appear in two jurisdictions, and the page asks which
  you mean.
- Polling places change every election. Outside Grand Rapids a marker may sit
  on the road outside the building rather than on it.
- An absentee ballot goes only to your own clerk (MCL 168.764a), so the page
  never sends you to a neighbor's drop box, and names your clerk's office where
  it has no box to show.
- Early voting is shown for Grand Rapids addresses only, where the City Clerk
  publishes current sites and dates. Elsewhere, ask your clerk.
- The map draws water, parks and rail only around Grand Rapids.

## Privacy

The page makes no third-party request, which you can watch in the network
panel and which `tests/test_page.mjs` and `tests/test_simple_page.mjs` assert.
The camera list ships with the site, refreshed daily by
`scripts/refresh_cameras.py`. The OpenStreetMap data names the people who
mapped those cameras, and this project leaves their usernames out, because
that mapping carries real risk.

## Licence

Code is public domain under the [Unlicense](UNLICENSE). Two bundled pieces keep
their own licences: [Leaflet](https://leafletjs.com) 1.9.4 (BSD 2-Clause, in
`site/vendor/leaflet/`) and the Hanken Grotesk typeface (SIL Open Font License
1.1, in `site/fonts/`). The address matching in `site/voting.js` is carried
over from the earlier vote-gr project.

The data is public record of Kent County, the City of Grand Rapids and the
State of Michigan, and is not ours to license; every file says where it came
from. Camera locations, turn restrictions, water, parks and rail come from
OpenStreetMap under the ODbL, so the graph chunks, `graph.json`, `cameras.json`
and `landcover.json` keep its attribution and share alike. Much of the camera mapping
is the work of the [DeFlock](https://deflock.org/) community, where you can
contribute to the plate reader database.
