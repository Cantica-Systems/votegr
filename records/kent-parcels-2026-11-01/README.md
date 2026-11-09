# Kent County parcel addresses and points, as of 2026-11-01

`parcels.csv.gz` lists every addressed parcel in Kent County, one row per
parcel, with three columns and nothing else:

| Column | What it is |
|---|---|
| `address` | the parcel's property address as the county wrote it, e.g. `250 MONROE AVE NW` |
| `lng`, `lat` | a point inside the parcel, WGS 84, six decimal places |

230,832 rows, 2,318,093 bytes, sorted by address and gzipped with no
timestamp, so rebuilding it from the same rows gives the same bytes.

```
sha256  c4968317e5165ddcc0e4447e827240e3deabd0db6172ba0bbb1bb14eeea1b10b  parcels.csv.gz
```

`scripts/kent_parcels.py` reads it, and `refresh_addresses.py` and
`geocode_places.py` both get their parcels from there. No script in this
repository contacts Kent County for parcels any more.

## Why this file exists

Until November 2026 those two scripts read the county's own
`ParcelsWithCondos` FeatureServer on `gis.kentcountymi.gov`, live, each time
they ran. Between 2026-11-01, the last successful read, and 2026-11-08, the
first failed one, the county's GIS server began answering requests for that
layer with ArcGIS error 499, "Token Required". Its address locators began
refusing requests the same week, and its cities, townships and villages
service answered 404 from 2026-11-08. The county's website had already been
answering this project's scripts with 403 Forbidden since 2026-09-24. No
reason has been published for any of it, and nothing here guesses at one.

A build that can only run against a server that refuses it cannot be
reproduced, so the last complete read is committed here as the reference,
the same way the state's FOIA release sits beside it in
`records/mdos-foia-2026-09-21/`.

## What else was checked, and why it was not used

Every other source found for a county-wide list of Kent addresses on
2026-11-09 was either a copy of the same county layer or not an address list:

- **Overture Maps, addresses theme** (release 2026-10-21): 224,556 Kent rows,
  all from OpenAddresses' `us/mi/kent`, which reads the same county server,
  and all marked `LicenseRef-Proprietary`. Not used.
- **City of Grand Rapids' copy, `Parcels_and_Condos`**, on the city's ArcGIS
  Online: 270,600 parcels county-wide, last edited 2024-05-02. A stale copy of
  the same layer.
- **City of Grand Rapids, `GRParcels_with_Condos`**: current (edited
  2026-08-10) but the city only, 65,808 parcels. The one live option for the
  largest jurisdiction, if this file ever needs refreshing there.
- **The US DOT National Address Database**: no points in Kent County.
- **The State of Michigan's 911 address points**: published only to 911
  providers, not to the public.
- **The state's road centerlines with address ranges** (the Michigan
  Geographic Framework, already read by this project): live and statewide,
  but ranges along a street rather than a list of real addresses, so using it
  would mean a different lookup design.

The authoritative answer to "which precinct is this address in" is the
clerks' street index in the state's Qualified Voter File. That would be a
records request, and none has been made.

## Where the rows came from

Cantica Blotter, which this project shares a maintainer with, reads the same
`ParcelsWithCondos` layer every Sunday. Its last complete read ran from
03:07 to 03:17 UTC on 2026-11-01 and returned 232,187 features; 230,832
parcels carry both an address and a point. Those are the rows here.

One difference from the scripts' old live read: the point is the average of
the corners of the parcel's outer boundary, as Blotter stores it, not the
centroid ArcGIS returned for `returnCentroid=true`. For most parcels the two
are metres apart. For a large or oddly shaped parcel near a precinct line
they can land on different sides of it.

Measured on 2026-11-09 by running `refresh_addresses.py` from this file and
comparing the answers with the address files published on 2026-09-08, which
were built from the live layer:

| | Addresses |
|---|---|
| same precinct, same distance | 202,069 |
| same precinct, different "metres from the edge" | 24,837 |
| different precinct | 104 (0.05%) |
| new since 2026-09-08 | 224 |
| gone since 2026-09-08 | 85 |

The published address files under `site/data/addresses/` were left as they
were built on 2026-09-08 and remain the reference for what the page answers.

## What was left out on purpose

Owner and taxpayer names and addresses, parcel numbers, valuations, school
districts and every other column the county publishes. None of it was copied
into this file, and nothing here should add it back: this repository is
public, and an address-to-owner index is not something a voting page should
hand out.

## Licence

Kent County states no terms for this layer: no `copyrightText`, an empty
licence field, nothing on its GIS pages. This file is redistributed as the
county published it, as public record.

## Why this is outside `site/`

`pages.yml` publishes `site/` and nothing else. This is a build input, not
something the page loads.
