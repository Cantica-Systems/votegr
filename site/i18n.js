// The page's language. Translations are written ahead of time and shipped in site/i18n/,
// so nothing is sent to a translation service and nothing a reader types leaves the page.
//
// The English text is its own key: t('Open now') returns the catalog's entry for
// 'Open now', or the English when there is none. Static text in index.html carries a
// data-i18n key instead, since the English there is markup, not a string in code.
// tests/test_i18n.mjs checks every key used in code and markup has a translation.

export const LANGS = { en: 'English', es: 'Español' };

// ?lang= first (a shared link opens in its language), then the reader's own pick, then
// the browser's languages, then English. Only a click on the switch is stored.
function pick() {
  try {
    const q = new URLSearchParams(location.search).get('lang');
    if (q && LANGS[q]) return q;
  } catch (e) { /* no location: a test harness */ }
  try {
    const s = localStorage.getItem('lang');
    if (s && LANGS[s]) return s;
  } catch (e) { /* private mode */ }
  for (const l of (navigator.languages || [navigator.language || ''])) {
    const base = String(l).toLowerCase().split('-')[0];
    if (LANGS[base]) return base;
  }
  return 'en';
}

export const lang = pick();
const CAT = lang === 'en' ? {} : (await import(`./i18n/${lang}.js`)).default;

// vars fill {name} slots. A slot with no value is left as written, so a mistake shows.
export function t(s, vars) {
  const out = Object.prototype.hasOwnProperty.call(CAT, s) ? CAT[s] : s;
  return vars ? out.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : out;
}

// data-i18n="#key" replaces the element's markup; data-i18n-<attr>="#key" one attribute.
// English is what index.html already says, so it is left alone.
export function translateDom(root = document) {
  document.documentElement.lang = lang;
  if (lang === 'en') return;
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    const v = CAT[el.dataset.i18n];
    if (v != null) el.innerHTML = v;
  });
  for (const attr of ['title', 'aria-label', 'placeholder', 'content']) {
    root.querySelectorAll(`[data-i18n-${attr}]`).forEach((el) => {
      const v = CAT[el.getAttribute(`data-i18n-${attr}`)];
      if (v != null) el.setAttribute(attr, v);
    });
  }
}

// The switch reloads into the other language: every line the page has built is redone in
// it, and ?lang= in the address makes the page shareable as it is.
export function setLang(next) {
  if (!LANGS[next]) return;
  try { localStorage.setItem('lang', next); } catch (e) { /* private mode */ }
  const u = new URL(location.href);
  if (next === 'en') u.searchParams.delete('lang'); else u.searchParams.set('lang', next);
  location.assign(u.toString());
}
