// Released into the public domain under the Unlicense, see UNLICENSE.
// Plain-assert tests for /simple, the light version. Run: node tests/test_simple_page.mjs
//
// The two pages answer the same question from the same files, so checking
// only one of them lets the other drift. This is also the version that
// matters most on an old phone, a slow connection or a screen reader, so a
// break here is a break for the people least able to work around it.
//
// What it checks is what would fail silently: that a real address still comes
// back with its ward, precinct and polling place, in the city and across the
// county; that a street the address list cannot answer is offered and
// ANSWERED rather than refused; that an address two towns share is the
// reader's to pick; that early voting and the city's drop boxes come from the
// clerk's file when it is about this election; and that the page still talks
// to nobody but its own host.
//
// Expectations are read from the shipped data rather than written here, so a
// refresh that changes the numbers cannot leave this file asserting last
// month's.
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { join, extname, normalize } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { chromium } from 'playwright';
import { pinnedCalendar } from './pinned_calendar.mjs';

const ROOT = join(fileURLToPath(new URL('..', import.meta.url)), 'site');
const { Precincts } = createRequire(import.meta.url)('../site/precinct.js');

let pass = 0, fail = 0;
// The detail, when a check passes one, is printed only on failure: it is what
// went wrong, and nothing on success.
function ok(name, cond, detail = '') {
  cond ? (pass++, console.log('  ok  ' + name))
       : (fail++, console.log('  FAIL ' + name + (detail ? '  ' + detail : '')));
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.geojson': 'application/json', '.png': 'image/png',
  '.woff2': 'font/woff2', '.svg': 'image/svg+xml',
};
// The early voting and drop box checks below are about which blocks are on
// the card, which is a function of today, so they set this to
// pinnedCalendar() and clear it after. Null the rest of the time, so
// everything else reads the files that ship. servedHits counts what it
// answered, so those checks can tell that their page really was given the
// pinned files.
let served = null, servedHits = 0;
const server = createServer(async (req, res) => {
  const rel = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  if (served && Object.prototype.hasOwnProperty.call(served, rel)) {
    servedHits++;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(served[rel])); return;
  }
  const file = join(ROOT, rel === '/' ? 'index.html' : rel);
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404).end('not found'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const ORIGIN = 'http://127.0.0.1:' + server.address().port;
const URL_ = ORIGIN + '/simple/index.html';

// What ships, so the assertions below describe the data rather than a memory
// of it.
const read = async (p) => JSON.parse(await readFile(join(ROOT, 'data', p), 'utf8'));
const neighbours = await read('neighbors.json');
const polling = await read('polling.json');

// The county index, built the way the page builds it, so the checks below can
// ask it what to expect.
const index = await read('precincts.json');
const mcds = index.jurisdictions.map(j => j.mcd);
const addressFiles = await Promise.all(mcds.map(m => read(`addresses/${m}.json`)));
const pollingFiles = await Promise.all(mcds.map(m => read(`polling/${m}.json`)));
const county = Precincts.county({ index, addresses: addressFiles, polling: pollingFiles,
                                  cityPolling: polling, cityMcd: '34000' });

// A street the address list cannot answer, in a jurisdiction it does not
// cover, taken from the shipped neighbour index so this cannot name one that
// has since been annexed or renamed.
const unindexed = county.unindexed(neighbours.streets);
const outsideStreet = Object.keys(unindexed)
  .filter(s => unindexed[s].every(j => !county.coversJurisdiction(j)))
  .sort()[0];

// --- the address used throughout ---------------------------------------
const ADDRESS = '602 ALEXANDER ST SE';
const EXPECT_PRECINCT = '52';

const browser = await chromium.launch();

async function open(width) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await ctx.newPage();
  const errors = [], offsite = [];
  page.on('request', r => { if (new URL(r.url()).origin !== ORIGIN) offsite.push(r.method() + ' ' + r.url()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('response', r => { if (r.status() >= 400 && !/favicon\.ico$/.test(r.url())) errors.push(r.status() + ' ' + r.url()); });
  await page.goto(URL_, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !document.querySelector('input').disabled, null, { timeout: 15000 });
  return { ctx, page, errors, offsite };
}

// What the rows said about where they are, as of the last pick.
let lastWhere = [], lastOutsideRows = 0;

// Type, then pick the option at `index` the way a mouse does.
async function pick(page, text, index = 0) {
  await page.fill('#addr, input[type="text"]', '');
  await page.type('#addr, input[type="text"]', text, { delay: 5 });
  await page.waitForSelector('#opts li', { timeout: 5000 });
  const options = await page.$$eval('#opts li', els => els.map(e => e.innerText.trim()));
  lastWhere = await page.$$eval('#opts li .opt-where', els => els.map(e => e.textContent.trim()));
  lastOutsideRows = await page.$$eval('#opts li .opt-outside', els => els.length);
  await page.$$eval('#opts li', (els, i) => {
    els[i].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  }, index);
  await page.waitForTimeout(400);
  return options;
}

for (const width of [1280, 390, 320]) {
  console.log('\n' + width + 'px');
  const { ctx, page, errors, offsite } = await open(width);

  // --- a real address ---------------------------------------------------
  await pick(page, ADDRESS);
  const answer = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  ok('a real address answers with its ward and precinct',
     /Ward:\s*3\s*Precinct:\s*52/.test(answer));
  ok('and names the polling place from polling.json',
     answer.includes(polling.precincts[EXPECT_PRECINCT].name));

  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  ok('nothing scrolls sideways with an answer on screen', overflow <= 0);

  // --- early voting and drop boxes, on a calendar held still -----------
  // Which of these blocks is on the card is a function of today, so they are
  // checked on the pinned calendar (pinned_calendar.mjs), and the page is
  // reloaded on the real files afterwards. Read from the calendar that ships,
  // this stretch goes red once early voting closes (the early block is
  // dropped once its window has passed), on election day, and for good once
  // the calendar runs out (neither block is drawn with no election), with
  // the site right each time.
  //
  // Any date far enough ahead that early voting has not closed would do; 60
  // is the one the map page's suite uses, so the two pages are checked
  // against the same calendar. Expectations come from what was served, not
  // from the files on disk, whose dates the page never saw.
  //
  // The pinned election carries no early voting window of its own, whatever
  // the shipped one says. That is what keeps "not the calendar" meaning
  // something: a page that ignored the clerk and read the calendar would
  // find no window there and draw no early block.
  const cal = pinnedCalendar(ROOT, 60);
  const clerk = cal['/data/gr-clerk.json'];
  cal['/data/elections.json'].elections = cal['/data/elections.json'].elections.map(
    (e) => ({ ...e, early_voting_from: null, early_voting_to: null }));
  const hitsBefore = servedHits;
  served = cal;
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => !document.querySelector('input').disabled, null, { timeout: 15000 });
  ok('early voting and drop boxes are checked against the calendar served to them',
     servedHits > hitsBefore);
  await pick(page, ADDRESS);
  const pinnedAnswer = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  const monthDay = iso => {
    const [y, m, d] = iso.split('-').map(Number);
    return ['January','February','March','April','May','June','July','August',
            'September','October','November','December'][m - 1] + ' ' + d;
  };
  ok('early voting shows the window the clerk published, not the calendar',
     pinnedAnswer.includes(monthDay(clerk.early_voting.from)) &&
     pinnedAnswer.includes(monthDay(clerk.early_voting.to)));
  ok('and names a site from the clerk file',
     clerk.early_voting_sites.some(s => pinnedAnswer.includes(s.name)));

  // --- drop boxes --------------------------------------------------------
  // By name, not by position. The blocks were reordered to match the map
  // page and "the last one" stopped meaning the drop boxes.
  const rows = await page.$$eval('.ev-boxes', blocks =>
    blocks[0] ? blocks[0].querySelectorAll('.loc').length : 0);
  ok(`every drop box is listed (${clerk.drop_boxes.length})`,
     rows === clerk.drop_boxes.length);
  ok('with the dates that make a drop box usable',
     /Ballots are mailed from|Return it by the time the polls close/.test(pinnedAnswer));

  // The same order as the map page, which is the point of having one.
  const order = await page.$$eval('.card-body > *', els => els.map(e => e.className));
  const at = (cls) => order.findIndex(c => c.includes(cls));
  ok('drop boxes come before early voting, which comes before the polling place',
     at('ev-boxes') > -1 && at('ev-early') > at('ev-boxes') &&
     order.findIndex(c => c === 'loc') > at('ev-early'));
  served = null;
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => !document.querySelector('input').disabled, null, { timeout: 15000 });

  // --- a street on its own is not an address -----------------------------
  await page.fill('#addr, input[type="text"]', '');
  await page.type('#addr, input[type="text"]', 'Monroe', { delay: 5 });
  await page.waitForTimeout(200);
  ok('a bare street name gets no suggestions', (await page.$$('#opts li')).length === 0);
  ok('and the hint asks for the house number', await page.evaluate(() =>
     /start with the house number/i.test(document.body.innerText)));

  // --- a street outside the county ----------------------------------------
  const options = await pick(page, '100 ' + outsideStreet);
  ok('a street outside the county is offered, not refused',
     options.some(o => o.toUpperCase().includes(outsideStreet)));
  ok('written the way people write it, not in the index\'s capitals',
     !options.some(o => o.includes(outsideStreet)));
  ok('and the option says which jurisdiction it is in',
     options.some(o => unindexed[outsideStreet].some(j => o.includes(j))));
  // A name, not a phrase: "Kentwood City" or "Ada Township", never "in …",
  // and the same grey whether or not the street is in the city.
  ok('every row names its place as a City or a Township, with no "in"',
     lastWhere.length > 0 && lastWhere.every(w => /(City|Township)$/.test(w) && !/^in /.test(w)));
  ok('no row is coloured for being outside the county', lastOutsideRows === 0);

  const outside = await page.evaluate(() => ({
    text: document.body.innerText.replace(/\s+/g, ' '),
    box: document.querySelector('#addr, input[type="text"]').value,
  }));
  ok('picking it explains where the address actually is',
     /outside Kent County/.test(outside.text));
  ok('names the jurisdiction in the answer',
     unindexed[outsideStreet].some(j => outside.text.includes(j)));
  ok('keeps the address in the box, because the address is right',
     outside.box.toUpperCase().includes(outsideStreet));
  ok('and does not pretend to know a precinct for it',
     !/Ward:\s*\d/.test(outside.text));

  // --- the privacy property ---------------------------------------------
  ok('the page never talks to anyone but its own host', offsite.length === 0);
  ok('nothing failed to load and nothing threw', errors.length === 0);
  if (offsite.length) offsite.forEach(u => console.log('       ' + u));
  if (errors.length) errors.forEach(e => console.log('       ' + e));

  await ctx.close();
}

// --- across the county -------------------------------------------------
// /simple answered for Grand Rapids alone, so an address anywhere else in
// the county was "not listed here" while the map page answered it. It now
// asks the same lookup the map page does. Fixtures are polling places, so no
// house is named: the Kentwood Activities Center (a city with wards) and Ada
// Congregational (a township, without).
{
  const { ctx, page, errors, offsite } = await open(390);
  const answerFor = async (text) => {
    await pick(page, text);
    return page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  };

  const kw = county.lookup('355 48th St SE');
  const kwText = await answerFor('355 48th St SE');
  ok('a Kentwood address answers, naming Kentwood',
     /Where you vote:\s*Kentwood/.test(kwText));
  ok('with its ward and precinct', new RegExp(`Ward:\\s*${kw.ward}\\s*Precinct:\\s*${kw.precinct}\\b`).test(kwText));
  ok('and the polling place the county lists for it', kwText.includes(kw.place.name));
  const kwBoxes = await page.$$eval('.ev-boxes .loc', els => els.length);
  ok(`and every Kentwood drop box (${county.dropBoxes('42820').length})`,
     kwBoxes === county.dropBoxes('42820').length);
  ok('and no early voting: the city clerk\'s dates are not Kentwood\'s',
     !(await page.$('.ev-early')));

  const adaText = await answerFor('6330 Ada Dr SE');
  ok('a township address answers, naming the township',
     /Where you vote:\s*Ada Township/.test(adaText));
  ok('with no Ward at all, not a blank one', !/Ward:/.test(adaText) && /Precinct:\s*\d/.test(adaText));
  ok('and the drop box the state lists for it',
     county.dropBoxes('00240').every(b => adaText.toUpperCase().includes(b.address.toUpperCase())));
  ok('and a Directions link that names the township, not the city',
     (await page.$$eval('.ev-boxes a.dir-btn', els => els.map(a => decodeURIComponent(a.href))))
       .every(h => /Ada Township, MI/.test(h) && !/Grand Rapids, MI/.test(h)));

  // The same number and street in two towns, found in the data rather than
  // written here: one row per town, and Enter is not allowed to pick.
  const shared = [];
  for (const s of county.streetNames) {
    const by = new Map();
    for (const r of county.streets[s]) {
      if (!by.has(r[0])) by.set(r[0], new Set());
      by.get(r[0]).add(county.mcdOf(r));
    }
    for (const [n, ms] of by) if (ms.size === 2) shared.push([n, s, [...ms]]);
  }
  const [n, street, pair] = shared[0];
  await page.fill('#addr', '');
  await page.type('#addr', `${n} ${street}`, { delay: 5 });
  await page.waitForSelector('#opts li', { timeout: 5000 });
  const where = await page.$$eval('#opts li .opt-where', els => els.map(e => e.textContent.trim()));
  const label = (m) => {
    const name = county.jurisdictions[m];
    return /Township$/.test(name) ? name : name + ' City';
  };
  ok('an address in two towns is offered once for each, naming only its own',
     pair.every(m => where.includes(label(m))) && where.filter(w => / or /.test(w)).length === 0);
  await page.press('#addr', 'Enter');
  await page.waitForTimeout(300);
  ok('and Enter asks the reader to pick rather than answering',
     !(await page.$('.card')) && /more than one place/i.test(await page.textContent('#status')));
  for (const m of pair) {
    const i = where.indexOf(label(m));
    await page.$$eval('#opts li', (els, k) =>
      els[k].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })), i);
    await page.waitForTimeout(300);
    ok(`picking ${county.jurisdictions[m]} answers ${county.jurisdictions[m]}`,
       new RegExp(`Where you vote:\\s*${county.jurisdictions[m]}\\b`).test(
         await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '))));
    await page.fill('#addr', '');
    await page.type('#addr', `${n} ${street}`, { delay: 5 });
    await page.waitForSelector('#opts li', { timeout: 5000 });
  }

  ok('the county page still talks to nobody but its own host', offsite.length === 0);
  ok('and nothing failed to load or threw', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

await browser.close();
server.close();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
