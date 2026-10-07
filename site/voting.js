// What both pages share: address -> precinct -> polling place, the election
// calendar, and display casing.

// ---- Display case ----
// Only case changes: displayCase(x).toUpperCase() === x.toUpperCase(), and it is
// idempotent, so it is safe at display time over data still matched in its
// original form. A port of the same function in a sibling project, trimmed to
// this corpus's vocabulary; tests/test_display_case.mjs shares its vectors with
// that project, so a rule change here means checking there.

// Directionals stay upper. Not NORTH or EAST: "North Park Street" is a name.
const DIR = { N: 1, S: 1, E: 1, W: 1, NE: 1, NW: 1, SE: 1, SW: 1 };

// Freeway-bound and ramp shorthand, plus GR and GRPS from the clerk's venue
// names ("GRPS University").
const ACRONYMS = { US: 1, NB: 1, SB: 1, EB: 1, WB: 1,
                   SO: 1, NO: 1, EO: 1, WO: 1, GR: 1, GRPS: 1 };

// Upper only when followed by a number: US 131, M 6, I 196.
const HWY = { US: 1, M: 1, I: 1 };

// Lowercase unless they open the string.
const MINOR = { OF: 1, AND: 1, THE: 1, AT: 1, IN: 1, ON: 1, FOR: 1 };

const ORDINAL = /^(\d+)(ST|ND|RD|TH)$/;
const RUN = /[A-Za-z0-9]+|[^A-Za-z0-9]+/g;

function isWordRun(run) {
  return !!run && /^[A-Za-z0-9]/.test(run.charAt(0));
}

function caseWord(w, isFirst, prevDelim, nextWord) {
  const up = w.toUpperCase();
  if (/^\d+$/.test(w)) return w;
  const m = ORDINAL.exec(up);
  if (m) return m[1] + m[2].toLowerCase();
  // A name continuing after an apostrophe: O'BRIEN, SHERIFF'S.
  if (prevDelim && prevDelim.charAt(prevDelim.length - 1) === "'") {
    return w.length === 1 ? w.toLowerCase()
                          : up.charAt(0) + w.slice(1).toLowerCase();
  }
  if (DIR[up] === 1) return up;
  if (ACRONYMS[up] === 1) return up;
  if (HWY[up] === 1 && nextWord !== null && /^\d+$/.test(nextWord)) return up;
  if (MINOR[up] === 1 && !isFirst) return w.toLowerCase();
  if (up.slice(0, 2) === 'MC' && up.length > 2 && /^[A-Z]+$/.test(up.slice(2))) {
    return 'Mc' + up.charAt(2) + up.slice(3).toLowerCase();
  }
  return up.charAt(0) + w.slice(1).toLowerCase();
}

function displayCase(s) {
  if (typeof s !== 'string' || !s) return s;
  const runs = s.match(RUN) || [];
  const out = [];
  let seenWord = false;
  for (let i = 0; i < runs.length; i++) {
    if (!isWordRun(runs[i])) { out.push(runs[i]); continue; }
    const prevDelim = (i > 0 && !isWordRun(runs[i - 1])) ? runs[i - 1] : '';
    let nextWord = null;
    for (let j = i + 1; j < runs.length; j++) {
      if (isWordRun(runs[j])) { nextWord = runs[j]; break; }
    }
    out.push(caseWord(runs[i], !seenWord, prevDelim, nextWord));
    seenWord = true;
  }
  return out.join('');
}

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

// ---- Election calendar ----
// Both pages read the calendar here, so they cannot disagree about it.
// Dates are local Y-M-D strings. Never new Date(iso): that is UTC midnight,
// which lands on the previous day west of Greenwich.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
                'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday',
                  'Friday', 'Saturday'];
// The clerk publishes early voting hours by weekday; the data file uses these.
const DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

// The local day, not toISOString's UTC one.
function isoOf(d) {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function todayISO() { return isoOf(new Date()); }

function todayAbbr() { return DAY_ABBR[new Date().getDay()]; }

function dayStart(iso) {
  const m = ISO.exec(String(iso || ''));
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

// "2026-11-03" -> "November 3, 2026"; anything unparseable comes back as given.
function monthDay(iso) {
  const m = ISO.exec(String(iso || ''));
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : (iso || '');
}

// "2026-11-03" -> "Tuesday, November 3, 2026".
function withWeekday(iso) {
  const d = dayStart(iso);
  return d ? `${WEEKDAYS[d.getDay()]}, ${monthDay(iso)}` : (iso || '');
}

// "2026-11-03" -> "Tuesday, November 3".
function dayMonth(iso) { return withWeekday(iso).replace(/, \d{4}$/, ''); }

// "7:00 AM" -> "7 AM"; half hours keep their minutes.
function shortTime(t) {
  return String(t || '').replace(/:00(?=\s*[AP]M\b)/i, '');
}

// Sorted rather than trusting file order, so an out-of-order entry cannot hide
// the next election.
function next(list, today) {
  const t = today || todayISO();
  const future = (list || []).filter((e) => e && e.date >= t);
  future.sort((a, b) => (a.date < b.date ? -1 : 1));
  return future[0] || null;
}

function sites(e) { return e?.early_voting_sites || []; }

// Statute, not a clerk's choice: Michigan mails absentee ballots 40 days out.
const ABSENTEE_LEAD_DAYS = 40;
function absenteeFrom(e) {
  const d = dayStart(e?.date);
  if (!d) return null;
  d.setDate(d.getDate() - ABSENTEE_LEAD_DAYS);
  return isoOf(d);
}

// "8:00 PM" on a Y-M-D date -> that local instant, or null if unreadable.
const CLOCK = /^\s*(\d{1,2})(?::(\d{2}))?\s*([AP])\.?M\.?\s*$/i;
function atTime(iso, clock) {
  const day = dayStart(iso);
  const m = CLOCK.exec(String(clock || ''));
  if (!day || !m) return null;
  const h = Number(m[1]) % 12 + (m[3].toUpperCase() === 'P' ? 12 : 0);
  day.setHours(h, Number(m[2] || 0), 0, 0);
  return day;
}

// 'before', 'open' or 'closed' on election day; null on any other day or when
// the hours cannot be read.
function pollsPhase(e, hours, now) {
  if (!e || !hours) return null;
  const open = atTime(e.date, hours.open);
  const close = atTime(e.date, hours.close);
  if (!open || !close) return null;
  const t = now || new Date();
  if (t < dayStart(e.date)) return null;
  if (t < open) return 'before';
  if (t < close) return 'open';
  return 'closed';
}

// The instant the last early voting day's sites close, or null when nothing
// published says. Read from the clerk's per-date hours ("9 am - 5 pm") when
// the window carries them, else from the weekday rules in elections.json.
function earlyVotingEnds(e) {
  const last = e?.early_voting_to;
  if (!last) return null;
  const day = (e.early_voting_days || []).find((d) => d && d.date === last);
  if (day) return atTime(last, String(day.hours || '').split(/\s*[-–]\s*/)[1]);
  const d = dayStart(last);
  const rule = d && (e.early_voting_hours || [])
    .find((h) => (h.days || []).includes(DAY_ABBR[d.getDay()]));
  return rule ? atTime(last, rule.close) : null;
}

// The early voting window: 'none' (nothing, or only half a window, published),
// 'before', 'open', or 'closed' (over, with the election still ahead). The
// last day closes when its sites do, not at midnight, so nobody is sent to a
// locked door that evening. Without readable hours it stays open to midnight.
function windowState(e, today, now) {
  if (!e || !e.early_voting_from || !e.early_voting_to) return 'none';
  const t = today || todayISO();
  if (t > e.early_voting_to) return 'closed';
  if (t < e.early_voting_from) return 'before';
  if (t === e.early_voting_to) {
    const end = earlyVotingEnds(e);
    if (end && (now || new Date()) >= end) return 'closed';
  }
  return 'open';
}

const Elections = {
  todayISO, todayAbbr, dayStart, monthDay, withWeekday, dayMonth, shortTime,
  next, sites, absenteeFrom, atTime, pollsPhase, earlyVotingEnds, windowState
};

// ---- Precinct lookup ----
// The address matching (parseTyped / streetMatches / resolve) is carried over
// from the earlier vote-gr project so the two answer identically; keep it a
// faithful copy. The lookup reads files already downloaded: the address is
// never sent anywhere.

const QUADRANT = { NE: 1, NW: 1, SE: 1, SW: 1 };

// Two modes: the constructor takes the Grand Rapids files, where a precinct id
// is its bare number ("52"); Precincts.county() takes all thirty jurisdictions,
// where it is the state's 13-digit code (county 081, MCD 42820, ward 01,
// precinct 001). Rows are [house number, id, metres to precinct edge, rivals].
class Precincts {
  constructor(addresses, polling) {
    this.wards = addresses.wards || {};
    this.streets = addresses.streets || {};
    this.streetNames = Object.keys(this.streets);
    this.polling = polling?.precincts || {};
    this.byCode = null;
    this.boxes = {};
    this.clerks = {};
  }

  // opts: { index: precincts.json, addresses: [chunk...], polling: [chunk...],
  //         cityPolling: polling.json, cityMcd: '34000' }
  static county(opts) {
    const P = Object.create(Precincts.prototype);
    P.wards = {};
    P.streets = {};
    P.polling = {};
    P.boxes = {};
    P.clerks = {};
    P.byCode = {};
    P.jurisdictions = {};

    const list = opts.index?.precincts || [];
    for (const pr of list) {
      P.byCode[pr.code] = { mcd: pr.mcd, jurisdiction: pr.jurisdiction,
                            ward: pr.ward ?? null,
                            precinct: pr.precinct, name: pr.name };
      P.jurisdictions[pr.mcd] = pr.jurisdiction;
    }

    // A chunk's rows point into its own precinct list. A street name found in
    // several jurisdictions merges into one list sorted by number; two towns
    // can share a name, so places() keeps an answer within one jurisdiction.
    const docs = opts.addresses || [];
    const dirty = {};
    for (const doc of docs) {
      const codes = doc.precincts || [];
      const streets = doc.streets || {};
      for (const name in streets) {
        if (!Object.hasOwn(streets, name)) continue;
        const rows = streets[name];
        const into = P.streets[name] || (P.streets[name] = []);
        if (into.length) dirty[name] = 1;
        for (const r of rows) {
          const out = [r[0], codes[r[1]], r[2]];
          if (r[3]) {
            out.push(r[3].map((k) => codes[k]));
          }
          into.push(out);
        }
      }
    }
    for (const d in dirty) {
      if (Object.hasOwn(dirty, d)) {
        P.streets[d].sort((a, b) => a[0] - b[0]);
      }
    }
    P.streetNames = Object.keys(P.streets);

    // The county's scrape covers every jurisdiction; Grand Rapids is then
    // overwritten from polling.json, which adds coordinates, entrance notes
    // and a consolidation the county page does not know about.
    const pdocs = opts.polling || [];
    for (const pd of pdocs) {
      const recs = pd.precincts || {};
      for (const code in recs) {
        if (Object.hasOwn(recs, code)) P.polling[code] = recs[code];
      }
      if (pd.mcd && pd.drop_boxes) P.boxes[pd.mcd] = pd.drop_boxes;
      if (pd.mcd && pd.clerk) P.clerks[pd.mcd] = pd.clerk;
    }
    const cityMcd = opts.cityMcd || '34000';
    const cityRecs = opts.cityPolling?.precincts || {};
    const numberToCode = {};
    for (const code in P.byCode) {
      if (Object.hasOwn(P.byCode, code) && P.byCode[code].mcd === cityMcd) {
        numberToCode[String(P.byCode[code].precinct)] = code;
      }
    }
    for (const num in cityRecs) {
      if (!Object.hasOwn(cityRecs, num)) continue;
      const target = numberToCode[num];
      if (!target) continue;
      const rec = cityRecs[num];
      const copy = {};
      for (const k in rec) if (Object.hasOwn(rec, k)) copy[k] = rec[k];
      if (copy.consolidated_with != null) {
        copy.consolidated_with = numberToCode[String(copy.consolidated_with)] ||
                                 copy.consolidated_with;
      }
      P.polling[target] = copy;
    }
    return P;
  }

  describe(id) {
    if (this.byCode) {
      const d = this.byCode[id];
      return d ? { code: id, precinct: d.precinct, ward: d.ward,
                   jurisdiction: d.jurisdiction, mcd: d.mcd }
               : { code: id, precinct: id, ward: null, jurisdiction: null, mcd: null };
    }
    return { code: String(id), precinct: id, ward: this.wards[id] || null,
             jurisdiction: null, mcd: null };
  }

  idOf(polygon) {
    return this.byCode ? polygon.code : String(polygon.precinct);
  }

  // Cached: the type-ahead asks for every suggestion on every keystroke.
  whereIs(street) {
    if (!this.byCode) return null;
    this._where ||= {};
    if (this._where[street]) return this._where[street];
    const rows = this.streets[street] || [];
    const seen = {};
    const names = [];
    for (const row of rows) {
      const d = this.byCode[row[1]];
      if (d && !seen[d.jurisdiction]) { seen[d.jurisdiction] = 1; names.push(d.jurisdiction); }
    }
    return (this._where[street] = names);
  }

  // For Grand Rapids the page uses the city clerk's own file (boxesFor in app.js).
  dropBoxes(mcd) {
    return this.boxes?.[mcd] || [];
  }

  // Where an absentee ballot goes when no drop box is published (MCL 168.764a).
  clerkOf(mcd) {
    return this.clerks?.[mcd] || null;
  }

  // "250 Monroe Ave. NW" -> { number: 250, rest: "MONROE AVE NW" }
  parseTyped(text) {
    const clean = String(text || '').toUpperCase().replace(/[.,]/g, ' ')
      .replace(/\s+/g, ' ').trim();
    const m = clean.match(/^(\d+)\s*(.*)$/);
    return m ? { number: Number(m[1]), rest: m[2] } : { number: null, rest: clean };
  }

  // `bare` holds every name without its quadrant; `unquartered` only the names
  // that never had one.
  _canon() {
    if (this._canonCache) return this._canonCache;
    const list = [];
    const quartered = [];
    const full = {};
    const bare = {};
    const unquartered = {};
    for (const name of this.streetNames) {
      const c = canonName(name);
      list.push(c.key);
      quartered.push(!!c.quad);
      full[c.key] = 1;
      bare[c.bare] = 1;
      if (!c.quad) unquartered[c.bare] = 1;
    }
    return (this._canonCache = { list, quartered, full, bare, unquartered });
  }

  matchingStreets(rest) {
    const tokens = String(rest || '').split(' ').filter(Boolean);
    if (!tokens.length) return [];
    const hits = this.streetNames.filter((s) => streetMatches(s, tokens));
    if (hits.length) {
      return hits.sort((a, b) => {
        const lead = (s) => (s.startsWith(tokens[0]) ? 0 : 1);
        return lead(a) - lead(b) || a.length - b.length || a.localeCompare(b);
      });
    }
    // Only when the county's spelling found nothing, so vote-gr's answers hold.
    let q = canonQuery(rest);
    const { list: canon, quartered } = this._canon();
    const names = this.streetNames;
    if (!q.length) return [];
    const at = [];
    for (let i = 0; i < canon.length; i++) if (streetMatches(canon[i], q)) at.push(i);
    // Still nothing: drop the quadrant and try streets the county writes
    // without one (E FULTON ST SE is FULTON ST E in Ada), as covers() does.
    if (!at.length) {
      const unq = q.filter((t) => !QUADRANT[t]);
      if (unq.length && unq.length < q.length) {
        for (let i = 0; i < canon.length; i++) {
          if (!quartered[i] && streetMatches(canon[i], unq)) at.push(i);
        }
        q = unq;
      }
    }
    return at.sort((a, b) => {
      const lead = (k) => (canon[k].startsWith(q[0]) ? 0 : 1);
      return lead(a) - lead(b) || canon[a].length - canon[b].length ||
             names[a].localeCompare(names[b]);
    }).map((k) => names[k]);
  }

  // A quadrant on one side only still matches; two different ones are two streets.
  covers(name) {
    const c = canonName(name);
    const k = this._canon();
    return !!(k.full[c.key] ||
              (!c.quad && k.bare[c.bare]) ||
              (c.quad && k.unquartered[c.bare]));
  }

  // By the name the precinct index gives it ("Grand Rapids Township").
  coversJurisdiction(name) {
    if (!this._jset) {
      this._jset = {};
      for (const mcd in this.jurisdictions || {}) {
        if (Object.hasOwn(this.jurisdictions, mcd)) {
          this._jset[this.jurisdictions[mcd]] = 1;
        }
      }
    }
    return !!this._jset[name];
  }

  // Of a street -> [jurisdiction] map, the part this index cannot answer.
  unindexed(streets) {
    const out = {};
    for (const name in streets || {}) {
      if (!Object.hasOwn(streets, name)) continue;
      let where = streets[name] || [];
      if (this.covers(name)) {
        where = where.filter((j) => !this.coversJurisdiction(j));
      }
      if (where.length) out[name] = where;
    }
    return out;
  }

  // ---- One street name, several places ----
  // 25 N Main St NE exists in Rockford and in Cedar Springs, so the
  // jurisdiction is settled first and the address answered within it.

  mcdOf(row) {
    const d = this.byCode?.[row[1]];
    return d ? d.mcd : null;
  }

  _rows(street, mcd) {
    const rows = this.streets[street];
    if (!rows || !mcd || !this.byCode) return rows || null;
    const mine = rows.filter((r) => this.mcdOf(r) === mcd);
    return mine.length ? mine : null;
  }

  // Empty in the city files, and for a number between two jurisdictions' rows,
  // which resolve() then answers from the merged list.
  places(street, number) {
    const rows = this.streets[street];
    if (!rows || !this.byCode || number == null) return [];
    const mcds = [];
    const seen = {};
    const exact = [];
    for (const row of rows) {
      const m = this.mcdOf(row);
      if (m && !seen[m]) { seen[m] = 1; mcds.push(m); }
      if (m && row[0] === number && !exact.includes(m)) exact.push(m);
    }
    if (exact.length) return exact;
    return mcds.filter((mcd) => !!this.resolve(street, number, mcd));
  }

  // Infers only from same-side neighbors: a precinct line often runs down the
  // middle of a street, putting odd and even in different precincts.
  resolve(street, number, mcd) {
    const rows = this._rows(street, mcd);
    if (!rows) return null;

    let exact = null;
    for (const row of rows) if (row[0] === number) { exact = row; break; }
    if (exact) {
      return { precinct: exact[1], edgeMetres: exact[2],
               rivals: exact[3] || null, inferred: false };
    }
    const sameSide = rows.filter((r) => r[0] % 2 === number % 2);
    let below = null, above = null;
    for (const row of sameSide) {
      if (row[0] < number) below = row;
      else if (row[0] > number) { above = row; break; }
    }
    if (!below || !above) return null;      // outside known range: do not extrapolate
    if (below[1] !== above[1]) {
      return { precinct: below[1], rivals: [below[1], above[1]], inferred: true,
               edgeMetres: Infinity };
    }
    return { precinct: below[1], edgeMetres: Math.min(below[2], above[2]),
             rivals: null, inferred: true };
  }

  // consolidated_with: a precinct voting at another's location for one
  // election, which the clerk records only in the directory's footnotes.
  pollingPlace(precinct) {
    const p = this.polling[precinct];
    if (!p) return null;
    if (p.consolidated_with && this.polling[p.consolidated_with]) {
      const host = this.polling[p.consolidated_with];
      return { name: host.name, address: host.address, lat: host.lat, lng: host.lng,
               entrance_note: host.entrance_note,
               consolidated_with: p.consolidated_with, note: p.note };
    }
    return { name: p.name, address: p.address, lat: p.lat, lng: p.lng,
             entrance_note: p.entrance_note };
  }

  suggest(text, limit) {
    limit = limit || 8;
    const t = this.parseTyped(text);
    const streets = this.matchingStreets(t.rest);
    if (!streets.length) return [];

    const tag = (o) => {
      const w = o.mcd ? [this.jurisdictions[o.mcd]] : this.whereIs(o.street);
      if (w && w.length) o.where = w;
      return o;
    };
    if (t.number == null) {
      return streets.slice(0, limit)
        .map((s) => tag({ street: s, number: null, kind: 'street' }));
    }

    const out = [];
    ['exact', 'inferred'].forEach((kind) => {
      streets.forEach((s) => {
        if (out.some((o) => o.street === s)) return;
        const hasExact = this._hasNumber(s, t.number);
        if ((kind === 'exact') !== hasExact) return;
        const mcds = this.places(s, t.number);
        if (mcds.length) {
          mcds.forEach((mcd) => {
            out.push({ street: s, number: t.number, kind, mcd });
          });
        } else if (hasExact || this.resolve(s, t.number)) {
          out.push({ street: s, number: t.number, kind });
        }
      });
    });
    // Nearby house numbers are a last resort, only when nothing above matched.
    if (out.length) return markChoices(out).slice(0, limit).map(tag);

    // Then the same number in another quadrant: each Grand Rapids quadrant
    // counts from Fulton and Division, so 15 Burton St SW exists and SE does not.
    const base = strippedQuadrant(t.rest);
    if (base) {
      this.streetNames.forEach((s) => {
        if (streets.includes(s)) return;
        if (strippedQuadrant(s) !== base) return;
        if (!this._hasNumber(s, t.number)) return;
        const mcds = this.places(s, t.number);
        (mcds.length ? mcds : [undefined]).forEach((mcd) => {
          out.push({ street: s, number: t.number, kind: 'quadrant', mcd });
        });
      });
      if (out.length) return markChoices(out).slice(0, limit).map(tag);
    }

    streets.slice(0, 3).forEach((s) => {
      const rows = this.streets[s] || [];
      const near = rows.slice().sort((a, b) => {
        const da = Math.abs(a[0] - t.number);
        const db = Math.abs(b[0] - t.number);
        if (da !== db) return da - db;
        // prefer the same side of the street
        const pa = a[0] % 2 === t.number % 2 ? 0 : 1;
        const pb = b[0] % 2 === t.number % 2 ? 0 : 1;
        return pa - pb;
      });
      for (const row of near.slice(0, 3)) {
        if (row[0] === t.number) continue;
        out.push({ street: s, number: row[0], kind: 'near',
                   mcd: this.mcdOf(row) || undefined });
      }
    });

    // De-duplicate, keeping the strongest kind for each address.
    const seen = {};
    const uniq = [];
    out.forEach((o) => {
      const k = `${o.number}|${o.street}|${o.mcd || ''}`;
      if (seen[k]) return;
      seen[k] = 1; uniq.push(o);
    });
    return markChoices(uniq).slice(0, limit).map(tag);
  }

  _hasNumber(street, number) {
    const rows = this.streets[street] || [];
    for (const row of rows) if (row[0] === number) return true;
    return false;
  }

  // `mcd` is the jurisdiction the reader picked. Without one, an address
  // several jurisdictions could hold returns 'several_places' to choose from.
  lookup(text, mcd) {
    const t = this.parseTyped(text);
    if (t.number == null) return { error: 'no_number', rest: t.rest,
                                   suggestions: this.matchingStreets(t.rest).slice(0, 6) };
    const candidates = this.matchingStreets(t.rest);
    if (!candidates.length) return { error: 'no_street', rest: t.rest };
    const street = candidates.includes(t.rest) ? t.rest : candidates[0];
    const places = mcd ? [mcd] : this.places(street, t.number);
    if (places.length > 1) {
      return { error: 'several_places', street, number: t.number,
               places: places.map((m) => ({ mcd: m, jurisdiction: this.jurisdictions[m] })) };
    }
    const res = this.resolve(street, t.number, places[0]);
    if (!res) return { error: 'no_number_on_street', street,
                       number: t.number, ambiguous: candidates.slice(0, 6) };
    const place = this.pollingPlace(res.precinct);
    const who = this.describe(res.precinct);
    return {
      number: t.number, street,
      // `precinct` is the number a voter knows; `code` is the identity.
      code: who.code, precinct: who.precinct, ward: who.ward,
      jurisdiction: who.jurisdiction, mcd: who.mcd, place,
      rivals: res.rivals ? res.rivals.map((id) => this.describe(id).precinct) : null,
      inferred: res.inferred, edgeMetres: res.edgeMetres,
      ambiguousStreet: candidates.length > 1 && !candidates.includes(t.rest)
        ? candidates.slice(0, 6) : null
    };
  }

  precinctAt(lat, lng, polygons) {
    if (!polygons) return null;
    for (const polygon of polygons) {
      if (pointInRings(lat, lng, polygon.rings)) return polygon;
    }
    return null;
  }

  // For an inferred address only, the precinct polygon at its geocoded point
  // overrides the neighbors. An exact match geocodes to the street centerline,
  // which disagrees with the polygon for about 1 in 15 of them.
  refineWithPolygon(r, geocodeFn, polygons) {
    if (!r || r.error || !r.inferred || !geocodeFn || !polygons) return r;
    const pt = geocodeFn(r.number, r.street);
    if (!pt) return r;
    const hit = this.precinctAt(pt.lat, pt.lng, polygons);
    if (!hit) return r;
    const id = this.idOf(hit);
    if (id === String(r.code)) return r;
    const was = r.precinct;
    const who = this.describe(id);
    r.code = who.code; r.precinct = who.precinct; r.ward = who.ward;
    r.jurisdiction = who.jurisdiction; r.mcd = who.mcd;
    r.place = this.pollingPlace(id);
    r.rivals = [r.precinct, was];
    r.refined = true;
    return r;
  }
}

// Every typed word must begin a word of the street name, in order.
function streetMatches(street, tokens) {
  const words = street.split(' ');
  let at = 0;
  for (const token of tokens) {
    while (at < words.length && !words[at].startsWith(token)) at++;
    if (at >= words.length) return false;
    at++;
  }
  return true;
}

// "BURTON ST SE" -> "BURTON ST"; null when there is no quadrant.
function strippedQuadrant(name) {
  const m = String(name || '').toUpperCase().trim()
    .match(/^(.*?)\s+(NE|NW|SE|SW)$/);
  return m ? m[1] : null;
}

// ---- Two spellings of one street ----
// Readers and the state road layer spell streets differently from the
// county's parcel file (E FULTON ST for FULTON ST E, HOLW for HOLLOW), so both
// sides fold to one form. Unlike router.js this keeps the street type and the
// quadrant: a court and a drive of one name are two streets.
const WORDS = {
  STREET: 'ST', SAINT: 'ST', AVENUE: 'AVE', DRIVE: 'DR', ROAD: 'RD',
  COURT: 'CT', LANE: 'LN', PLACE: 'PL', CIRCLE: 'CIR', BOULEVARD: 'BLVD',
  PARKWAY: 'PKWY', TRAIL: 'TRL', TERRACE: 'TER', SQUARE: 'SQ',
  HIGHWAY: 'HWY', HOLLOW: 'HOLW', POINT: 'PT', RIDGE: 'RDG',
  CROSSING: 'XING', MOUNT: 'MT', VALLEY: 'VLY', HILL: 'HL', HILLS: 'HLS',
  COVE: 'CV', BEND: 'BND', HAVEN: 'HVN', CREEK: 'CRK', TRACE: 'TRCE',
  PARK: 'PK',
  EAST: 'E', WEST: 'W', NORTH: 'N', SOUTH: 'S',
  FIRST: '1ST', SECOND: '2ND', THIRD: '3RD', FOURTH: '4TH', FIFTH: '5TH',
  SIXTH: '6TH', SEVENTH: '7TH', EIGHTH: '8TH', NINTH: '9TH', TENTH: '10TH',
  ELEVENTH: '11TH', TWELFTH: '12TH'
};
const CARDINAL = { N: 1, S: 1, E: 1, W: 1 };

function foldWords(text) {
  return String(text || '').toUpperCase().replace(/[.,]/g, ' ')
    .replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)
    .map((t) => WORDS[t] || t);
}

// "E BELTLINE AVE NE" and "EAST BELTLINE AVE NE" -> "BELTLINE AVE NE E".
function canonName(name) {
  const w = foldWords(name);
  let dir = null, quad = null;
  if (w.length > 1 && CARDINAL[w[w.length - 1]]) dir = w.pop();
  else if (w.length > 1 && CARDINAL[w[0]]) dir = w.shift();
  if (w.length > 1 && QUADRANT[w[w.length - 1]]) quad = w.pop();
  const bare = dir ? w.concat([dir]) : w;
  return { key: (quad ? w.concat([quad]) : w).concat(dir ? [dir] : []).join(' '),
           bare: bare.join(' '), quad };
}

// Only a leading direction moves: in partial input a trailing S may begin ST.
function canonQuery(rest) {
  const w = foldWords(rest);
  if (w.length > 1 && CARDINAL[w[0]]) w.push(w.shift());
  return w;
}

// An address offered in several jurisdictions is marked, so Enter opens the
// list rather than taking the first.
function markChoices(list) {
  const count = {};
  list.forEach((o) => {
    const k = `${o.number}|${o.street}`;
    count[k] = (count[k] || 0) + 1;
  });
  list.forEach((o) => { if (count[`${o.number}|${o.street}`] > 1) o.choice = true; });
  return list;
}

// ---- Point in polygon ----
// The project's one ray cast: app.js, scripts/compare_osrm.mjs and the tests
// call this rather than keep a copy. Rings are [lat, lng] pairs, so swap
// boundary.json's [lng, lat] first. Every ring toggles, so holes work.
function pointInRings(lat, lng, rings) {
  let inside = false;
  for (const ring of rings) {
    for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
      const yi = ring[a][0], xi = ring[a][1], yj = ring[b][0], xj = ring[b][1];
      if (((yi > lat) !== (yj > lat)) &&
          (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
    }
  }
  return inside;
}

Precincts.pointInRings = pointInRings;

export { displayCase, esc, Elections, Precincts, pointInRings };
