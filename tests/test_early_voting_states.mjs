// Released into the public domain under the Unlicense, see UNLICENSE.
// The early voting group in the answer block has four states, and only one
// of them can be reached from the committed data on any given day. So the
// states are driven here by serving a synthetic elections.json, with every
// date relative to TODAY so the fixture cannot rot into a fixed calendar,
// beside a gr-clerk.json that names no election.
//
// The state worth the whole file is "closed": after the window ends but
// before election day, the block must stop naming an early voting site. A
// reader who saw one listed last week and drives to it finds a locked door,
// and nothing else in the suite would catch that regression.
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { join, extname, normalize } from 'path';
import { Elections } from '../site/voting.js';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));   // paths below are from the repo root
const ROOT = join(process.cwd(), 'site');
// LOCAL date, the way Elections.todayISO() reckons it. toISOString() is UTC,
// and after 8pm Eastern that is already tomorrow: the "election day" case,
// which needs today exactly, then served a fixture dated a day ahead of the
// page and failed every evening. The other cases have days of slack and
// never noticed.
const iso = d => {
  const x = new Date(); x.setDate(x.getDate() + d);
  const pad = n => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
};

const SITES = JSON.parse(await readFile(join(ROOT, 'data/elections.json'), 'utf8'))
  .elections[0].early_voting_sites;
const HOURS = JSON.parse(await readFile(join(ROOT, 'data/elections.json'), 'utf8'))
  .elections[0].early_voting_hours;

// Read the statewide hours from the real file rather than restating them, so
// this fixture cannot drift from what ships if the SOS ever changes them.
const POLL_HOURS = JSON.parse(await readFile(join(ROOT, 'data/elections.json'), 'utf8'))
  .election_day_hours;

// Mirrors shortTime() in app.js on purpose: the page drops :00 on the hour
// but keeps a half hour's minutes, and a fixed '7:00 AM to 8:00 PM' string
// here would pass while the page rendered something else entirely.
const short = t => String(t).replace(/:00(?=\s*[AP]M\b)/i, '');

const base = extra => ({
  election_day_hours: POLL_HOURS,
  elections: [Object.assign({ date: iso(30), name: 'Test Election' }, extra)],
});

// ---- the last day closes when its sites do ------------------------------
// Not at midnight: at 6 PM on the last day the window is over, and a page
// that still offered a site would route a voter to a locked door. Pinned
// here with an explicit clock, in both shapes the hours arrive in: the
// clerk's per-date list (gr-clerk.json, "9 am - 5 pm") and the weekday rules
// in elections.json. 2026-11-01 is a Sunday.
{
  const at = (h, m) => new Date(2026, 10, 1, h, m);
  const byDate = { early_voting_from: '2026-10-20', early_voting_to: '2026-11-01',
                   early_voting_days: [{ date: '2026-10-31', hours: '7 am - 3 pm' },
                                       { date: '2026-11-01', hours: '9 am - 5 pm' }] };
  const byRule = { early_voting_from: '2026-10-20', early_voting_to: '2026-11-01',
                   early_voting_hours: [{ days: ['Sat', 'Sun'], open: '9:00 AM', close: '5:00 PM' },
                                        { days: ['Mon'], open: '11:00 AM', close: '7:00 PM' }] };
  const bare = { early_voting_from: '2026-10-20', early_voting_to: '2026-11-01' };
  const cases = [
    ['per-date hours, a minute before close', byDate, '2026-11-01', at(16, 59), 'open'],
    ['per-date hours, at close', byDate, '2026-11-01', at(17, 0), 'closed'],
    ['per-date hours, the evening before', byDate, '2026-10-31', new Date(2026, 9, 31, 23, 0), 'open'],
    ['weekday rules, a minute before close', byRule, '2026-11-01', at(16, 59), 'open'],
    ['weekday rules, at close', byRule, '2026-11-01', at(17, 0), 'closed'],
    ['no hours: open until the day ends', bare, '2026-11-01', at(23, 59), 'open'],
    ['the day after, whatever the hours', bare, '2026-11-02', at(9, 0), 'closed'],
  ];
  for (const [what, e, today, now, want] of cases) {
    const got = Elections.windowState(e, today, now);
    console.log((got === want ? '  ok  ' : '  FAIL') + `  last day: ${what} (${got})`);
    if (got !== want) process.exitCode = 1;
  }
}

// A clock time the given minutes from now, in the clerk's "9 am - 5 pm" style,
// or null when that would cross midnight and land on another day.
const clerkTime = (mins) => {
  const now = new Date(), t = new Date(now.getTime() + mins * 60000);
  if (t.getDate() !== now.getDate()) return null;
  const h = t.getHours() % 12 || 12;
  return `${h}:${String(t.getMinutes()).padStart(2, '0')} ${t.getHours() < 12 ? 'am' : 'pm'}`;
};
const lastDay = (mins) => {
  const close = clerkTime(mins);
  return close && base({ early_voting_from: iso(-3), early_voting_to: iso(0),
                         early_voting_sites: SITES,
                         early_voting_days: [{ date: iso(0), hours: `12:00 am - ${close}` }] });
};

// off: the window has ended, so the row is shown disabled, and early voting
// is offered nowhere a reader could pick it: not as a routable cell, not in
// the directions picker, not as a site on the map. Undated sites ('none')
// draw no row at all and are not offered either, since nothing says when
// they take ballots. Before the window opens the sites ARE offered, so a
// trip can be planned ahead, with the opening day said wherever one is
// picked (upcoming: below); the ORDER_CASES further down check that one is
// never the default destination.
const CASES = [
  ['open',     base({ early_voting_from: iso(-2), early_voting_to: iso(2),
                      early_voting_sites: SITES, early_voting_hours: HOURS }),
   { label: /early voting open/i, site: true, off: false }],
  ['closed',   base({ early_voting_from: iso(-10), early_voting_to: iso(-2),
                      early_voting_sites: SITES, early_voting_hours: HOURS }),
   { label: /early voting closed/i, site: true, off: true, note: /has ended/i }],
  ['last day, before its sites close', lastDay(30),
   { label: /early voting open/i, site: true, off: false }],
  ['last day, after its sites closed', lastDay(-1),
   { label: /early voting closed/i, site: true, off: true, note: /has ended/i }],
  ['upcoming', base({ early_voting_from: iso(5), early_voting_to: iso(10),
                      early_voting_sites: SITES, early_voting_hours: HOURS }),
   { label: /early voting dates/i, site: true, off: false, note: /not opened yet/i,
     upcoming: true }],
  ['none',     base({ early_voting_sites: SITES }),
   { label: null, site: false, off: false }],
].filter(([name, data]) => {
  // The two last-day cases need a close time on today's date; within a
  // minute or half an hour of midnight there is none, so they sit out.
  if (!data) console.log(`  skip  ${name}: too near midnight to place a close time today`);
  return !!data;
});

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.geojson': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml' };

// Both pages take the early voting window from gr-clerk.json whenever it
// names the active election (see pinned_calendar.mjs), so the real file would
// override the fixture on the day iso(30) lands on its election date. Served
// naming none, the fixture decides every state on every day. Not a 404:
// Grand Rapids' drop boxes come from this file too.
const CLERK = { ...JSON.parse(await readFile(join(ROOT, 'data/gr-clerk.json'), 'utf8')),
                election: null };

let current = null, clerkFile = CLERK;
const server = createServer(async (req, res) => {
  const rel = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  if (rel === '/data/elections.json' || rel === '/data/gr-clerk.json') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(rel === '/data/gr-clerk.json' ? clerkFile : current)); return;
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
const URL_ = 'http://127.0.0.1:' + server.address().port + '/index.html';

const browser = await chromium.launch();
let fails = 0;
const ok = (n, c) => { console.log((c ? '  ok  ' : '  FAIL') + '  ' + n); if (!c) fails++; };

for (const [name, data, want] of CASES) {
  current = data;
  const page = await browser.newPage();
  await page.goto(URL_, { waitUntil: 'networkidle' });
  await page.fill('#addr', '300 Monroe Ave NW');
  await page.press('#addr', 'Enter');
  await page.waitForSelector('#precinctInfo .vi-lbl', { timeout: 10000 });

  const hours = await page.evaluate(() =>
    (document.querySelector('#precinctInfo .vi-when-polling .vi-hours') || {}).textContent || null);

  const got = await page.evaluate(() => {
    // The row, by name. Three rows now share one shape -- drop box, early
    // voting, election day -- so "the cell with the live accent" no longer
    // identifies this one: the drop box carries it too while it is accepting
    // ballots.
    const cell = document.querySelector('#precinctInfo .vi-when-early');
    if (!cell) return { label: null, site: false, status: null };
    // Both where-cells hold a .pp-name; .vi-ev-site is what separates the
    // early voting site from the polling place.
    return { label: (cell.querySelector('.vi-lbl') || {}).textContent.trim(),
             status: (cell.querySelector('.vi-val') || {}).textContent || null,
             site: !!document.querySelector('.vi-ev-site .pp-name'),
             note: (cell.querySelector('.pp-note') || {}).textContent || null,
             where: (document.querySelector('.vi-ev-site') || {}).textContent || '' };
  });

  // Where a reader could pick early voting. The map's site markers land after
  // the route, so the count waits for the drop boxes, which are drawn in the
  // same pass: without that, "no early voting site on the map" would pass on
  // a map not drawn yet. The open cases are the control that early ones show.
  await page.waitForFunction(() => document.querySelectorAll('#map .site-dropbox').length > 0,
                             null, { timeout: 15000 }).catch(() => {});
  const pick = await page.evaluate(() => ({
    routable: !!document.querySelector('#precinctInfo [data-kind="early"]'),
    picker: [...document.querySelectorAll('#destPick button')].map(b => b.dataset.kind),
    markers: document.querySelectorAll('#map .site-dropbox').length
      ? document.querySelectorAll('#map .site-early').length : null,
    disabled: !!document.querySelector('#precinctInfo .vi-when-early.is-off') &&
              !!document.querySelector('#precinctInfo .vi-ev-site.is-off'),
  }));

  console.log(`\n[${name}] label=${JSON.stringify(got.label)} status=${JSON.stringify(got.status)} site=${got.site} pollHours=${JSON.stringify(hours)} pick=${JSON.stringify(pick)}`);
  // Statewide and statutory, so it shows in every state including the ones
  // where no early voting group renders at all.
  // Pins the "Hours:" label as well as the value: the label is the point of
  // the field, and an unlabeled time is what this replaced.
  ok(`${name}: election day hours shown, labeled`,
     hours === `Hours: ${short(POLL_HOURS.open)} to ${short(POLL_HOURS.close)}`);
  ok(`${name}: label`, want.label === null ? got.label === null
                                           : !!(got.label && want.label.test(got.label)));
  ok(`${name}: site ${want.site ? 'shown' : 'withheld'}`, got.site === want.site);
  ok(`${name}: ${want.off ? 'shown disabled' : 'not disabled'}`, pick.disabled === want.off);
  if (want.note) {
    ok(`${name}: the note sits with the dates`, want.note.test(got.note || ''));
    ok(`${name}: and not in the site cell`, !want.note.test(got.where));
  }
  if (!want.site || want.off) {
    ok(`${name}: no early voting cell to route to`, !pick.routable);
    ok(`${name}: not in the directions picker`, !pick.picker.includes('early'));
    ok(`${name}: no early voting site on the map`, pick.markers === 0);
  } else {
    ok(`${name}: routable, in the picker and on the map`,
       pick.routable && pick.picker.includes('early') && pick.markers > 0);

    // "Show all locations" lists every site, nearest first, with the nearest
    // already chosen; picking another routes there. Before the window the
    // list says the day it opens, and an open window's list does not.
    // Looked up rather than clicked blind, so a missing button is a FAIL
    // line and not a timeout that stops the suite.
    const btn = await page.$('#evListBtn');
    ok(`${name}: a "Show all locations" button`,
       !!btn && (await btn.textContent()).trim() === 'Show all locations');
    if (!btn) { await page.close(); continue; }
    await btn.click();
    const list = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#placeModalBody li[data-pick]')];
      const mi = (li) => parseFloat(li.querySelector('.bx-dist')?.textContent);
      return { n: rows.length, dists: rows.map(mi),
               chosen: rows.findIndex((li) => li.classList.contains('is-chosen')),
               second: rows[1]?.querySelector('.bx-name')?.firstChild?.textContent || null,
               lead: (document.querySelector('#placeModalBody .bx-lead') || {}).textContent || '' };
    });
    ok(`${name}: "Show all locations" lists every site`, list.n === SITES.length);
    ok(`${name}: nearest first`,
       list.dists.every((d, i) => i === 0 || d >= list.dists[i - 1]));
    ok(`${name}: with the nearest already chosen`, list.chosen === 0);
    ok(`${name}: ${want.upcoming ? 'and says the day it opens' : 'with no "not open yet" line'}`,
       want.upcoming ? /not open yet/i.test(list.lead) && /\d/.test(list.lead) : !list.lead);
    await page.click('#placeModalBody li[data-pick="1"]');
    await page.waitForFunction(() => document.getElementById('placeModal').hidden, null,
                               { timeout: 5000 }).catch(() => {});
    const after = await page.evaluate(() => ({
      name: (document.querySelector('.vi-ev-site .pp-name') || {}).textContent || null,
      on: (document.querySelector('#destPick button.on') || {}).dataset?.kind || null,
    }));
    ok(`${name}: picking another site routes there`,
       after.on === 'early' && !!list.second && after.name === list.second);
  }
  await page.close();

  // /simple has no picker or map; its early block lists the sites. Before the
  // window opens it lists them grayed and with no Directions link.
  if (name === 'upcoming' || name === 'open') {
    const simple = await browser.newPage();
    await simple.goto(URL_.replace('/index.html', '/simple/index.html'), { waitUntil: 'networkidle' });
    await simple.fill('#addr', '300 Monroe Ave NW');
    await simple.press('#addr', 'Enter');
    await simple.waitForSelector('#result .card', { timeout: 10000 });
    const ev = await simple.evaluate(() => {
      const b = document.querySelector('#result .ev-early');
      return b && { off: b.classList.contains('is-off'),
                    sites: b.querySelectorAll('.ev-site').length,
                    links: b.querySelectorAll('.ev-site a').length };
    });
    await simple.close();
    const grayed = name === 'upcoming';
    ok(`${name}: /simple lists the sites${grayed ? ', grayed, with no Directions' : ' with Directions'}`,
       !!ev && ev.sites > 0 && ev.off === grayed && (grayed ? ev.links === 0 : ev.links > 0));
  }
}
current = CASES.find(([n]) => n === 'open')[1];
for (const theme of ['dark', 'light']) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.addInitScript(t => localStorage.setItem('theme', t), theme);
  await page.goto(URL_, { waitUntil: 'networkidle' });
  await page.fill('#addr', '300 Monroe Ave NW');
  await page.press('#addr', 'Enter');
  // The hours sit with the dates, as election day's do, not folded away under the note.
  await page.waitForSelector('#precinctInfo .vi-card-early summary .ev-hours', { timeout: 10000 });
  const x = await page.evaluate(() => {
    const card = document.querySelector('#precinctInfo .vi-card-early');
    const left = s => Math.round(card.querySelector(s).getBoundingClientRect().left);
    return { card: Math.round(card.getBoundingClientRect().left),
             dates: left('summary .vi-val'), hours: left('summary .ev-hours') };
  });
  console.log(`\n[phone, ${theme}] card=${x.card} dates=${x.dates} hours=${x.hours}`);
  ok(`phone, ${theme}: the hours line up under the dates`, x.hours === x.dates);
  ok(`phone, ${theme}: and are inset from the card's edge`, x.hours > x.card);
  await page.close();
}
// ---- the clerk's own hours, date by date ---------------------------------
// Grand Rapids lists every date with its hours, and they are not a weekly
// pattern: in November 2026 one Saturday runs 9 to 5 and the next 7 to 3.
// Served naming the fixture election, so both pages take the window from it.
// Today keeps hours of its own, and tomorrow's weekday differs from the same
// weekday six days ago, so the rows must fold the steady weekdays and list
// that one by date. Expected labels are built here, not by voting.js.
{
  const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = (d) => { const x = new Date(); x.setDate(x.getDate() + d); return x; };
  const dated = (d) => `${WD[day(d).getDay()]}, ${MON[day(d).getMonth()]} ${day(d).getDate()}`;
  const days = [];
  for (let d = -6; d <= 6; d++) {
    days.push({ date: iso(d),
                hours: d === 0 ? '7 am - 3 pm' : d === 1 ? '11 am - 7 pm' : '9 am - 5 pm' });
  }
  current = base({});
  clerkFile = { ...CLERK, election: iso(30),
                early_voting: { from: iso(-6), to: iso(6), days } };
  const want = { rows: 4, today: `${WD[day(0).getDay()]} (today)`, todayHours: '7 AM to 3 PM',
                 split: [[dated(-6), '9 AM to 5 PM'], [dated(1), '11 AM to 7 PM']] };
  // [label, hours, marked today] per row, read in the page.
  const read = (cells) => {
    const spans = [...document.querySelectorAll(cells)];
    const rows = [];
    for (let i = 0; i + 1 < spans.length; i += 2) {
      rows.push([spans[i].textContent.trim(), spans[i + 1].textContent.trim(),
                 spans[i].classList.contains('is-today')]);
    }
    return rows;
  };
  const check = (where, rows) => {
    console.log(`\n[clerk hours, ${where}] ${JSON.stringify(rows)}`);
    ok(`clerk hours, ${where}: one row per steady weekday set, the split weekday by date`,
       rows.length === want.rows);
    const marked = rows.filter((r) => r[2]);
    ok(`clerk hours, ${where}: today marked, with its own hours`,
       marked.length === 1 && marked[0][0] === want.today && marked[0][1] === want.todayHours);
    ok(`clerk hours, ${where}: a weekday whose hours change is listed by date`,
       want.split.every(([label, hours]) => rows.some((r) => r[0] === label && r[1] === hours)));
  };

  const page = await browser.newPage();
  await page.goto(URL_, { waitUntil: 'networkidle' });
  await page.fill('#addr', '300 Monroe Ave NW');
  await page.press('#addr', 'Enter');
  await page.waitForSelector('#precinctInfo .vi-when-early .ev-hours', { timeout: 10000 })
    .catch(() => {});
  check('main page', await page.evaluate(read, '#precinctInfo .ev-rows > span'));
  await page.close();

  const simple = await browser.newPage();
  await simple.goto(URL_.replace('/index.html', '/simple/index.html'), { waitUntil: 'networkidle' });
  await simple.fill('#addr', '300 Monroe Ave NW');
  await simple.press('#addr', 'Enter');
  await simple.waitForSelector('#result .ev-early .ev-hours', { timeout: 10000 }).catch(() => {});
  check('/simple', await simple.evaluate(read, '#result .ev-early .ev-hours span'));
  await simple.close();
  clerkFile = CLERK;
}

// ---- which way of voting leads, and which is highlighted -----------------
// Two separate questions, each a function of the date, so each case pins both.
//
// The ROUTED default is the one a reader gets by doing nothing, read off the
// picker rather than the card, since that half is what saves a wrong trip.
// While absentee ballots are out it is the drop box, and that covers every
// early voting window, since ballots go out 40 days before the election. On
// election day itself the answer stops being a menu: early voting has closed
// and a drop box is a race against the same 8pm the polls close at, so the
// polling place leads the card and the directions point at it. Before
// ballots go out the polls lead the picker, though the drop box still heads
// the card.
//
// The HIGHLIGHT marks the way of voting in person that is happening now:
// early voting while a site is taking ballots (inside the window and today's
// published hours, so not in the evening), the polling place on election day
// and on no other day. Read at desktop width (.vi-when and its .vi-where), at phone width
// (.vi-card, which folds) and on /simple (its badge), so the three cannot
// disagree.
// Election day is three states by the clock, so each is held at a time of its own, an
// hour either side of the statewide hours: the polls badged "Today" before they open and
// "Open now" while they are, and nothing green once they have closed.
const pollsAt = (clock, minutes) =>
  new Date(Elections.atTime(iso(0), clock).getTime() + minutes * 60000);
const onTheDay = {
  data: base({ date: iso(0), early_voting_from: iso(-10), early_voting_to: iso(-2),
               early_voting_sites: SITES, early_voting_hours: HOURS }),
  order: ['polling', 'dropbox'], routed: /^election day$/i,
};
const earlyOpen = {
  data: base({ date: iso(10), early_voting_from: iso(-2), early_voting_to: iso(2),
               early_voting_sites: SITES,
               early_voting_days: [-2, -1, 0, 1, 2].map((d) => ({ date: iso(d), hours: '9 am - 5 pm' })) }),
  order: ['dropbox', 'early', 'polling'], routed: /^drop box$/i,
};
const ORDER_CASES = [
  { ...onTheDay, name: 'election day, before the polls open',
    clock: pollsAt(POLL_HOURS.open, -60), now: ['polling'], badges: ['Today'] },
  { ...onTheDay, name: 'election day, polls open',
    clock: pollsAt(POLL_HOURS.open, 60), now: ['polling'], badges: ['Open now'] },
  { ...onTheDay, name: 'election day, polls closed',
    clock: pollsAt(POLL_HOURS.close, 30), now: [], badges: [] },
  // Held at a time of day either side of today's published hours, 9 to 5.
  { ...earlyOpen, name: 'early voting open, during its hours',
    clock: Elections.atTime(iso(0), '12:00 PM'), now: ['early'], badges: ['Open now'] },
  { ...earlyOpen, name: 'early voting open, after its hours',
    clock: Elections.atTime(iso(0), '8:00 PM'), now: [], badges: [] },
  { name: 'a month out',
    data: base({ date: iso(30), early_voting_from: iso(5), early_voting_to: iso(10),
                 early_voting_sites: SITES, early_voting_hours: HOURS }),
    order: ['dropbox', 'early', 'polling'], routed: /^drop box$/i, now: [], badges: [] },
  // Early voting is offered ahead of its window, and is still not where the
  // directions point: the polls lead the picker until ballots go out.
  { name: 'before ballots go out',
    data: base({ date: iso(60), early_voting_from: iso(45), early_voting_to: iso(50),
                 early_voting_sites: SITES, early_voting_hours: HOURS }),
    order: ['dropbox', 'early', 'polling'], routed: /^election day$/i, now: [], badges: [] },
];

// The kinds whose dates are highlighted, by the row's own class name.
const nowKinds = (sel, prefix) => [...document.querySelectorAll(sel)]
  .map(e => [...e.classList].find(c => c.startsWith(prefix)).slice(prefix.length));

for (const { name, data, clock, order: wantOrder, routed: routedWant, now, badges } of ORDER_CASES) {
  current = data;
  const electionDay = wantOrder[0] === 'polling';
  const openPage = async (opts) => {
    const p = await browser.newPage(opts);
    if (clock) await p.clock.setFixedTime(clock);
    return p;
  };
  const page = await openPage();
  await page.goto(URL_, { waitUntil: 'networkidle' });
  await page.fill('#addr', '300 Monroe Ave NW');
  await page.press('#addr', 'Enter');
  await page.waitForSelector('#precinctInfo .vi-lbl', { timeout: 10000 });

  const order = await page.evaluate(() =>
    [...document.querySelectorAll('#precinctInfo .vi-where[data-kind]')]
      .map(el => el.dataset.kind));
  const routed = await page.waitForFunction(() => {
    const on = document.querySelector('#destPick button.on, #destPick button[aria-pressed="true"]');
    return on ? on.textContent.trim() : null;
  }, null, { timeout: 15000 }).then(h => h.jsonValue()).catch(() => null);
  const lit = await page.evaluate(`(${nowKinds})('#precinctInfo .vi-when.is-now', 'vi-when-')`);
  // The badge's words, and which headings are green: --good, read from the page, so a
  // theme change cannot leave this comparing against a stale color.
  const mainBadges = await page.evaluate(() =>
    [...document.querySelectorAll('#precinctInfo .vi-when .vi-now')].map(e => e.textContent));
  const greenHeads = await page.evaluate(() => {
    const probe = document.createElement('span');
    probe.style.color = getComputedStyle(document.documentElement).getPropertyValue('--good');
    document.body.append(probe);
    const good = getComputedStyle(probe).color;
    probe.remove();
    return [...document.querySelectorAll('#precinctInfo .vi-when')]
      .filter((w) => getComputedStyle(w.querySelector('.vi-lbl')).color === good)
      .map((w) => [...w.classList].find((c) => c.startsWith('vi-when-')).slice('vi-when-'.length));
  });
  // The place beside those dates goes green with them: the bar, the dates' own tint and a
  // green heading. Read from computed style, so a rule that loses to the routed pick's
  // ring (the polls on election day) fails here and not on a voter's screen.
  const greenPlaces = await page.evaluate(() => {
    const probe = document.createElement('span');
    probe.style.color = getComputedStyle(document.documentElement).getPropertyValue('--good');
    document.body.append(probe);
    const good = getComputedStyle(probe).color;
    probe.remove();
    return [...document.querySelectorAll('#precinctInfo .vi-where[data-kind]')]
      .filter((w) => {
        const s = getComputedStyle(w), when = w.nextElementSibling;
        return s.boxShadow.includes(good) &&
          !!when?.classList.contains('vi-when') &&
          s.backgroundColor === getComputedStyle(when).backgroundColor &&
          getComputedStyle(w.querySelector('.vi-lbl')).color === good;
      })
      .map((w) => w.dataset.kind);
  });

  // On the day, the banner counts the polls rather than the day: one of
  // three labels, hours-minutes-seconds with no Days unit, and the sentence
  // under it names a poll time rather than a date. Which of the three
  // depends on the clock this runs at, so all three are accepted and the
  // old "Election Day is In:" is not.
  const banner = await page.evaluate(() => ({
    label: document.getElementById('cdLabel').textContent.trim(),
    units: [...document.querySelectorAll('#cdClock .cd-lab')].map((e) => e.textContent),
    said: document.getElementById('cdSaid').textContent,
  }));
  if (electionDay) {
    ok(`${name}: the banner counts the polls (${banner.label})`,
       /^Polls (Open In|Close In|Have Closed):$/.test(banner.label));
    ok(`${name}: with no Days unit`, !banner.units.includes('Days'));
    ok(`${name}: and says when the polls open, close, or that they have`,
       /7 AM|8 PM|in line/.test(banner.said));
  } else {
    ok(`${name}: away from the day it counts to the day`,
       banner.label === 'Election Day is In:' && banner.units[0] === 'Days');
  }
  await page.close();

  // At phone width the rows are folding cards, and the card carries the mark.
  const phone = await openPage({ viewport: { width: 390, height: 844 } });
  await phone.goto(URL_, { waitUntil: 'networkidle' });
  await phone.fill('#addr', '300 Monroe Ave NW');
  await phone.press('#addr', 'Enter');
  await phone.waitForSelector('#precinctInfo .vi-card', { timeout: 10000 });
  const litPhone = await phone.evaluate(`(${nowKinds})('#precinctInfo .vi-card.is-now', 'vi-card-')`);
  // Inside a card the place stays unpainted: the card is already green.
  const phonePainted = await phone.evaluate(() =>
    [...document.querySelectorAll('#precinctInfo .vi-card .vi-where')]
      .filter((w) => getComputedStyle(w).backgroundColor !== 'rgba(0, 0, 0, 0)').length);
  await phone.close();

  // /simple reads the same calendar and the same hours, and must say the
  // same thing about the polls on the day, in its own single line.
  const simple = await openPage();
  await simple.goto(URL_.replace('/index.html', '/simple/index.html'), { waitUntil: 'networkidle' });
  await simple.waitForFunction(() => !document.getElementById('election').hidden, null, { timeout: 15000 });
  const line = await simple.evaluate(() => document.getElementById('election').textContent);
  await simple.fill('#addr', '300 Monroe Ave NW');
  await simple.press('#addr', 'Enter');
  await simple.waitForSelector('#result .card', { timeout: 10000 });
  const simpleBadges = await simple.evaluate(() =>
    [...document.querySelectorAll('#result .now-badge')].map(e => e.textContent));
  // The badged heading is green, as on the map page, and no other heading is.
  const simpleGreen = await simple.evaluate(() => {
    const probe = document.createElement('span');
    probe.style.color = getComputedStyle(document.documentElement).getPropertyValue('--good');
    document.body.append(probe);
    const good = getComputedStyle(probe).color;
    probe.remove();
    return [...document.querySelectorAll('#result .lead-2')]
      .filter((h) => getComputedStyle(h).color === good)
      .map((h) => h.querySelector('.now-badge')?.textContent || 'unbadged');
  });
  await simple.close();
  if (electionDay) {
    ok(`${name}: /simple counts the polls too (${line.slice(0, 22).trim()})`,
       /^Polls (open in \d+:\d\d:\d\d|close in \d+:\d\d:\d\d|have closed)/.test(line));
  } else {
    ok(`${name}: /simple names the next election away from the day`, /^Next election:/.test(line));
  }

  console.log(`\n[${name}] order=${JSON.stringify(order)} routed=${JSON.stringify(routed)} ` +
              `lit=${JSON.stringify(lit)} litPhone=${JSON.stringify(litPhone)} ` +
              `simple=${JSON.stringify(simpleBadges)}`);
  ok(`${name}: card order`, JSON.stringify(order) === JSON.stringify(wantOrder));
  ok(`${name}: directions already point at the ${routedWant.source.replace(/[$^]/g, '')}`,
     !!routed && routedWant.test(routed));
  ok(`${name}: highlighted ${now.join(', ') || 'nothing'}`,
     JSON.stringify(lit) === JSON.stringify(now));
  ok(`${name}: and its place green beside it`, JSON.stringify(greenPlaces) === JSON.stringify(now));
  ok(`${name}: and the same at phone width`, JSON.stringify(litPhone) === JSON.stringify(now));
  ok(`${name}: with no place painted again inside its card`, phonePainted === 0);
  ok(`${name}: badged ${badges.join(', ') || 'nowhere'}`,
     JSON.stringify(mainBadges) === JSON.stringify(badges));
  ok(`${name}: with a green heading on ${now.join(', ') || 'nothing'}`,
     JSON.stringify(greenHeads) === JSON.stringify(now));
  ok(`${name}: and on /simple`, JSON.stringify(simpleBadges) === JSON.stringify(badges));
  ok(`${name}: with /simple's badged heading green, and only that one`,
     JSON.stringify(simpleGreen) === JSON.stringify(badges));
}

await browser.close(); server.close();
if (process.exitCode) fails++;
console.log(`\n${fails === 0 ? 'all state checks passed' : fails + ' FAILED'}`);
process.exit(fails ? 1 : 0);
