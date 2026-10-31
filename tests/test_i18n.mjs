// Released into the public domain under the Unlicense, see UNLICENSE.
// The translations. Run: node tests/test_i18n.mjs
//
// First without a browser: every key the code and the markup use has a translation in
// every language, every {slot} in a translation is one the English fills, and nothing in
// a catalog is left over from text that no longer exists. Then in a browser: the page
// opens in Spanish from ?lang=es and from a Spanish-speaking browser, answers an address
// in Spanish, and the switch goes back to English and remembers it.
//
// Keys are found as string literals in t('...') calls, so every call must pass its key as
// a literal: t(n === 1 ? 'a' : 'b') would hide both from this test. Election names come
// from elections.json, which app.js translates through t(activeEl.name).
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { readFileSync, readdirSync } from 'fs';
import { join, extname, normalize } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const ROOT = join(fileURLToPath(new URL('..', import.meta.url)), 'site');

let pass = 0, fail = 0;
function ok(name, cond, detail = '') {
  cond ? (pass++, console.log('  ok  ' + name))
       : (fail++, console.log('  FAIL ' + name + (detail ? '  ' + detail : '')));
}

// ---- Keys ----
const CODE = ['app.js', 'map.js'];
const used = new Set();
for (const f of CODE) {
  const src = readFileSync(join(ROOT, f), 'utf8');
  for (const m of src.matchAll(/(?<![\w.$])t\(\s*('(?:[^'\\]|\\.)*')/g)) {
    used.add(Function(`return ${m[1]}`)());
  }
  const loose = [...src.matchAll(/(?<![\w.$])t\((?!\s*')([^)]*)/g)]
    .map((m) => m[1]).filter((a) => a.trim() !== 'activeEl.name');
  ok(`${f}: every t() key is a literal this test can read`, !loose.length, loose.join(' | '));
}
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
for (const m of html.matchAll(/data-i18n(?:-[a-z-]+)?="(#[a-z_]+)"/g)) used.add(m[1]);
const calendar = JSON.parse(readFileSync(join(ROOT, 'data/elections.json'), 'utf8'));
for (const e of calendar.elections || []) used.add(e.name);
ok('the code and markup use translation keys', used.size > 200, String(used.size));

const slots = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
const langs = readdirSync(join(ROOT, 'i18n')).filter((f) => f.endsWith('.js'));
ok('there is at least one translation', langs.length > 0);
for (const f of langs) {
  const cat = (await import(join(ROOT, 'i18n', f))).default;
  const missing = [...used].filter((k) => !(k in cat));
  ok(`${f}: every key has a translation`, !missing.length, missing.slice(0, 5).join(' | '));
  const stale = Object.keys(cat).filter((k) => !used.has(k));
  ok(`${f}: no translation is left over`, !stale.length, stale.slice(0, 5).join(' | '));
  const bad = Object.keys(cat).filter((k) => !k.startsWith('#') && slots(k) !== slots(cat[k]));
  ok(`${f}: every translation fills the slots its English does`, !bad.length, bad.slice(0, 5).join(' | '));
  const empty = Object.keys(cat).filter((k) => !String(cat[k]).trim());
  ok(`${f}: no translation is blank`, !empty.length, empty.join(' | '));
}
// The how-link is bound by id after the intro is translated; a translation that drops it
// leaves the About sheet unreachable from the intro.
const es = (await import(join(ROOT, 'i18n', 'es.js'))).default;
ok('the Spanish intro keeps the How? link', /id="howLink"/.test(es['#lede']));

// ---- In a browser ----
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
                '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  const file = join(ROOT, path.endsWith('/') ? join(path, 'index.html') : path);
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, r));
const URL_ = `http://localhost:${server.address().port}/`;
const browser = await chromium.launch();

async function ready(page) {
  await page.waitForFunction(() => !document.getElementById('addr').disabled, null,
                             { timeout: 120000 });
}

// English labels the answer would show if anything there went untranslated.
const ENGLISH = ['Ballot drop box', 'Early voting', 'Election day', 'Directions',
                 'Where you vote', 'Precinct', 'Ward', 'Hours:', 'Location:', 'Show all',
                 'Not an official government tool', 'Obey all traffic', 'Head ', 'Turn ',
                 'Arrive at', 'cameras', 'Today'];

{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(URL_ + '?lang=es', { waitUntil: 'networkidle' });
  await ready(page);
  const start = await page.evaluate(() => ({
    lang: document.documentElement.lang,
    label: document.querySelector('label[for="addr"]').textContent,
    btn: document.getElementById('langBtn').textContent,
    btnLang: document.getElementById('langBtn').lang,
    stored: localStorage.getItem('lang'),
    how: !!document.getElementById('howLink'),
  }));
  ok('?lang=es opens the page in Spanish', start.lang === 'es' && /Escriba/.test(start.label),
     JSON.stringify(start));
  ok('the switch offers English, marked as English', start.btn === 'English' && start.btnLang === 'en');
  ok('opening a link stores no choice', start.stored === null);
  ok('the intro keeps its How? link', start.how);

  await page.fill('#addr', '300 Monroe Ave NW');
  await page.waitForTimeout(400);
  await page.press('#addr', 'Enter');
  await page.waitForSelector('#steps li, #routes .here', { timeout: 30000 });
  const answer = await page.evaluate(() => ({
    info: document.getElementById('precinctInfo').textContent,
    route: document.getElementById('routeBlock').textContent,
    advisory: document.getElementById('advisory').textContent,
  }));
  ok('the answer is in Spanish', /Precinto|PRECINTO/.test(answer.info) && /Distrito|DISTRITO/i.test(answer.info),
     answer.info.slice(0, 200));
  const text = `${answer.info}\n${answer.route}\n${answer.advisory}`;
  const left = ENGLISH.filter((w) => text.includes(w));
  ok('no English label is left in the answer', !left.length, left.join(' | '));
  ok('the disclaimer is translated', /No es una herramienta oficial/.test(answer.advisory));
  ok('no page errors in Spanish', !errors.length, errors.join(' | '));

  await page.click('#langBtn');
  await page.waitForLoadState('networkidle');
  await ready(page);
  const back = await page.evaluate(() => ({
    lang: document.documentElement.lang, search: location.search,
    stored: localStorage.getItem('lang'), btn: document.getElementById('langBtn').textContent,
    label: document.querySelector('label[for="addr"]').textContent,
  }));
  ok('the switch goes back to English', back.lang === 'en' && /Enter an Address/.test(back.label),
     JSON.stringify(back));
  ok('and drops ?lang from the address', back.search === '');
  ok('and remembers the choice', back.stored === 'en');
  ok('and now offers Español', back.btn === 'Español');
  await ctx.close();
}

{
  // A Spanish-speaking browser with no choice made gets Spanish on its own.
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'es-MX' });
  const page = await ctx.newPage();
  await page.goto(URL_, { waitUntil: 'networkidle' });
  await ready(page);
  const r = await page.evaluate(() => ({
    lang: document.documentElement.lang,
    help: document.getElementById('helpTitle').textContent,
    date: document.getElementById('cdNote')?.textContent || '',
  }));
  ok('a Spanish browser opens in Spanish', r.lang === 'es' && /PROBLEMAS|problemas/.test(r.help),
     JSON.stringify(r));
  ok('the countdown date is in Spanish', !r.date || / de \d{4}$/.test(r.date), r.date);
  await ctx.close();
}

{
  // An English browser is unchanged.
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'en-US' });
  const page = await ctx.newPage();
  await page.goto(URL_, { waitUntil: 'networkidle' });
  await ready(page);
  const r = await page.evaluate(() => ({
    lang: document.documentElement.lang,
    btn: document.getElementById('langBtn').textContent,
    btnLang: document.getElementById('langBtn').lang,
  }));
  ok('an English browser stays in English', r.lang === 'en', JSON.stringify(r));
  ok('and is offered Español, marked as Spanish', r.btn === 'Español' && r.btnLang === 'es');
  await ctx.close();
}

await browser.close();
server.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
