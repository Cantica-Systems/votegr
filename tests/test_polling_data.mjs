// Released into the public domain under the Unlicense, see UNLICENSE.
// The polling places, as committed. Every row here is a building a voter is
// told to drive to, so the failures worth catching are the ones that send
// somebody nowhere: an address that is not an address, or a place with no
// coordinate and so no marker, no distance and no route.
//
// Both had shipped. Algoma's precinct 3 prints on the county page as three
// lines, "Kent County Road Commission" / "North Complex" /
// "11723 White Creek Avenue", and a parser that read the address from a fixed
// offset stored "North Complex" as the address. Nothing downstream could
// geocode that, so the row shipped with no coordinate and nothing said so.
// Cannon's precinct 3 wraps its address across two lines and stored
// "8331 Myers Lake" without the "Ave NE", a street that does not exist.
//
// Neither is visible in a diff of 202 rows. Both are one assertion each.
import { readFile, readdir } from 'fs/promises';

let fails = 0;
const ok = (n, c, d = '') => { console.log((c ? '  ok   ' : '  FAIL ') + n + (c ? '' : '  ' + d)); if (!c) fails++; };
// A failure here can name a hundred rows, which scrolls the reason off the
// screen. Enough to start debugging, then a count.
const some = (list, f) => list.slice(0, 5).map(f).join(', ') +
  (list.length > 5 ? ` (and ${list.length - 5} more)` : '');

const DIR = new URL('../site/data/polling/', import.meta.url);
const files = (await readdir(DIR)).filter(f => f.endsWith('.json')).sort();
const read = async f => JSON.parse(await readFile(new URL(f, DIR), 'utf8'));

// Grand Rapids is the one jurisdiction whose coordinates do not live here.
// The city is transcribed by hand into site/data/polling.json, which is the
// source of record for it, and that file is checked separately below.
const GR = '34000';

const rows = [];
for (const f of files) {
  const d = await read(f);
  for (const [code, v] of Object.entries(d.precincts || {})) {
    rows.push({ file: f, mcd: d.mcd, code, ...v });
  }
}

ok(`every jurisdiction has a polling file (${files.length})`, files.length === 30, `${files.length}`);
ok(`202 precincts are covered (${rows.length})`, rows.length === 202, `${rows.length}`);

// --- an address is a house number and a street ---
const HOUSE_NUMBER = /^\d+\s/;
const bad = rows.filter(r => !HOUSE_NUMBER.test(r.address || ''));
ok('every address starts with a house number', bad.length === 0,
   some(bad, r => `${r.file} ${r.code} ${JSON.stringify(r.address)}`));

// A street needs a type or a direction somewhere in it. "8331 Myers Lake" has
// neither and is a truncation; "1470 3 Mile Road NW-Upper Level" and
// "88 Eighth Street, Sand Lake" both carry one and are complete.
const STREET_WORD = new Set(['AVE', 'AVENUE', 'ST', 'STREET', 'RD', 'ROAD', 'DR',
  'DRIVE', 'LN', 'LANE', 'CT', 'COURT', 'BLVD', 'BOULEVARD', 'PKWY', 'PARKWAY',
  'HWY', 'HIGHWAY', 'WAY', 'CIR', 'CIRCLE', 'TER', 'TERRACE', 'PL', 'PLACE',
  'TRL', 'TRAIL', 'NE', 'NW', 'SE', 'SW']);
const truncated = rows.filter(r => {
  const words = String(r.address || '').toUpperCase().split(/[^A-Z0-9]+/);
  return !words.some(w => STREET_WORD.has(w));
});
ok('every address names a street type or a direction', truncated.length === 0,
   some(truncated, r => `${r.file} ${r.code} ${JSON.stringify(r.address)}`));

// --- a polling place without a coordinate cannot be routed to ---
const noCoord = rows.filter(r => r.mcd !== GR && (r.lat == null || r.lng == null));
ok('every polling place outside Grand Rapids has a coordinate', noCoord.length === 0,
   some(noCoord, r => `${r.file} ${r.code} ${r.name}`));

// Grand Rapids, from its own source of record.
const city = JSON.parse(await readFile(new URL('../site/data/polling.json', import.meta.url), 'utf8'));
const cityRows = Object.values(city.precincts || {});
ok(`Grand Rapids carries its own 59 places (${cityRows.length})`, cityRows.length === 59);
ok('every Grand Rapids polling place has a coordinate',
   cityRows.every(v => v.lat != null && v.lng != null),
   cityRows.filter(v => v.lat == null).map(v => v.name).join(', '));

// --- drop boxes, which the page silently discards without a coordinate ---
// boxesFor() filters on lat && lng, so an unplaced box is not shown, not
// offered and not counted -- the jurisdiction reads as though it publishes no
// box at all and the voter is sent to the clerk's office instead. That is the
// same class of failure as the two above, and just as invisible in a diff:
// twenty-eight of these arrived at once from the state's report, and one of
// them was written without a coordinate before the quadrant it was missing
// was inferred from the polling place at the same address.
//
// Grand Rapids is excluded for the same reason as its polling places, plus
// one of its own: the county writes the city's rows with the address in
// `name` and the note in `address`, and the city's real list lives in
// gr-clerk.json, which the browser geocodes against the graph it has loaded.
const boxes = [];
for (const f of files) {
  const d = await read(f);
  for (const b of d.drop_boxes || []) boxes.push({ file: f, mcd: d.mcd, ...b });
}
const countyBoxes = boxes.filter(b => b.mcd !== GR);
ok(`drop boxes outside Grand Rapids are present (${countyBoxes.length})`,
   countyBoxes.length > 0, `${countyBoxes.length}`);
const boxNoCoord = countyBoxes.filter(b => b.lat == null || b.lng == null);
ok('every drop box outside Grand Rapids has a coordinate', boxNoCoord.length === 0,
   some(boxNoCoord, b => `${b.file} ${JSON.stringify(b.address)}`));
const boxNoHouse = countyBoxes.filter(b => !HOUSE_NUMBER.test(b.address || ''));
ok('every drop box outside Grand Rapids has a street address',
   boxNoHouse.length === 0,
   some(boxNoHouse, b => `${b.file} ${JSON.stringify(b.address)}`));

// Kent County is entirely north of the equator and west of Detroit; a
// coordinate outside this box is a geocoder that matched the wrong place.
const inKent = v => v.lat > 42.7 && v.lat < 43.4 && v.lng > -86.0 && v.lng < -85.2;
const astray = [...rows, ...cityRows].filter(v => v.lat != null && !inKent(v));
ok('no polling place sits outside Kent County', astray.length === 0,
   some(astray, v => `${v.name} ${v.lat},${v.lng}`));
const boxAstray = boxes.filter(v => v.lat != null && !inKent(v));
ok('no drop box sits outside Kent County', boxAstray.length === 0,
   some(boxAstray, v => `${v.file} ${v.address} ${v.lat},${v.lng}`));

// --- a row's `src` has to resolve, or the page credits nobody ---
// provenanceHtml() looks each `src` up in sources.json and skips any id the
// registry does not hold, so a typo or a renamed source does not throw: the
// panel just stops saying where the list came from, and nothing says why.
// These rows come from a FOIA release that no URL serves, which makes the
// registry entry the only record of where they came from -- the one thing
// worth failing a build over.
const registry = JSON.parse(await readFile(
  new URL('../site/data/sources.json', import.meta.url), 'utf8')).sources || {};
const cited = boxes.filter(b => b.src);
ok(`drop boxes cite a source (${cited.length})`, cited.length > 0);
const dangling = cited.filter(b => !registry[b.src]);
ok('every drop box `src` resolves in sources.json', dangling.length === 0,
   some(dangling, b => `${b.file} ${JSON.stringify(b.src)}`));
// publisher and url are what provenanceHtml renders, and it builds an <a> from
// url without checking it, so a missing one ships a link to "undefined".
const thin = [...new Set(cited.map(b => b.src))]
  .filter(id => registry[id] && !(registry[id].publisher && registry[id].url));
ok('every cited source names a publisher and a URL', thin.length === 0,
   some(thin, id => id));

console.log(`\n${fails === 0 ? 'polling data: all passed' : fails + ' FAILED'}`);
process.exit(fails ? 1 : 0);
