# Vote Grand Rapids

Find where you vote in Kent County, Michigan, without telling anyone who you
are. Live at [votegr.org](https://votegr.org).

Type an address or drop a pin and the page shows you:

- your precinct, and your ward where there is one
- where to vote, early or on election day
- where to return an absentee ballot
- a driving route there that avoids known license plate readers

It covers all 30 cities and townships in the county, 202 precincts and more
than 200 known plate readers.

Everything runs in your browser. The data loads once, every lookup and route
is computed on your device, and nothing you type is sent anywhere. A
[light version](https://votegr.org/simple/) gives the same answers with no map
or directions, for an old phone, a slow connection or a screen reader.

This is an independent, unofficial project with no guarantee of accuracy. It
is not affiliated with the City of Grand Rapids, Kent County or the State of
Michigan. The Michigan Voter Information Center is the official source; always
check there or with your clerk.

## Why it exists

Looking up where you vote shouldn't mean identifying yourself. The state's
lookup asks for your name, birth month and year and ZIP code, runs on the
state's servers, and warns that "information such as a name or address may be
disclosed in response to a FOIA request." Your voter record is already
public, but the lookup itself can create a second record: that someone at
your address looked themselves up on a given day. This site shows the lookup
can happen entirely on your device, with no query log at all.

Getting to the polls shouldn't identify you either. Plate readers on signals
and poles log every passing car and can alert an officer in real time,
false matches included. The directions here route around the cameras this
project knows about. When every route passes one, the page says so and picks
the route that passes the fewest.

## Running it

There is no build step. Copy `site/` to any web host and it works.

If you host a copy at another address, replace `https://votegr.org/` with your
own in the head of `index.html`, in `robots.txt` and in `sitemap.xml`, so
search engines don't treat it as a duplicate.

## What's in the repo

| Folder | Contents |
|---|---|
| `site/` | The page (`index.html`, `app.js`, `style.css`), the shared lookup (`voting.js`), the map (`map.js`), routing and geocoding (`router.js`), and the light version (`simple/`) |
| `site/data/` | Every data file, committed. `<mcd>.json` covers one jurisdiction, named by the state's five-digit code (`34000` is Grand Rapids) |
| `scripts/` | Rebuilds the data. [BUILD.md](BUILD.md) explains what makes what, the rebuild order and the checklist for each election |
| `tests/` | The test suites below |
| `records/` | The state's FOIA release, the source for drop boxes the county doesn't list |

## How routing works

The road network comes from Kent County's street centerlines, which include
street names, one-ways, speed limits and address ranges, so the same data
doubles as the address lookup. Turn restrictions come from OpenStreetMap.
Freeways are left out on purpose: a trip to the polls is a neighborhood trip,
and surface streets are where the camera data applies.

The whole county fits in memory, about 13 MiB. The page loads it as thirty
pieces, one per city or township, that overlap a little at each border, so a
route across a town line needs nothing more from the network.

Add `?debug` to the URL for a panel that routes between any two addresses or
`lat,lng` points and shows everything the router computed. Its
`?debug&from=…&to=…` link reproduces a case in one click.

## Testing

The browser suites need two setup commands first (that's all `package.json`
is for):

```bash
npm ci
npx playwright install chromium
```

These run on every pull request and every push to `main`:

| Command | Checks |
|---|---|
| `node tests/audit_routes.mjs` | Hundreds of real trips to all 202 polling places, every route checked |
| `node tests/test_router.mjs` | Routing, map pieces, turn restrictions, the address index |
| `node tests/test_polling_data.mjs` | Every place to vote has an address and a location |
| `node tests/test_precinct_outline.mjs` | Each jurisdiction's outline matches its border |
| `node tests/test_season.mjs` | Election season vs. off-season, and the next possible election date |
| `node tests/test_display_case.mjs` | How addresses and names are capitalized |
| `node tests/test_page.mjs` | The page in a browser, at three screen widths |
| `node tests/test_simple_page.mjs` | The light version in a browser, at three screen widths |
| `node tests/test_early_voting_states.mjs` | Early voting and election day, on both pages |
| `node tests/test_registration.mjs` | Registering by mail, then in person, on both pages |
| `node tests/test_check_links.mjs` | How the link checker reads a response |
| `node tests/test_check_links_inputs.mjs` | The link checker can still read every file it covers |

The route audit is the one that matters most. It drives seeded trips to every
polling place and checks each route for broken roads, wrong-way one-ways,
freeways, illegal turns, needless U-turns and distances that don't add up.

These two contact other people's servers, so they run by hand (the link check
also runs weekly):

```bash
node scripts/compare_osrm.mjs 30   # compare our routes with OSRM
node scripts/check_links.mjs       # every outside link in the docs, pages and data
```

## Known limits

This is an estimate. Here is where it can be wrong.

- Precincts. Your precinct is legally set by the state voter file, not a
  line on a map. Near a boundary, or where the precinct had to be inferred
  from its neighbors, the page tells you.
- New addresses. Coverage comes from Kent County parcel addresses as of
  2026-09-08, so a brand new build may be missing. (A 2026-11-01 copy is in
  `records/kent-parcels-2026-11-01/`.) 109 addresses fall in two
  jurisdictions, and the page asks which you mean.
- Polling places change every election. Outside Grand Rapids, a marker
  may sit on the road in front of the building.
- Absentee ballots can only go to your own clerk (MCL 168.764a), so the
  page never sends you to a neighboring town's drop box. Where your clerk has
  no box to show, it names the clerk's office.
- Early voting is shown only for Grand Rapids, the one place that
  publishes current sites and dates. Elsewhere, ask your clerk.
- Last-minute registration. In the final two weeks, when you can only
  register in person, the page names your clerk's office. Only Grand Rapids
  publishes office hours; elsewhere you get the clerk's phone number.
- The map shows water, parks and rail only around Grand Rapids.

## Privacy

The page makes no requests to anyone else's servers. You can confirm it in
your browser's network panel, and the browser tests check it on every change.

The plate reader list ships with the site and is refreshed daily by
`scripts/refresh_cameras.py`. OpenStreetMap records who mapped each camera;
this project leaves those usernames out, because mapping cameras carries real
risk for the people who do it.

## License

The code is public domain under the [Unlicense](UNLICENSE). Two bundled pieces
keep their own licenses: [Leaflet](https://leafletjs.com) 1.9.4 (BSD 2-Clause,
in `site/vendor/leaflet/`) and the Hanken Grotesk typeface (SIL Open Font
License 1.1, in `site/fonts/`). The address matching in `site/voting.js` comes
from the earlier vote-gr project.

The data is public record from Kent County, the City of Grand Rapids and the
State of Michigan, and isn't ours to license; every file says where it came
from. Camera locations, turn restrictions, water, parks and rail come from
OpenStreetMap under the ODbL, so the graph chunks, `graph.json`,
`cameras.json` and `landcover.json` keep its attribution and share-alike
terms. Much of the camera mapping is the work of the
[DeFlock](https://deflock.org/) community, where you can add to the plate
reader database.
