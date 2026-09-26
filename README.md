# Vote Grand Rapids

Live at [votegr.org](https://votegr.org).

Type any address in Kent County Michigan (which includes the City of Grand Rapids), or drop a pin, and get your precinct, your ward
(if applicable), where you vote, where to return an absentee ballot, and a driving route there that avoids the license plate readers we know about.

It covers every city and township in the county: 30 jurisdictions, 202 precincts, and 200+ known plate readers. All the data is loaded once and held in the
browser, so a lookup or a route anywhere in the county needs nothing further from the network.

**Nothing you type leaves your browser.** Everything is rendered on your device.

This project is independent and unofficial, offered with no guarantee of accuracy. It is not affiliated with the City of Grand Rapids, Kent County, or
the State of Michigan. The Michigan Voter Information Center is still the official source of record; always verify there, or with the Clerk.

## Why

Two reasons:

1. **Finding out where you vote should not require identifying yourself.**

   The state's Michigan Voter Information Center is accurate and it is the
   official source, but it asks for your name, your birth month and year and
   your ZIP code before it will show you your ward and precinct, and every
   lookup runs on its servers. The notice you agree to on that form says, in
   full:

   > The information collected on this form is only what is needed to complete your transaction as authorized by MCL 168.509ii, MCL 168.759, MCL 168.759a, and MCL 168.764c. As a public body, MDOS is subject to the Michigan Freedom of Information Act (FOIA), MCL 15.231 et seq., and information such as a name or address may be disclosed in response to a FOIA request.

   This site is a proof of concept that none of that has to happen. Nothing
   about your registration technically needs to be processed on the state's
   servers to show you where you vote, and the state does not need to learn
   that you looked. Your voter record is already a public record, disclosable
   under FOIA whether or not you ever agree to that notice. Between the way
   that form is built and what the notice says, asking where you vote could
   create a second record: that you, from this address, on this day, looked
   yourself up. Whether that record is disclosable is a separate question.
   Query logs are data, and if collecting them is not necessary, why collect
   them? This site loads everything on your device, so there are no query
   logs of any kind that could identify you.

2. **Getting to where you vote should not require identifying yourself, including by your vehicle.**

   Driving to take part in a constitutionally protected activity should be
   free of surveillance. Automated license plate readers on traffic signals
   and utility poles track every passing vehicle, and can alert an officer in
   real time when one of them is flagged. Nobody should have a reason to feel
   uneasy about being tracked on the way to vote. Being pulled over because a
   camera read your plate is unlikely for most people, and it is a real
   possibility all the same, false positives included. So the directions here
   lead to your polling place, an early voting site or a ballot drop box by a
   route that goes around the cameras this project knows about, and where
   every route passes one, it says so and takes the way that passes the
   fewest.

## Inventory

Copy the `site` folder to any web host and it works.

```
site/index.html              the page
site/router.css              its styles
site/app.js                  the interface: loading, the answer, the map, the route
site/router.js               routing, geocoding, turn restrictions
site/basemap.js              draws the map on a canvas, no tiles
site/precinct.js             address -> jurisdiction, ward, precinct, polling place,
                             drop boxes and clerk; /simple uses it too
site/autocomplete.js         the suggestion list under the address box
site/routepanel.js           what the route panel says: the route cards, the turn list
site/cameras.js              a plate reader's marker and popup
site/elections.js            the election calendar and early voting window, for both pages
site/display-case.js         title-cases the ALL CAPS street and place names for display
site/debug.js                the ?debug panel (below), loaded only when asked for
site/vendor/leaflet/         Leaflet 1.9.4, with its LICENSE
site/fonts/                  the Hanken Grotesk typeface, with its OFL.txt
site/CNAME                   the custom domain, for GitHub Pages
site/simple/                 the light version, no map, at /simple/ (see below)
site/data/graph/index.json   which road-network chunks exist and how big each is
site/data/graph/<mcd>.json   the street network, one file per jurisdiction, with a
                             150 m overlap so routes cross the line
site/data/addresses/<mcd>.json  every parcel address in that jurisdiction and its precinct
site/data/polling/<mcd>.json    its polling places, drop boxes and clerk's office
site/data/precincts.json     the 202 precinct boundaries and the 30 jurisdictions
site/data/polling.json       Grand Rapids' 59 polling places, hand-transcribed from
                             the City Clerk's directory: the source of record for the city
site/data/gr-clerk.json      the City Clerk's early voting dates and sites, and drop boxes
site/data/elections.json     election days, and early voting where the clerk's file is silent
site/data/cameras.json       known plate readers, county-wide
site/data/landcover.json     water, parks and rail around Grand Rapids (see Limits)
site/data/neighbors.json     street names around the city, in the state's spelling,
                             for the streets the address files cannot answer
site/data/sources.json       the registry that records with a `src` key point at
site/data/early-voting.json  the County Clerk's early voting sites; neither page reads it (see Limits)
site/data/boundary.json      the Grand Rapids city limits; build input for landcover.json,
                             and where compare_osrm.mjs samples its trips
site/data/precincts.geojson  full precinct polygons, the source scripts/build_precincts.py slims
site/data/graph.json         the city-only road network from before the county widening:
                             frozen, and read only by one check in tests/test_router.mjs
site/data/addresses.json     the city-only address index from the same time: frozen, and
                             read only by tests/test_router.mjs and scripts/check_polling_civic.py
tests/                       the ten suites below, and pinned_calendar.mjs, a fixed
                             calendar the browser suites share
records/                     the state's FOIA release, as received, which supplies the
                             drop boxes the county's pages do not list
```

The `<mcd>` in a filename is the state's five-digit code for the city or
township (`34000` is Grand Rapids, `42820` Kentwood), and every precinct is
identified by the state's 13-digit code, of which that is the middle. A bare
precinct number is no identity in a county with a Precinct 1 in thirty
places.

Included are the scripts that generated those files. `BUILD.md` has the order:

```
scripts/
  refresh_precincts.py     precinct polygons from the State of Michigan, county-wide
  build_precincts.py       slims them, and unions each jurisdiction's into the
                           outline the map draws
  refresh_centerlines.py   county street centerlines
  build_graph.py           compiles the county routing graph from them
  refresh_osm_roads.py     OpenStreetMap ways and turn restrictions
  refresh_osm_via_nodes.py the via nodes those restrictions turn at
  build_restrictions.py    merges the turn restrictions into the graph
  build_graph_chunks.py    cuts it into one file per jurisdiction, plus the index
  refresh_addresses.py     every parcel address in the county and its precinct, per jurisdiction
  refresh_neighbors.py     street names in the jurisdictions around the city
  refresh_polling.py       polling places, drop boxes and clerks from the County Clerk
  merge_foia_dropboxes.py  the state's drop boxes, where the county's pages list none
  refresh_early_voting.py  early voting sites from the County Clerk
  refresh_gr_clerk.py      early voting and drop boxes from the Grand Rapids City Clerk
  geocode_places.py        coordinates for every polling place, drop box, clerk's
                           office and early voting site
  centreline_geocode.mjs   its second pass, run by node against the same router the page uses
  refresh_boundary.py      the Grand Rapids city limits
  refresh_landcover.py     water, parks, rail
  refresh_cameras.py       plate readers from OpenStreetMap, county-wide
  archive.py               Wayback captures of the pages the scrapers read
  sources.py               writes the registry in site/data/sources.json
  provenance.py            the provenance block the build scripts stamp on their files
  useragent.py             the User-Agent every script sends
  check_links.mjs          the link checker (below)
  compare_osrm.mjs         the OSRM comparison (below)
  check_polling_civic.py   Grand Rapids' polling places against Google Civic; needs a
                           GOOGLE_CIVIC_API_KEY, and nothing runs it
```

The shipped graph is the centerline build, cut into thirty chunks.

## How the routing works

Streets, one-way directions and posted speed limits come from the **Kent
County (REGIS) street centerlines**, the authoritative local record and more
complete than OpenStreetMap. Nearly every segment is named and carries address
ranges, which is what lets the road network double as the geocoder.

**The whole county is resident at once.** The page reads a small index, then
streams the thirty chunks in one at a time, packing each into flat typed
arrays before fetching the next: every coordinate in the county is one
`Int32Array` of microdegrees. Held as ordinary objects the same network costs
about 70 MiB; packed it is about 13, about what the city alone used to cost,
and a route from a Wyoming address to a polling place two blocks inside
Kentwood needs no second fetch, because the chunks overlap by 150 m at every
border and are merged into one connected graph.

**Freeways are excluded outright:** A trip to a polling place is a
neighborhood trip, the highway saves a minute at best, and surface streets
are where the camera data actually applies.

**Turn restrictions come from OpenStreetMap, and only from there.** The
centerlines carry none, so declared OSM relations (this way, via this node, to
that way) are the whole source: 240 across Kent County. Matching is geometric,
since the two datasets share no keys, and a restriction whose geometry does not
match cleanly is dropped rather than guessed, because a wrong restriction
silently forbids a legal turn.

**Testing the engine on any pair of addresses.** Add `?debug` to the page
URL and a panel appears under the search box with a From and a To field,
each taking a street address or a `lat,lng` pair. The run goes through the
same parse, geocode, precinct and snap steps the answer does, computes both
routes with the same code, draws them on the map, and dumps every number the
engine has as JSON: where each end landed and why, how far it snapped, the
metres, seconds and camera count of each route, and the turn list. The
result URL is shareable, so `?debug&from=…&to=…` reproduces a case in one
click. Nothing about the panel is loaded unless the parameter is present.

## Checking the data

Each finds the repository root from its own location, so run them from anywhere.
The three browser suites need `npm ci` and `npx playwright install chromium` first.

```bash
node tests/test_display_case.mjs         # display casing: vectors, then two invariants over the county's names
node tests/test_precinct_outline.mjs     # each jurisdiction's outline is its border, not a line through it
node tests/test_polling_data.mjs         # every polling place, and every drop box outside Grand Rapids, has a real address and a coordinate
node tests/test_router.mjs               # routing, chunks, restrictions, the address index, the polls clock
node tests/audit_routes.mjs              # drives hundreds of real trips countywide, checks every route
node tests/test_page.mjs                 # the page itself, in a browser, at three widths
node tests/test_simple_page.mjs          # /simple, in a browser, at three widths
node tests/test_early_voting_states.mjs  # the early voting states and election day, from a dated fixture, both pages
node tests/test_check_links.mjs          # what the link checker makes of a response
node tests/test_check_links_inputs.mjs   # that it can still read every file it names
node scripts/compare_osrm.mjs 30         # differential test against OSRM, the OSM reference
node scripts/check_links.mjs             # every external link in the docs, the pages and the top-level data files
```

The ten suites run on every pull request, and on any push to `main`. The two
tools reach other people's servers, so neither gates a merge: run them by
hand. The link check also runs weekly on a schedule, which is when a page
someone else moved gets noticed. It fails only on a page that is actually
gone, never on a server that declined to answer it. The `package.json` exists
only so the browser suites have a browser to drive; the site has no build
step and no dependencies.

`tests/audit_routes.mjs` is the one that matters. It routes across the real county,
every jurisdiction and every one of the 202 polling places, and mechanically
checks every result: edges join end to end, no edge is driven against its
one-way, no freeway is used, every turn passes the restriction gate, no
gratuitous U-turns, and the step distances add up. Its trips are seeded, so a
failure can be reproduced rather than re-rolled away. It exits non-zero on any
violation, and when it could not sample as many trips as it was asked for.

`scripts/compare_osrm.mjs` compares our fastest route against OSRM over the same
origin and destination, on the county graph the page ships, with trips sampled
inside the Grand Rapids city limits. OSRM is used as a measuring stick, never at
run time: sending your trip to a routing server is the thing this tool exists to
avoid. Turn costs were added to the router because that comparison showed our
routes zigzagging between fast streets in ways OSRM would not.

## Limits and disclaimer

This tool is an estimate, and these are the ways it is wrong.

**Your precinct is legally set by the state voter file, not by a line on a
map.** Addresses near a precinct boundary are genuinely ambiguous and the page
says so, as it does for a number it had to infer from its neighbors.

**Coverage is Kent County, and it is parcel addresses**, so a brand new build
may be missing entirely, and an address across the county line is not in the
index. The page says so rather than guessing. The parcel file also puts 109
addresses, the same number on the same street, in two jurisdictions; the page
offers each once per town and asks which you mean.

**Polling places change every election**, and consolidations appear only in
the footnotes of the clerk's directory. Outside Grand Rapids the polling
places come from the County Clerk's pages and were placed on the map from
the county parcel layer, or where a church or township hall is missing from
that layer, from the street centerline, so a marker may sit on the road
outside the building rather than on it. Where the county's page and its own
parcel layer disagree about an address, `scripts/refresh_polling.py` corrects
it and says why.

**Every jurisdiction has at least one drop box.** The County Clerk's pages, as
scraped into this repository, hold boxes for six jurisdictions, 23 in all, and
the page shows them for five; Grand Rapids' come from the City Clerk's own
list instead. For the other 24 jurisdictions they come from the Bureau of
Elections' statewide report, released under FOIA, and the page credits it.
Under MCL 168.764a an absentee ballot is returned only to the clerk of the city
or township where you are registered, so the page never sends you to a
neighbor's box, and wherever it has no box it can place, it names your own
clerk's office instead, with the phone number.

**Early voting is shown for Grand Rapids addresses only.** The City Clerk
publishes the city's sites and dates for the election they belong to, and
the early voting window on the calendar is the city's as well, so outside the
city there is no early voting row rather than dates that may not be your
clerk's. The County Clerk's early voting page, the one source covering all
thirty jurisdictions, was last read on 2026-09-08, when it still described the
August primary, and since 2026-09-24 it answers this project with a refusal.
`site/data/early-voting.json` holds that last reading, and neither page loads
it. Ask your own clerk.

**The map draws water, parks and rail only around Grand Rapids**: the city
limits plus about 2 km. Everywhere else it draws roads alone.

## The light version

[votegr.org/simple/](https://votegr.org/simple/) is the same county-wide
lookup with no map and no directions, built on the map page's own
`precinct.js`, so the two cannot give one address two answers. It downloads
a fraction of what the map page does, so it stays the better choice on an old
phone, a slow connection, or a screen reader. Early voting there is also shown for
Grand Rapids only. It is deliberately unlisted, carrying a noindex and linked
from nowhere on the site.

## Privacy

The page downloads its data once and does everything in the browser. It makes
no third-party request at all. You can watch that in the network panel, and
`tests/test_page.mjs` and `tests/test_simple_page.mjs` assert it, the first over
a full session from load to drawn route.

That includes the camera list. The page ships it rather than asking
OpenStreetMap for it, and keeping it fresh is the build's job:
`scripts/refresh_cameras.py`, run daily by a workflow.

We deliberately do not publish the OpenStreetMap usernames of the people who
mapped these cameras, though the data contains them. They are real people
doing something that carries risk.

## Licence

Code is public domain under the [Unlicense](UNLICENSE). Copy, host, revise, and
change it without asking, with or without credit.

Two third-party pieces ship with the site and keep their own licences:
[Leaflet](https://leafletjs.com) 1.9.4, BSD 2-Clause, in `site/vendor/leaflet/`
with its `LICENSE`; and the Hanken Grotesk typeface, SIL Open Font License 1.1,
in `site/fonts/` with its `OFL.txt`. The address-matching logic in
`site/precinct.js` is carried over from the earlier vote-gr project and says so
at the top of the file.

The data is not ours to license. Streets and address ranges are public
records of Kent County and the City of Grand Rapids; precinct boundaries are a
public record of the State of Michigan; polling places, drop boxes and clerks'
offices come from the Kent County Clerk and, for the city, the Grand Rapids
City Clerk, and the drop boxes the county does not list come from the State of
Michigan's Bureau of Elections. Every file says where it came from, and
`sources.json` is the registry that records carrying a `src` key point at.
**Camera locations, turn restrictions, water, parks and rail come from
OpenStreetMap and are ODbL**, so the graph chunks, `graph.json`,
`cameras.json` and `landcover.json` carry that obligation: keep the
attribution and share derivatives alike. Much of the camera mapping is the
work of the [DeFlock](https://deflock.org/) community, where you can also
contribute to the plate reader database and read more about the project.
