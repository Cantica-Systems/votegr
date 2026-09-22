# MI Bureau of Elections, November 3 2026 general election — FOIA release

Three statewide records, released by the Michigan Department of State on
**2026-09-21** in response to a FOIA request. They are committed here as
received, unmodified, because there is no URL to fetch them from: a FOIA
response is a file that arrives once, and a script that reads one is not
reproducible unless the file travels with it.

Registered as `mdos-dropbox-report-2026-11` in `site/data/sources.json`, with
`carried: false` — nothing refreshes these and nothing here will notice when
the Bureau's own data changes.

## Why this is outside `site/`

`pages.yml` publishes `site/` and nothing else. These are source records, not
data the page reads, and 1.3 MB of CSV has no business in a bundle whose whole
point is that a lookup needs nothing further from the network.

## What was asked for

1. The statewide list of election day polling places at precinct level, showing
   county; city or township; ward where the jurisdiction has wards; precinct
   number; polling place name; and the polling place's street address, city and
   ZIP.
2. The statewide list of early voting sites for the same election, with the
   same location fields, together with each site's early voting dates and hours
   if held in the same record.
3. The statewide list of absent voter ballot drop box locations.

The request asked for a record the Bureau already maintains, citing the
equivalent November 2020 export ("MI Polling Locations (10-15-2020).xlsx", one
row per precinct) as precedent.

## What arrived

| File | Rows | Coverage |
|---|---|---|
| `November_2026_PollingLocationsByRegion_09212026.csv` | 3,900 precincts | 83 of 83 counties, 1,521 jurisdictions |
| `November_2026_EarlyVotingPollingLocations_09212026.csv` | 146 sites | **36 of 83 counties** |
| `November_2026_DropboxLocationReport_09212026.csv` | 1,891 (1,859 unique) | 83 of 83 counties, 1,473 jurisdictions |

```
sha256  729f5d73b73ee469907991a4e3dba744c68d25d7112596e0d2116459c08c0df3  November_2026_DropboxLocationReport_09212026.csv
sha256  224e94b6404e89085a0bd379a1a873dd3d96d3daf9048ca37b2b3da75160621b  November_2026_EarlyVotingPollingLocations_09212026.csv
sha256  c4abafb582804ff6716f59d36be706768714844edd904b7c5251cad7ce688558  November_2026_PollingLocationsByRegion_09212026.csv
```

The shape is not the one-row-per-precinct spreadsheet the request asked for.
Addresses arrive as multi-line blocks inside quoted cells, name and street and
city/ZIP stacked in one field, and ward is not a column: it is the first number
of a compound `PRECINCT w-p` label. The content is there; the shape is not.

## How far it can be trusted

Read against what this project already held, which is the only reason any of
it is used here:

| | |
|---|---|
| Kent County precincts | **Agrees** — all 202 precincts, 30 jurisdictions and every ward flag match `site/data/precincts.json` |
| Grand Rapids early voting | **Agrees** — same four sites, same 10/20–11/01 window, same 13 days as the city clerk |
| Drop boxes | **Better than the county** — 53 for Kent against the county's 24, a box in all thirty jurisdictions |
| Early voting, statewide | **Badly incomplete** — 375 of 1,521 jurisdictions, Oakland County absent entirely, against a nine-day requirement that Art. II §4 applies everywhere |
| Grand Rapids ZIPs | **Wrong three times** — precincts 1, 24 and 34, each checked against USPS. See the note in `site/data/polling.json` |

So: authoritative for drop boxes, a useful cross-check on precincts and on
Grand Rapids early voting, and not to be trusted for statewide early voting or
for Grand Rapids ZIPs. Only the drop box report is read by any script here, and
only for the 24 Kent County jurisdictions whose county page publishes no box.

If a later release is used for anything further, check it the same way first
and write down what you found.

## Reading them

```bash
python3 scripts/merge_foia_dropboxes.py          # defaults to the drop box report here
python3 scripts/merge_foia_dropboxes.py --dry-run
```

## Licence

Public record of the State of Michigan, redistributed as released.
