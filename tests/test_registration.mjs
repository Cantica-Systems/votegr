// Released into the public domain under the Unlicense, see UNLICENSE.
// Registering to vote, on both pages. Michigan takes a registration online or
// by mail through the 15th day before an election, and from the 14th only in
// person at the voter's own clerk's office, until the polls close on election
// day (MCL 168.497). So the card that says where to go exists for two weeks
// before each election, and a line under the countdown says which way applies.
// Each phase is reached by serving a pinned calendar (pinned_calendar.mjs).
//
// What would fail silently: the card missing in the two weeks it matters, the
// card naming the wrong office, the clerk's office becoming where the
// directions point before anything is clicked, the line still offering
// registration by mail after it has closed, and the card outliving 8 PM on
// election day. Expectations come from the shipped files, not from here.
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { join, extname, normalize } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';
import { Elections } from '../site/voting.js';
import { pinnedCalendar } from './pinned_calendar.mjs';

const ROOT = join(fileURLToPath(new URL('..', import.meta.url)), 'site');
const json = async (f) => JSON.parse(await readFile(join(ROOT, f), 'utf8'));

const CLERK = await json('data/gr-clerk.json');
const KENTWOOD = await json('data/polling/42820.json');
const POLL_HOURS = (await json('data/elections.json')).election_day_hours;
const STATE = 'https://www.michigan.gov/sos/elections/voting/register-to-vote';
const GR_ADDR = '300 Monroe Ave NW', KW_ADDR = '355 48th St SE';

let fails = 0;
const ok = (n, c) => { console.log((c ? '  ok  ' : '  FAIL') + '  ' + n); if (!c) fails++; };

if (!CLERK.registration) {
  console.log('FAIL  gr-clerk.json carries no registration block; run refresh_gr_clerk.py');
  process.exit(1);
}

// LOCAL dates, the way Elections.todayISO() reckons them.
const iso = (d) => {
  const x = new Date(); x.setDate(x.getDate() + d);
  const pad = (n) => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
};
const short = (t) => String(t).replace(/:00(?=\s*[AP]M\b)/i, '');
// app.js writes a curly apostrophe and /simple a straight one, each its own habit.
const plain = (t) => String(t).replace(/\u2019/g, "'");

// ---- the phase, with an explicit clock ------------------------------------
// The two edges that matter: the day after the 15th day before, and 8 PM on
// election day, read from the statewide hours rather than restated.
{
  const e = { date: '2026-11-03' };
  const at = (d, h, m) => { const [y, mo, dd] = d.split('-').map(Number); return new Date(y, mo - 1, dd, h, m); };
  const [ch, cm] = (() => { const t = Elections.atTime('2026-11-03', POLL_HOURS.close); return [t.getHours(), t.getMinutes()]; })();
  const cases = [
    ['the last day by mail, at midnight', at('2026-10-19', 23, 59), 'mail'],
    ['the first day in person', at('2026-10-20', 0, 0), 'in-person'],
    ['election morning', at('2026-11-03', 6, 0), 'in-person'],
    ['a minute before the polls close', at('2026-11-03', ch, cm - 1), 'in-person'],
    ['as the polls close', at('2026-11-03', ch, cm), 'closed'],
    ['the day after', at('2026-11-04', 9, 0), 'closed'],
  ];
  ok('registering by mail closes on the 15th day before', Elections.registerByMailUntil(e) === '2026-10-19');
  for (const [what, now, want] of cases) {
    ok(`phase, ${what} (${Elections.registrationPhase(e, POLL_HOURS, now)})`,
       Elections.registrationPhase(e, POLL_HOURS, now) === want);
  }
  ok('no election, no phase', Elections.registrationPhase(null, POLL_HOURS) === null);
}

// ---- the pages -------------------------------------------------------------

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.geojson': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml' };
let served = null;
const server = createServer(async (req, res) => {
  const rel = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  if (served && Object.prototype.hasOwnProperty.call(served, rel)) {
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
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const ORIGIN = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch();

// clock: a local Date to hold the page at, or null for the real one.
async function open(path, { width = 1280, clock = null } = {}) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  if (clock) await page.clock.setFixedTime(clock);
  await page.goto(ORIGIN + path, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => !document.getElementById('addr').disabled, null,
                             { timeout: 60000 });
  return page;
}

async function lookUp(page, addr) {
  await page.fill('#addr', addr);
  await page.press('#addr', 'Enter');
  await page.waitForSelector('#precinctInfo .vi-lbl', { timeout: 15000 });
  // The picker fills once routing has run.
  await page.waitForFunction(() => document.querySelector('#destPick button.on') ||
                                   document.querySelector('#routes .err'), null,
                             { timeout: 20000 }).catch(() => {});
}

const readCard = (page) => page.evaluate(() => {
  const where = document.querySelector('#precinctInfo .vi-register');
  const when = document.querySelector('#precinctInfo .vi-when-register');
  const spans = [...(when?.querySelectorAll('.ev-hours span') || [])];
  const rows = [];
  for (let i = 0; i + 1 < spans.length; i += 2) {
    rows.push([spans[i].textContent.trim(), spans[i + 1].textContent.trim(),
               spans[i].classList.contains('is-today')]);
  }
  return where && {
    name: where.querySelector('.pp-name')?.textContent.trim(),
    addr: where.querySelector('.pp-addr')?.textContent.trim() || '',
    text: where.textContent,
    routable: where.dataset.kind === 'register',
    label: when?.querySelector('.vi-lbl')?.textContent.trim(),
    status: when?.querySelector('.vi-val')?.textContent.trim(),
    when: when?.textContent || '',
    link: when?.querySelector('a')?.href || null,
    rows,
  };
});

const picker = (page) => page.evaluate(() => ({
  kinds: [...document.querySelectorAll('#destPick button')].map((b) => b.dataset.kind),
  on: document.querySelector('#destPick button.on')?.dataset.kind || null,
  markers: document.querySelectorAll('#map .site-register').length,
}));

const readSimple = (page) => page.evaluate(() => {
  const block = document.querySelector('#result .ev-register');
  const spans = [...(block?.querySelectorAll('.ev-hours span') || [])];
  const rows = [];
  for (let i = 0; i + 1 < spans.length; i += 2) {
    rows.push([spans[i].textContent.trim(), spans[i + 1].textContent.trim(),
               spans[i].classList.contains('is-today')]);
  }
  return block && { text: block.textContent, link: block.querySelector('.ev-note a')?.href,
                    directions: !!block.querySelector('a.dir-btn'), rows };
});

async function simpleLookUp(page, addr) {
  await page.fill('#addr', addr);
  await page.press('#addr', 'Enter');
  await page.waitForSelector('#result .card', { timeout: 15000 });
}

const line = (page, id) => page.evaluate((i) => {
  const el = document.getElementById(i);
  return { shown: !!el && !el.hidden, text: el?.textContent || '',
           link: el?.querySelector('a')?.href || null };
}, id);

// The rows the Grand Rapids card should show, from the clerk's file as served.
function wantRows(clerk, election) {
  const reg = clerk.registration, today = iso(0);
  const wd = new Date().getDay();
  const extra = reg.extra_days.map((d) => d.date);
  const special = today === election || extra.includes(today);
  return [
    ...reg.office_hours.map((h) => [`${h.days[0]} to ${h.days[h.days.length - 1]}`,
      null, !special && h.days.includes(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][wd])]),
    ...reg.extra_days.map((d) => [null, null, d.date === today]),
    ['Election day', `Until ${short(POLL_HOURS.close)}`, today === election],
  ];
}
const rowsMatch = (got, want) => got.length === want.length &&
  want.every((w, i) => (w[0] === null || got[i][0] === w[0]) &&
                       (w[1] === null || got[i][1] === w[1]) && got[i][2] === w[2]);

// ---- in person: five days out ----------------------------------------------
{
  const cal = pinnedCalendar(ROOT, 5);
  served = cal;
  const clerk = cal['/data/gr-clerk.json'], election = iso(5);
  const office = clerk.registration.office;

  const page = await open('/index.html');
  const before = await line(page, 'cdReg');
  ok('in person: the countdown says registering is still open, in person',
     before.shown && /still register in person/.test(before.text) &&
     before.text.includes(short(POLL_HOURS.close)) && /on election day/.test(before.text));
  ok('in person: and no longer offers registering online', !/online/i.test(before.text));

  await lookUp(page, GR_ADDR);
  const gr = await readCard(page);
  console.log(`\n[in person, Grand Rapids] ${JSON.stringify(gr)}`);
  ok('in person: Grand Rapids has a registration card', !!gr);
  if (gr) {
    ok('  headed "Not registered yet?", through election day',
       gr.label === 'Not registered yet?' &&
       gr.status === `Through ${Elections.dayMonth(election)}`);
    ok("  at the city clerk's office, from the clerk's file",
       /Grand Rapids City Clerk/.test(gr.name) && gr.addr.startsWith(office.address) &&
       gr.text.includes(office.note));
    ok("  with the clerk's hours, today marked", rowsMatch(gr.rows, wantRows(clerk, election)));
    ok("  and the state's page for what counts as proof", gr.link === STATE);
    ok('  and directions to it', gr.routable);
  }
  const pick = await picker(page);
  console.log(`[in person, picker] ${JSON.stringify(pick)}`);
  ok('in person: the clerk is in the directions picker', pick.kinds.includes('register'));
  ok('in person: but never where the directions point first', !!pick.on && pick.on !== 'register');
  ok('in person: and has no map marker of its own', pick.markers === 0);
  await page.click('#destPick button[data-kind="register"]');
  await page.waitForFunction(() =>
    document.querySelector('#destPick button.on')?.dataset.kind === 'register', null,
    { timeout: 15000 }).catch(() => {});
  ok('in person: picking it routes there', await page.evaluate(() =>
    document.querySelector('#destPick button.on')?.dataset.kind === 'register' &&
    !document.querySelector('#routes .err')));

  await lookUp(page, KW_ADDR);
  const kw = await readCard(page);
  console.log(`[in person, Kentwood] ${JSON.stringify(kw)}`);
  ok("in person: Kentwood's card names Kentwood's clerk",
     !!kw && /Kentwood/.test(kw.name) && kw.addr.length > 0 && kw.routable);
  ok('  and, with no hours published, says to call',
     !!kw && kw.rows.length === 0 && kw.when.includes(`call ${KENTWOOD.clerk.phone}`));
  await page.close();

  // Shut on a phone: most readers are registered already.
  const phone = await open('/index.html', { width: 390 });
  await lookUp(phone, GR_ADDR);
  ok('in person: on a phone the card starts shut', await phone.evaluate(() => {
    const fold = document.querySelector('.vi-card-register .vi-fold');
    return !!fold && !fold.open;
  }));
  // Where no hours are published, the line saying to call sits inside the card's margin,
  // with the note under it, not against the card's edge.
  await lookUp(phone, KW_ADDR);
  const inset = await phone.evaluate(() => {
    const card = document.querySelector('.vi-card-register');
    card?.querySelector('.vi-fold')?.setAttribute('open', '');
    const left = (sel) => Math.round(card.querySelector(sel).getBoundingClientRect().left);
    return card && { card: Math.round(card.getBoundingClientRect().left),
                     hours: left('.vi-fold-body > .vi-hours'), note: left('.vi-fold-body > .pp-note') };
  });
  console.log(`[in person, phone Kentwood] ${JSON.stringify(inset)}`);
  ok('in person: on a phone, "call" lines up with the note under it',
     !!inset && inset.hours === inset.note && inset.hours > inset.card);
  await phone.close();

  const simple = await open('/simple/index.html');
  const sline = await line(simple, 'register');
  ok('in person: /simple says the same under its banner',
     sline.shown && plain(sline.text) === plain(before.text));
  await simpleLookUp(simple, GR_ADDR);
  const sgr = await readSimple(simple);
  console.log(`[in person, /simple Grand Rapids] ${JSON.stringify(sgr)}`);
  ok("in person: /simple has the city clerk's office, hours and directions",
     !!sgr && sgr.text.includes(office.address) && sgr.directions &&
     rowsMatch(sgr.rows, wantRows(clerk, election)) && sgr.link === STATE);
  await simpleLookUp(simple, KW_ADDR);
  const skw = await readSimple(simple);
  ok('in person: /simple says to call Kentwood',
     !!skw && skw.text.includes(`call ${KENTWOOD.clerk.phone}`));
  await simple.close();

  // A clerk's file with no registration block: Grand Rapids shows nothing rather than
  // the county's record, whose phone is the city's main line. Kentwood is unaffected.
  served = { ...cal, '/data/gr-clerk.json': { ...clerk, registration: null } };
  const bare = await open('/index.html');
  await lookUp(bare, GR_ADDR);
  ok('no registration in the clerk file: no card for Grand Rapids', !(await readCard(bare)));
  await lookUp(bare, KW_ADDR);
  ok('  and Kentwood still has its own', !!(await readCard(bare)));
  await bare.close();
}

// ---- by mail: thirty days out ----------------------------------------------
{
  served = pinnedCalendar(ROOT, 30);
  const until = Elections.dayMonth(iso(15));
  const page = await open('/index.html');
  const before = await line(page, 'cdReg');
  ok(`by mail: the countdown offers registering online, through ${until}`,
     before.shown && before.link === STATE && before.text.includes(until) &&
     /in person/.test(before.text));
  await lookUp(page, GR_ADDR);
  ok('by mail: no registration card', !(await readCard(page)));
  ok('by mail: and the clerk is not a destination',
     !(await picker(page)).kinds.includes('register'));
  await page.close();

  const simple = await open('/simple/index.html');
  const sline = await line(simple, 'register');
  ok('by mail: /simple says the same', sline.shown && plain(sline.text) === plain(before.text) &&
     sline.link === STATE);
  await simpleLookUp(simple, GR_ADDR);
  ok('by mail: and has no registration section', !(await readSimple(simple)));
  await simple.close();
}

// ---- election day: a minute before the polls close, and as they do ------------
{
  served = pinnedCalendar(ROOT, 0);
  const close = Elections.atTime(iso(0), POLL_HOURS.close);
  for (const [what, clock, open_] of [
    ['a minute before close', new Date(close.getTime() - 60000), true],
    ['at close', close, false],
  ]) {
    const page = await open('/index.html', { clock });
    const reg = await line(page, 'cdReg');
    ok(`election day, ${what}: the countdown ${open_ ? 'says until close today' : 'says nothing'}`,
       open_ ? reg.shown && /today/.test(reg.text) && reg.text.includes(short(POLL_HOURS.close))
             : !reg.shown);
    await lookUp(page, GR_ADDR);
    const card = await readCard(page);
    ok(`election day, ${what}: ${open_ ? 'the card reads today' : 'no card'}`,
       open_ ? !!card && card.status === `Today, until ${short(POLL_HOURS.close)}` &&
               card.rows.at(-1)?.[2] === true
             : !card);
    await page.close();

    const simple = await open('/simple/index.html', { clock });
    await simpleLookUp(simple, GR_ADDR);
    ok(`election day, ${what}: /simple ${open_ ? 'has' : 'has no'} registration section`,
       !!(await readSimple(simple)) === open_);
    await simple.close();
  }
}

await browser.close(); server.close();
console.log(`\n${fails === 0 ? 'all registration checks passed' : fails + ' FAILED'}`);
process.exit(fails ? 1 : 0);
