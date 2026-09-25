// Released into the public domain under the Unlicense, see UNLICENSE.
// Every external link in the docs, the two pages and the data provenance
// blocks, checked live. Run: node scripts/check_links.mjs [--list]
//
// The rest of the suite runs on every pull request and never touches the
// network. This one is different: it exists to notice when someone ELSE's
// page moves, which happens on their schedule rather than ours. So it runs
// weekly from .github/workflows/link-check.yml, and on demand, and never on
// a pull request. A clerk's site being down should not turn a routing change
// red, and a check that cries wolf on unrelated work is a check people learn
// to ignore.
//
// The link most likely to rot is the precinct directory PDF in polling.json.
// The clerk publishes each election's directory under a new generated
// filename; BUILD.md says what to do when it 404s, and this is what says it
// has.
//
// --list prints the URLs it would check and exits, so the set can be
// inspected without making a request.
import { readFile } from 'fs/promises';
import { fileURLToPath, pathToFileURL } from 'url';
import { join } from 'path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// The registry of every source the site reads. Named here because both the
// scan list below and isSource() need it, and a second spelling of it is a
// second thing to leave stale.
const SOURCES_REGISTRY = 'site/data/sources.json';

// Text files scanned for anything that looks like a URL. The Python scripts
// are left out on purpose: they assemble their endpoint URLs from fragments
// across several lines, and the data files' provenance blocks carry the
// same endpoints whole.
export const TEXT_FILES = [
  'README.md', 'BUILD.md', 'UNLICENSE',
  'site/index.html', 'site/simple/index.html',
  'site/app.js', 'site/simple/lookup.js', 'scripts/compare_osrm.mjs',
  // sources.json sits here, with the text, rather than below with the data,
  // because it has no provenance block to read: it IS provenance, all the
  // way down. It is the registry every data file points at with a `src` key
  // instead of repeating a publisher and a URL, which is the reason its
  // links have to be checked here -- they are where those URLs went, and
  // gr-clerk.json now carries none of its own. Scanning it whole also picks
  // up the `archived` snapshot beside each source, which is the fallback
  // when the live page rots and so is worth knowing about. Moving this name
  // into DATA_FILES would silently stop checking all of them, because that
  // loop reads one block and this file has no such block.
  SOURCES_REGISTRY,
];

// Which files make a URL a SOURCE rather than a page link: the registry and
// every data file's provenance block. The two answer different questions, so
// the run reports them apart. A page link that rots is a reader clicking
// through to a 404. A source that rots is the provenance of the data itself
// no longer resolving -- the endpoint a refresh script pulls from, or the
// citation for a row on screen -- which is the more serious of the two and
// was, until now, buried in one alphabetical list with the rest.
export const isSource = f => f === SOURCES_REGISTRY || DATA_FILES.includes(f);

// Data files whose provenance block names where the data came from. Only
// that block is read; the rest is coordinates and house numbers. Every
// site/data/*.json is listed, so a new one is a deliberate addition rather
// than an oversight: early-voting.json and gr-clerk.json were missing here
// and went unchecked until 2026-09-22. A file may carry no URL of its own
// and still belong -- gr-clerk.json names its source by `src` and leaves the
// URL to sources.json -- because what it carries is not fixed forever.
export const DATA_FILES = [
  'addresses', 'boundary', 'cameras', 'early-voting', 'elections',
  'gr-clerk', 'graph', 'landcover', 'neighbors', 'polling', 'precincts',
].map(n => `site/data/${n}.json`).concat(['site/data/precincts.geojson']);

// URLs that are not links in the sense that matters here.
const SKIP = [
  // Overpass answers a bare GET with 400 by design. The refresh scripts are
  // its real test, and they run daily.
  /\/api\/interpreter$/,
  // A URL template in compare_osrm.mjs; the host serves no page at its root.
  /router\.project-osrm\.org/,
  // The page tests' own throwaway server.
  /^https?:\/\/(127\.0\.0\.1|localhost)/,
  // An XML namespace name in lookup.js, not a page anyone links to.
  /www\.w3\.org\/2000\/svg/,
];

// An honest user agent, with the project named so a server log can tell who
// was asking. Some government hosts sit behind bot management that refuses
// anything that is not a browser, and they refuse this. That is fine, and
// classify() below says so: the alternative is claiming to be Chrome, which
// is both a lie to someone else's server and, measured against these exact
// hosts, does not work anyway, because they fingerprint the TLS handshake.
const UA = 'votegr-link-check/1.0 (+https://github.com/Cantica-Systems/votegr)';
const TIMEOUT_MS = 20000;
const RETRY_WAIT_MS = 4000;
const SPACING_MS = 300;

// What a response means. This is the whole judgement of the checker, and
// test_check_links.mjs covers nothing but this function, because it is the
// part that decides whether a run is red.
//
// Three buckets, and the rule names no host. An earlier version kept a list
// of hosts whose firewall answers with 403 and counted those as reachable,
// which does not scale: the list grows every time another agency turns on
// bot management, each entry is a link that quietly stopped being checked,
// and the growing is done by a person editing this file to clear a red run.
//
// The line that does scale is between "this page is gone" and "we could not
// find out". Only the first is worth failing on, and only three answers mean
// it: 404, 410, and a host that no longer resolves. Everything else is a
// server declining to answer us, which is not evidence about the page.
export function classify({ status, error }) {
  if (status >= 200 && status < 300) return 'ok';
  if (status === 404 || status === 410) return 'rotted';
  // A domain that stopped resolving is a dead link in the way that matters,
  // and the retry above has already ruled out a runner's momentary DNS blip.
  if (status === 0 && /ENOTFOUND/.test(error || '')) return 'rotted';
  return 'unverifiable';
}

// Stops at whitespace, quotes, brackets, backticks and `$`; the punctuation
// a sentence or a markdown link leaves stuck to the end is trimmed after.
const URL_RE = /https?:\/\/[^\s"'<>()[\]`$\\]+/g;

function urlsIn(text) {
  const out = [];
  for (const m of text.matchAll(URL_RE)) {
    // A URL cut short by `${` is a template, and its static prefix is not a
    // page: openstreetmap.org/directions?from=${...} in lookup.js.
    if (text[m.index + m[0].length] === '$') continue;
    out.push(m[0].replace(/[.,;:!?)]+$/, ''));
  }
  return out;
}

// Every string value under a JSON value, at any depth.
function strings(v, out = []) {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) v.forEach(x => strings(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach(x => strings(x, out));
  return out;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const noSlash = u => u.replace(/\/$/, '');

async function probe(url) {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'user-agent': UA,
               accept: 'text/html,application/pdf,application/json;q=0.9,*/*;q=0.8' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  // The status is the answer. Do not download a multi-megabyte PDF to learn
  // that it exists.
  if (res.body) await res.body.cancel().catch(() => {});
  return { status: res.status, finalUrl: res.url };
}

// A server having a moment (5xx, 429, a dropped connection) gets one more
// try after a pause. A 404 is an answer and is not retried; neither is a
// 403, which is a firewall's settled decision and not something a second
// request to someone else's server is going to change.
async function check(url) {
  let last;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      last = await probe(url);
      if (last.status < 500 && last.status !== 429) return last;
    } catch (e) {
      // fetch wraps network failures in a bare TypeError; the reason worth
      // printing (ENOTFOUND, ECONNREFUSED, a certificate error) is on cause.
      const why = e.cause?.code || e.cause?.message || e.name || String(e);
      last = { status: 0, error: String(why).split('\n')[0].slice(0, 80) };
    }
    if (attempt === 0) await sleep(RETRY_WAIT_MS);
  }
  return last;
}

// ---- collect ----------------------------------------------------------
// A file named above that cannot be read is reported, and the run carries on
// without it. This used to throw, and the cost was not theoretical: the list
// above still said `compare_osrm.mjs` after that file moved into scripts/ on
// 2026-09-09, so every weekly run from then on died on its first readFile and
// reported nothing at all about the other two dozen links. Noticing that
// something moved is the entire job, and a checker that cannot say what it
// found is worse than one that says a file is gone and keeps going.
//
// It is still a failure, for the same reason the per-host exemption list was
// one: a path that quietly stops being read is a set of links that quietly
// stops being checked, and only a red run gets that fixed. So it is counted
// and it sets the exit code, at the end, after the links have been reported.
export async function collect() {
  // url -> every file it was seen in, in scan order. Every, not the first:
  // a URL can be both a page link and a source -- mvic.sos.state.mi.us is
  // linked from index.html AND cited in the registry -- and first-seen alone
  // would file it under whichever list happened to be scanned first. It also
  // means a GONE line can name every place the dead link has to be fixed
  // rather than one of them.
  const foundIn = new Map();   // url -> [file, ...]
  const unreadable = [];       // [file, why], for the ones that are gone or broken
  const note = (list, file) => {
    for (const u of list) {
      if (!foundIn.has(u)) foundIn.set(u, []);
      const seen = foundIn.get(u);
      if (seen[seen.length - 1] !== file) seen.push(file);
    }
  };
  // A missing file is the case worth naming plainly. A data file whose JSON
  // no longer parses lands here too, from JSON.parse rather than readFile,
  // and it is the same problem: this script can no longer read something it
  // promised to check.
  const why = e => (e.code === 'ENOENT' ? 'no such file' : e.code || e.message);
  for (const f of TEXT_FILES) {
    try { note(urlsIn(await readFile(join(ROOT, f), 'utf8')), f); }
    catch (e) { unreadable.push([f, why(e)]); }
  }
  for (const f of DATA_FILES) {
    try {
      const doc = JSON.parse(await readFile(join(ROOT, f), 'utf8'));
      note(urlsIn(strings(doc.provenance || {}).join('\n')), f);
    } catch (e) { unreadable.push([f, why(e)]); }
  }
  for (const u of [...foundIn.keys()]) if (SKIP.some(re => re.test(u))) foundIn.delete(u);
  return { foundIn, unreadable };
}

// ---- run --------------------------------------------------------------
async function main() {
  const { foundIn, unreadable } = await collect();
  const urls = [...foundIn.keys()].sort();
  const lost = unreadable.length;
  // Two groups, reported apart, because they fail differently. A URL cited
  // as provenance anywhere counts as a source even when a page links it too:
  // of the two ways it can matter, that is the one worth reading first.
  const where = u => foundIn.get(u).join(', ');
  const GROUPS = [
    ['Sources -- where the data came from',
     urls.filter(u => foundIn.get(u).some(isSource))],
    ['Page links -- what the docs and pages point at',
     urls.filter(u => !foundIn.get(u).some(isSource))],
  ];
  const alsoLost = lost ? `, and ${lost} file${lost === 1 ? '' : 's'} it could not read` : '';

  // Printed before anything else, because it says the set below is short.
  for (const [f, why] of unreadable) console.log(`  LOST ${f}  (${why})`);
  if (lost) console.log('');

  if (process.argv.includes('--list')) {
    for (const [heading, group] of GROUPS) {
      console.log(`${heading}  (${group.length})`);
      for (const u of group) console.log(`  ${u}  (${where(u)})`);
      console.log('');
    }
    console.log(`${urls.length} links${alsoLost}`);
    return lost ? 1 : 0;
  }

  // One request at a time, spaced out: these are other people's servers, and
  // a couple of dozen links do not need to arrive all at once. A redirect is
  // not a failure, but the destination is printed, because a page that now
  // bounces to a generic front door has rotted just as surely as a 404, and
  // that is a judgement for a person reading the run.
  // Sources first, and each group's results printed as they arrive rather
  // than collected and sorted at the end: a run that dies halfway should
  // still have said what it learned.
  const counts = { ok: 0, unverifiable: 0, rotted: 0 };
  const tallies = [];
  for (const [heading, group] of GROUPS) {
    const sub = { ok: 0, unverifiable: 0, rotted: 0 };
    console.log(`${heading}  (${group.length})`);
    for (const u of group) {
      const r = await check(u);
      const bucket = classify(r);
      counts[bucket]++; sub[bucket]++;
      const what = r.status || r.error;
      if (bucket === 'ok') {
        const moved = r.finalUrl && noSlash(r.finalUrl) !== noSlash(u) ? `  -> ${r.finalUrl}` : '';
        console.log(`  ok   ${what}  ${u}${moved}`);
      } else if (bucket === 'unverifiable') {
        console.log(`  ??   ${what}  ${u}  (answered, page not verifiable)`);
      } else {
        console.log(`  GONE ${what}  ${u}  (${where(u)})`);
      }
      await sleep(SPACING_MS);
    }
    tallies.push([heading.split(' -- ')[0], group.length, sub]);
    console.log('');
  }

  console.log(`${urls.length} links: ${counts.ok} ok, ` +
              `${counts.unverifiable} unverifiable, ${counts.rotted} gone${alsoLost}`);
  for (const [name, n, sub] of tallies) {
    console.log(`  ${(name + ':').padEnd(13)}${String(n).padStart(3)} links: ` +
                `${sub.ok} ok, ${sub.unverifiable} unverifiable, ${sub.rotted} gone`);
  }
  if (counts.unverifiable && !counts.rotted && !lost) {
    console.log('Unverifiable is not a failure. Those servers declined to answer a ' +
                'non-browser client; the pages are worth an eye, not a red run.');
  }
  if (lost) {
    console.log('A file this script names but cannot read does fail the run. The set ' +
                'above is short by whatever that file held, and a path left stale by a ' +
                'rename is the same rot this check watches for, in our own tree.');
  }
  return counts.rotted || lost ? 1 : 0;
}

// Only when run, not when imported: the two test suites import classify and
// collect(), and must not make a single request to do it.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main());
}
