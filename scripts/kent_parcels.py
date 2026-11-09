# Released into the public domain under the Unlicense, see UNLICENSE.
"""Kent County parcel addresses and points, read from the committed reference.

refresh_addresses.py and geocode_places.py both need every addressed parcel
in Kent County as (address, lng, lat). Until 2026-11 they pulled it from the
county's ParcelsWithCondos FeatureServer. Between 2026-11-01 and 2026-11-08
that service began answering every request with ArcGIS error 499, "Token
Required", and no other public source carries the county's addresses (see
records/kent-parcels-2026-11-01/README.md for what was checked). So the
scripts now read a snapshot committed under records/, and nothing here makes
a network request.

The snapshot holds three columns and nothing else: the parcel's property
address, and the longitude and latitude of a point inside it. No owner,
taxpayer, parcel id or valuation was ever copied into it.
"""
import csv
import gzip
import io
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
REFERENCE = ROOT / "records" / "kent-parcels-2026-11-01" / "parcels.csv.gz"
SOURCE = ("Kent County ParcelsWithCondos, as read on 2026-11-01 and committed "
          "under records/kent-parcels-2026-11-01/")
SOURCE_URL = ("https://github.com/Cantica-Systems/votegr/tree/main/"
              "records/kent-parcels-2026-11-01")


def load(path=REFERENCE):
    """Every addressed parcel as (address, lng, lat), from the snapshot.

    A plain .csv works as well as the committed .csv.gz, so a newer snapshot
    can be tried by passing its path before it is committed.
    """
    path = pathlib.Path(path)
    raw = path.read_bytes()
    if path.suffix == ".gz":
        raw = gzip.decompress(raw)
    rows = [(r["address"], float(r["lng"]), float(r["lat"]))
            for r in csv.DictReader(io.StringIO(raw.decode("utf-8")))]
    print(f"read {len(rows):,} parcels from {path.relative_to(ROOT) if path.is_relative_to(ROOT) else path}")
    return rows
