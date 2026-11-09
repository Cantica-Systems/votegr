# Kent County parcel addresses and points, 2026-11-01

`parcels.csv.gz` lists every addressed parcel in Kent County, one row per
parcel, with three columns:

| Column | What it is |
|---|---|
| `address` | the parcel's property address as the county wrote it, e.g. `250 MONROE AVE NW` |
| `lng`, `lat` | a point inside the parcel, WGS 84, six decimal places |

230,832 rows, sorted by address and gzipped without a timestamp, so the same
rows always give the same bytes.

```
sha256  c4968317e5165ddcc0e4447e827240e3deabd0db6172ba0bbb1bb14eeea1b10b  parcels.csv.gz
```

`refresh_addresses.py` and `geocode_places.py` read it through
`scripts/kent_parcels.py`.

## Source

Kent County's `ParcelsWithCondos` layer on `gis.kentcountymi.gov`, read on
2026-11-01 by Cantica Blotter's weekly parcel pull (the two projects share a
maintainer). Until then these scripts read the layer directly; it now
requires a token. Other public sources of Kent addresses (Overture's
addresses theme, the City of Grand Rapids' copies of the parcel layer, the
National Address Database) were either copies of this layer, out of date,
limited to the city, or under a proprietary licence.

The point is the average of the corners of the parcel's outer boundary, not
the centroid the county's service returned. For most parcels the two are
metres apart.

## Compared with the published address files

Running `refresh_addresses.py` from this file on 2026-11-09 and comparing it
with the files under `site/data/addresses/`, built from the live layer on
2026-09-08:

| | Addresses |
|---|---|
| same precinct and distance | 202,069 |
| same precinct, different distance from the edge | 24,837 |
| different precinct (large or irregular parcels near a line) | 104 |
| added since 2026-09-08 | 224 |
| gone since 2026-09-08 | 85 |

The published files were left as built.

## Left out

Owner and taxpayer names and addresses, parcel numbers, valuations and every
other column the county publishes. Do not add them: this repository is
public.

## Licence

Kent County states no terms for this layer. It is redistributed as the
county published it, as public record.

## Why this is outside `site/`

`pages.yml` publishes `site/` only. This is a build input, not something the
page loads.
