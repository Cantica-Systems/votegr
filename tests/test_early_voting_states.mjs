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

// off: the window has not opened or has ended, so the row is shown disabled.
// Outside an open window early voting is offered nowhere a reader could pick
// it: not as a routable cell, not in the directions picker, not as a site on
// the map. Undated sites ('none') draw no row at all and are not offered
// either, since nothing says when they take ballots.
const CASES = [
  ['open',     base({ early_voting_from: iso(-2), early_voting_to: iso(2),
                      early_voting_sites: SITES, early_voting_hours: HOURS }),
   { label: /early voting open/i, site: true, off: false }],
  ['closed',   base({ early_voting_from: iso(-10), early_voting_to: iso(-2),
                      early_voting_sites: SITES, early_voting_hours: HOURS }),
   { label: /early voting closed/i, site: false, off: true }],
  ['last day, before its sites close', lastDay(30),
   { label: /early voting open/i, site: true, off: false }],
  ['last day, after its sites closed', lastDay(-1),
   { label: /early voting closed/i, site: false, off: true }],
  ['upcoming', base({ early_voting_from: iso(5), early_voting_to: iso(10),
                      early_voting_sites: SITES, early_voting_hours: HOURS }),
   { label: /early voting dates/i, site: false, off: true }],
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

let current = null;
const server = createServer(async (req, res) => {
  const rel = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  if (rel === '/data/elections.json' || rel === '/data/gr-clerk.json') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(rel === '/data/gr-clerk.json' ? CLERK : current)); return;
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
    (document.querySelector('#precinctInfo .vi-hours') || {}).textContent || null);

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
             site: !!document.querySelector('.vi-ev-site .pp-name') };
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
  // the field, and an unlabelled time is what this replaced.
  ok(`${name}: election day hours shown, labelled`,
     hours === `Hours: ${short(POLL_HOURS.open)} to ${short(POLL_HOURS.close)}`);
  ok(`${name}: label`, want.label === null ? got.label === null
                                           : !!(got.label && want.label.test(got.label)));
  ok(`${name}: site ${want.site ? 'shown' : 'withheld'}`, got.site === want.site);
  ok(`${name}: ${want.off ? 'shown disabled' : 'not disabled'}`, pick.disabled === want.off);
  if (!want.site) {
    ok(`${name}: no early voting cell to route to`, !pick.routable);
    ok(`${name}: not in the directions picker`, !pick.picker.includes('early'));
    ok(`${name}: no early voting site on the map`, pick.markers === 0);
  } else if (want.site) {
    ok(`${name}: routable, in the picker and on the map`,
       pick.routable && pick.picker.includes('early') && pick.markers > 0);
  }
  await page.close();

  // /simple has no picker or map; its early block lists the sites. Before the
  // window opens it lists them greyed and with no Directions link.
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
    const greyed = name === 'upcoming';
    ok(`${name}: /simple lists the sites${greyed ? ', greyed, with no Directions' : ' with Directions'}`,
       !!ev && ev.sites > 0 && ev.off === greyed && (greyed ? ev.links === 0 : ev.links > 0));
  }
}
current = CASES.find(([n]) => n === 'open')[1];
for (const theme of ['dark', 'light']) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.addInitScript(t => localStorage.setItem('theme', t), theme);
  await page.goto(URL_, { waitUntil: 'networkidle' });
  await page.fill('#addr', '300 Monroe Ave NW');
  await page.press('#addr', 'Enter');
  await page.waitForSelector('#precinctInfo .vi-fold-body > .ev-hours-lbl', { timeout: 10000 });
  const x = await page.evaluate(() => {
    const body = document.querySelector('#precinctInfo .vi-fold-body > .ev-hours-lbl').parentElement;
    const left = s => Math.round(body.querySelector(s).getBoundingClientRect().left);
    return { card: Math.round(body.closest('.vi-card').getBoundingClientRect().left),
             label: left('.ev-hours-lbl'), line: left('.ev-hours span') };
  });
  console.log(`\n[phone, ${theme}] card=${x.card} label=${x.label} hours=${x.line}`);
  ok(`phone, ${theme}: "Hours:" lines up with the hours under it`, x.label === x.line);
  ok(`phone, ${theme}: and is inset from the card's edge`, x.label > x.card);
  await page.close();
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
// The HIGHLIGHT marks the way of voting in person that is happening today:
// early voting while its window is open, the polling place on election day
// and on no other day. Read at desktop width (.vi-when), at phone width
// (.vi-card, which folds) and on /simple (its badge), so the three cannot
// disagree.
const ORDER_CASES = [
  { name: 'election day',
    data: base({ date: iso(0), early_voting_from: iso(-10), early_voting_to: iso(-2),
                 early_voting_sites: SITES, early_voting_hours: HOURS }),
    order: ['polling', 'dropbox'], routed: /^election day$/i, now: ['polling'],
    badges: ['Today'] },
  { name: 'early voting open',
    data: base({ date: iso(10), early_voting_from: iso(-2), early_voting_to: iso(2),
                 early_voting_sites: SITES, early_voting_hours: HOURS }),
    order: ['dropbox', 'early', 'polling'], routed: /^drop box$/i, now: ['early'],
    badges: ['Open now'] },
  { name: 'a month out',
    data: base({ date: iso(30), early_voting_from: iso(5), early_voting_to: iso(10),
                 early_voting_sites: SITES, early_voting_hours: HOURS }),
    order: ['dropbox', 'polling'], routed: /^drop box$/i, now: [], badges: [] },
  { name: 'before ballots go out',
    data: base({ date: iso(60), early_voting_from: iso(45), early_voting_to: iso(50),
                 early_voting_sites: SITES, early_voting_hours: HOURS }),
    order: ['dropbox', 'polling'], routed: /^election day$/i, now: [], badges: [] },
];

// The kinds whose dates are highlighted, by the row's own class name.
const nowKinds = (sel, prefix) => [...document.querySelectorAll(sel)]
  .map(e => [...e.classList].find(c => c.startsWith(prefix)).slice(prefix.length));

for (const { name, data, order: wantOrder, routed: routedWant, now, badges } of ORDER_CASES) {
  current = data;
  const electionDay = wantOrder[0] === 'polling';
  const page = await browser.newPage();
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
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await phone.goto(URL_, { waitUntil: 'networkidle' });
  await phone.fill('#addr', '300 Monroe Ave NW');
  await phone.press('#addr', 'Enter');
  await phone.waitForSelector('#precinctInfo .vi-card', { timeout: 10000 });
  const litPhone = await phone.evaluate(`(${nowKinds})('#precinctInfo .vi-card.is-now', 'vi-card-')`);
  await phone.close();

  // /simple reads the same calendar and the same hours, and must say the
  // same thing about the polls on the day, in its own single line.
  const simple = await browser.newPage();
  await simple.goto(URL_.replace('/index.html', '/simple/index.html'), { waitUntil: 'networkidle' });
  await simple.waitForFunction(() => !document.getElementById('election').hidden, null, { timeout: 15000 });
  const line = await simple.evaluate(() => document.getElementById('election').textContent);
  await simple.fill('#addr', '300 Monroe Ave NW');
  await simple.press('#addr', 'Enter');
  await simple.waitForSelector('#result .card', { timeout: 10000 });
  const simpleBadges = await simple.evaluate(() =>
    [...document.querySelectorAll('#result .now-badge')].map(e => e.textContent));
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
  ok(`${name}: and the same at phone width`, JSON.stringify(litPhone) === JSON.stringify(now));
  ok(`${name}: and on /simple`, JSON.stringify(simpleBadges) === JSON.stringify(badges));
}

await browser.close(); server.close();
if (process.exitCode) fails++;
console.log(`\n${fails === 0 ? 'all state checks passed' : fails + ' FAILED'}`);
process.exit(fails ? 1 : 0);
