// Released into the public domain under the Unlicense, see UNLICENSE.
/* Title-case a display string without expanding or rewriting it.

   Every street name in the routing graph, every polling place address and
   every early voting address arrives ALL CAPS, because that is how the
   county centerline file, the city clerk's directory, the county's pages
   and the state layers publish them.
   Shouting an address at a reader is not a decision this project made; it is
   one it inherited and never undid.

   THE INVARIANT, and the reason this is not a one-line regex: case is the
   only thing that changes. displayCase(x).toUpperCase() === x.toUpperCase()
   for every input. No character, digit or space is inserted, removed or
   substituted, and running it twice changes nothing. That is what makes it
   safe to apply at DISPLAY time over data that is still matched, geocoded and
   compared in its original form.

   Ported from the same function in a sibling project, where it has a fuller
   vocabulary for police agency names. Trimmed here to what this corpus
   actually contains, counted rather than guessed: US appears 560 times and
   NB/SB/EB/WB 733 times between them across the county road graph, so the
   freeway shorthand is real and stays. The agency acronyms and the
   block-anonymization mask rule appear zero times, because this project
   publishes exact addresses and redacts nothing, so they are left out.

   The hard cases are all real streets here: 10TH ST NW must not become
   "10Th", MCREYNOLDS must not become "Mcreynolds", O'BRIEN must not become
   "O'brien", and NW must never become "Nw". */

// Abbreviated directionals stay UPPER as standalone tokens. The full words
// (NORTH, EAST) deliberately are not here: "North Park Street" is a name.
const DIR = { N: 1, S: 1, E: 1, W: 1, NE: 1, NW: 1, SE: 1, SW: 1 };

// Freeway-bound and ramp-locator shorthand. Title-casing these produces
// gibberish ("Nb So"), and they read as codes rather than words.
// GR is the city's own shorthand and appears in venue names the clerk
// publishes ("GR Fire Department Division Station", "GRPS University").
// Without it here, displayCase renders the city's name as "Gr".
const ACRONYMS = { US: 1, NB: 1, SB: 1, EB: 1, WB: 1,
                   SO: 1, NO: 1, EO: 1, WO: 1, GR: 1, GRPS: 1 };

// UPPER when immediately followed by a number: US 131, M 6, I 196.
const HWY = { US: 1, M: 1, I: 1 };

// Lowercase unless they open the string.
const MINOR = { OF: 1, AND: 1, THE: 1, AT: 1, IN: 1, ON: 1, FOR: 1 };

const ORDINAL = /^(\d+)(ST|ND|RD|TH)$/;
// Alternating word and non-word runs, both preserved exactly.
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

// Released into the public domain under the Unlicense, see UNLICENSE.
// The election calendar, shared by both pages.
//
// Both pages read the calendar through this module, because two readings of
// it drift apart: two copies of "today", of the next election and of the
// early voting window will sooner or later disagree, and a page that calls
// early voting open on a day the other calls it closed sends someone to a
// locked door.
//
// The formats are named for what they produce rather than for how pretty
// they are, and the window's state is decided in ONE place, windowState(),
// which both pages ask. Wording stays with each page: the two surfaces say
// different things on purpose, and only the calendar underneath has to agree.
//
// Every date here is a local Y-M-D string. Never new Date(iso): that parses
// as UTC midnight and lands on the previous day for anyone west of
// Greenwich, which prints the wrong weekday for an election.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
                'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday',
                  'Friday', 'Saturday'];
// The clerk publishes early voting hours as a weekday pattern rather than as
// dated rows, so a rule is matched by weekday. Indexes line up with the
// abbreviations the data file uses.
const DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

// A Date's own local day, as a Y-M-D string.
function isoOf(d) {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function todayISO() { return isoOf(new Date()); }

// Today's weekday abbreviation, for picking today's row out of the hours.
function todayAbbr() { return DAY_ABBR[new Date().getDay()]; }

// Local midnight starting the given date, or null if it is not a date.
function dayStart(iso) {
  const m = ISO.exec(String(iso || ''));
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

// "2026-11-03" -> "November 3, 2026". Falls back to what it was handed,
// since this also formats dates read out of a data file.
function monthDay(iso) {
  const m = ISO.exec(String(iso || ''));
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : (iso || '');
}

// "2026-11-03" -> "Tuesday, November 3, 2026". The weekday leads because it
// is what people plan around; a bare date sends the reader to a calendar.
function withWeekday(iso) {
  const d = dayStart(iso);
  return d ? `${WEEKDAYS[d.getDay()]}, ${monthDay(iso)}` : (iso || '');
}

// "2026-11-03" -> "Tuesday, November 3". For use next to another date that
// already carries the year, where repeating it adds nothing.
function dayMonth(iso) { return withWeekday(iso).replace(/, \d{4}$/, ''); }

// "7:00 AM" -> "7 AM". Only on the hour: the clerk publishes half hours for
// early voting and those keep their minutes.
function shortTime(t) {
  return String(t || '').replace(/:00(?=\s*[AP]M\b)/i, '');
}

// The next election on or after today. Sorted rather than trusting file
// order, so an out-of-order entry cannot hide the election that is next.
function next(list, today) {
  const t = today || todayISO();
  const future = (list || []).filter((e) => e && e.date >= t);
  future.sort((a, b) => (a.date < b.date ? -1 : 1));
  return future[0] || null;
}

function sites(e) { return e?.early_voting_sites || []; }

// The first day an absentee ballot can go back for this election, or null
// if it has no readable date. Michigan mails absentee ballots 40 days out,
// so a drop box standing open before then has nothing to accept. Statute,
// not something a clerk publishes, which is why it is one number here and
// not a field in the calendar.
const ABSENTEE_LEAD_DAYS = 40;
function absenteeFrom(e) {
  const d = dayStart(e?.date);
  if (!d) return null;
  d.setDate(d.getDate() - ABSENTEE_LEAD_DAYS);
  return isoOf(d);
}

// "7:00 AM" / "8:00 PM" -> the instant on that date, local time. The
// statutory hours are written the way the Secretary of State writes them,
// so this reads that form and nothing else; anything it cannot read is
// null, and the caller falls back to knowing only that it is election day.
const CLOCK = /^\s*(\d{1,2})(?::(\d{2}))?\s*([AP])\.?M\.?\s*$/i;
function atTime(iso, clock) {
  const day = dayStart(iso);
  const m = CLOCK.exec(String(clock || ''));
  if (!day || !m) return null;
  const h = Number(m[1]) % 12 + (m[3].toUpperCase() === 'P' ? 12 : 0);
  day.setHours(h, Number(m[2] || 0), 0, 0);
  return day;
}

// Where election day stands right now: 'before' the polls open, 'open',
// or 'closed'. null on any other day, or when the hours cannot be read.
// Takes the instant as an argument so it can be tested at fixed times.
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

// The four states of the early voting window, decided once.
//
//   'none'    the clerk has published nothing, or only half a window. A
//             start with no end is not a window a voter can act on.
//   'before'  published, not started.
//   'open'    today falls inside it.
//   'closed'  it has been and gone. Since the election this belongs to is
//             always the NEXT one, 'closed' means exactly "over, with the
//             election still ahead" -- the state that matters most, because
//             a reader who saw a site listed last week would otherwise
//             drive to a locked door.
function windowState(e, today) {
  if (!e || !e.early_voting_from || !e.early_voting_to) return 'none';
  const t = today || todayISO();
  if (t > e.early_voting_to) return 'closed';
  if (t < e.early_voting_from) return 'before';
  return 'open';
}

const Elections = {
  todayISO, todayAbbr, dayStart, monthDay, withWeekday, dayMonth, shortTime,
  next, sites, absenteeFrom, atTime, pollsPhase, windowState
};

/* Released into the public domain under the Unlicense, see UNLICENSE.
 * Precinct + polling-place lookup.
 *
 * The matching logic here (parseTyped / streetMatches / resolve) is carried
 * over from the earlier vote-gr project, so the two tools answer "which
 * precinct is this address in" identically. Keeping it a faithful copy is
 * deliberate: two implementations of the same lookup would eventually
 * disagree, and disagreeing about someone's polling place is the one failure
 * this tool must not have.
 *
 * As in vote-gr, the whole lookup is a dictionary hit against a file the page
 * already downloaded. The address is never sent anywhere.
 */

const QUADRANT = { NE: 1, NW: 1, SE: 1, SW: 1 };

// Two ways to build one.
//
// The original: addresses.json and polling.json, the Grand Rapids files,
// where a precinct is identified by its bare number ("52") and every row is
// [house number, "52", metres from the precinct edge]. The tests still
// build this way. /simple reads the same two files with its own copy of
// this lookup and does not load this file.
//
// Precincts.county(): all thirty jurisdictions at once. There a bare number
// is no identity at all (every one of the thirty has a Precinct 1), so
// every precinct is identified by the state's 13-digit code
// ("0814282001001": county 081, Kentwood 42820, ward 01, precinct 001),
// and the display number, the ward if the jurisdiction has wards, and the
// jurisdiction's name are looked up from that code. Both modes store rows
// the same way, [number, id, edge metres, rivals], so every method below
// works on an `id` and does not know which kind it is holding.
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

    // Identity, from the precinct index: what each code means.
    const list = opts.index?.precincts || [];
    for (const pr of list) {
      P.byCode[pr.code] = { mcd: pr.mcd, jurisdiction: pr.jurisdiction,
                            ward: pr.ward ?? null,
                            precinct: pr.precinct, name: pr.name };
      P.jurisdictions[pr.mcd] = pr.jurisdiction;
    }

    // Addresses. A chunk stores its precincts as a list and each row points
    // at a position in it, so 227,000 rows do not repeat a 13-digit string;
    // here the position becomes the code. A street name found in more than
    // one jurisdiction merges into one list, sorted by number, and each row's
    // code says which jurisdiction it is in. Sometimes that is one street
    // crossing a line (28th St SE runs through three); as often it is two
    // streets that share a name (Rockford and Cedar Springs each have a N
    // Main St NE), so an address is answered within one jurisdiction: see
    // places() below.
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

    // Polling places, keyed by code. The county's scrape supplies every
    // jurisdiction; Grand Rapids is then overwritten from polling.json, the
    // hand transcription with coordinates, entrance notes and the one
    // consolidation the county page does not know about.
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

  // What an id means for display. In the city files the id IS the number.
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

  // The id a polygon carries, in whichever mode this index is in.
  idOf(polygon) {
    return this.byCode ? polygon.code : String(polygon.precinct);
  }

  // Which jurisdictions a street's rows fall in. Cached: the type-ahead asks
  // for every suggestion on every keystroke.
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

  // A jurisdiction's drop boxes, from the county's page. The county lists
  // Grand Rapids' too, but the page answers Grand Rapids from the city
  // clerk's own file instead (boxesFor in app.js).
  dropBoxes(mcd) {
    return this.boxes?.[mcd] || [];
  }

  // The jurisdiction's own clerk: address, phone, and a coordinate where the
  // build could place it. Where no drop box is published this is where an
  // absentee ballot goes, because under MCL 168.764a it has to reach the
  // voter's own clerk and nobody else's.
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

  // Every street in the list in its canonical form, built once. `bare` has
  // every name with its quadrant left out; `unquartered` only the names that
  // never had one.
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
    // Nothing under the county's spelling, so try it under everyone's. This
    // runs only when the match above found nothing, so no answer that match
    // gives can change: the lookup it was copied from still holds.
    let q = canonQuery(rest);
    const { list: canon, quartered } = this._canon();
    const names = this.streetNames;
    if (!q.length) return [];
    const at = [];
    for (let i = 0; i < canon.length; i++) if (streetMatches(canon[i], q)) at.push(i);
    // Still nothing, and the text names a quadrant: try it against the
    // streets the county writes with none. The state writes E FULTON ST SE in
    // Ada where the county writes FULTON ST E, and covers() already counts
    // those as one street, so the match has to be able to find it too.
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

  // Whether the address list has this street, under any spelling of it. A
  // quadrant on one side and none on the other is not a disagreement: the
  // state writes ARBOR CHASE CT where the county writes ARBOR CHASE CT NE,
  // and E FULTON ST SE in Ada where the county writes FULTON ST E. Two
  // different quadrants are, and stay two streets.
  covers(name) {
    const c = canonName(name);
    const k = this._canon();
    return !!(k.full[c.key] ||
              (!c.quad && k.bare[c.bare]) ||
              (c.quad && k.unquartered[c.bare]));
  }

  // Whether the address list has any addresses in this jurisdiction, by the
  // name the precinct index gives it ("Walker", "Grand Rapids Township").
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

  // Of a street -> [jurisdiction] map, the part this index cannot answer. A
  // street it has under any spelling is dropped, except in a jurisdiction it
  // has no addresses for; a street it does not have is kept whole. What is
  // left is what the page may truthfully call a street it cannot look up.
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

  // ---- one street name, several places -------------------------------------
  //
  // 25 N Main St NE is a real address in Rockford and in Cedar Springs, eight
  // miles apart. Read off the merged list, it was answered as whichever town
  // sorted first, and a number between two of one town's houses could be
  // inferred from the other town's. So the jurisdiction comes first: which
  // ones could hold this address, and then the answer within one of them.

  // The jurisdiction a row is in, by its code. Null in the city files.
  mcdOf(row) {
    const d = this.byCode?.[row[1]];
    return d ? d.mcd : null;
  }

  // A street's rows, or only those in one jurisdiction.
  _rows(street, mcd) {
    const rows = this.streets[street];
    if (!rows || !mcd || !this.byCode) return rows || null;
    const mine = rows.filter((r) => this.mcdOf(r) === mcd);
    return mine.length ? mine : null;
  }

  // Every jurisdiction that could hold this address: those with the number on
  // file, or failing that, those whose own rows on the street bracket it.
  // Usually one. Empty in the city files, and when a number falls between two
  // jurisdictions' rows on a street that crosses the line, which resolve()
  // then answers from the merged list as the boundary case it is.
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

  // Resolve a house number on a street. Answers only when the neighbors on
  // the SAME SIDE agree, because a precinct line often runs down the middle of
  // a street, putting odd and even in different precincts. With `mcd`, only
  // that jurisdiction's rows are read.
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

  // Where a precinct actually votes. Honors `consolidated_with`, which is how
  // the clerk records a precinct voting at another precinct's location for one
  // election -- it appears only in the directory's FOOTNOTES.
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

  // Suggestions for the type-ahead. Returns real addresses that exist in the
  // index, so the person picks a known answer instead of being told after the
  // fact that what they typed is not in it. A house number that is missing
  // stops being an error and becomes "did you mean one of these".
  suggest(text, limit) {
    limit = limit || 8;
    const t = this.parseTyped(text);
    const streets = this.matchingStreets(t.rest);
    if (!streets.length) return [];

    // No number yet: offer streets, so the next keystroke has somewhere to go.
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
    // Exact hits first, across every matching street, then inferred ones
    // (between known neighbors on the same side). One row per jurisdiction
    // that could hold the address, each naming only that jurisdiction.
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
    // Nearby house numbers are a LAST RESORT, offered only when the number
    // typed matches nothing anywhere. Listing a street's other addresses
    // beside a perfectly good answer just makes the reader pick their own
    // address out of a lineup of their neighbors'.
    if (out.length) return markChoices(out).slice(0, limit).map(tag);

    // Before falling back to neighbors, try the SAME number on the same
    // street in another quadrant. Grand Rapids numbers radiate from Fulton
    // and Division, so each quadrant starts its own count and the same low
    // number can exist in one quadrant and not the other: there is no 15
    // Burton St SE, though 15 Burton St SW is a real address. A quadrant slip
    // is a far likelier mistake than being three houses out, so it is offered
    // first.
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

  // Full lookup: typed text -> everything the page needs, or a reason it can't.
  // `mcd` is the jurisdiction the reader picked. Without one, an address
  // more than one jurisdiction could hold is not answered: the error names
  // the places, and the reader chooses.
  lookup(text, mcd) {
    const t = this.parseTyped(text);
    if (t.number == null) return { error: 'no_number', rest: t.rest,
                                   suggestions: this.matchingStreets(t.rest).slice(0, 6) };
    const candidates = this.matchingStreets(t.rest);
    if (!candidates.length) return { error: 'no_street', rest: t.rest };
    // exact name wins; otherwise the best-ranked match
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
      // `precinct` is the number a voter recognises; `code` is the identity.
      // In the city files they are the same string.
      code: who.code, precinct: who.precinct, ward: who.ward,
      jurisdiction: who.jurisdiction, mcd: who.mcd, place,
      // Rivals as display numbers, since that is what the reader is shown.
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

  // An inferred address has no parcel of its own, so its precinct is read off
  // the neighbors either side of it. That breaks where a precinct line runs
  // down the middle of a street: 401 Ionia Ave SW has 400, 404 and 408 sitting
  // across the road in precinct 6, while 401 itself is in 15. Where such an
  // address geocodes and the boundary disagrees with the neighbors, the
  // boundary wins, and both precincts are still named so the reader can see
  // the call was close.
  //
  // INFERRED ADDRESSES ONLY. An exact parcel match already got its precinct
  // from the parcel point itself; geocoding it lands on the street centerline
  // instead, which disagrees with the polygon for about 1 in 15 of them.
  // Letting the polygon win there would trade a handful of real corrections
  // for hundreds of fresh errors.
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

// "BURTON ST SE" -> "BURTON ST". Used to find the same street in a different
// quadrant; returns null when there is no quadrant to strip.
function strippedQuadrant(name) {
  const m = String(name || '').toUpperCase().trim()
    .match(/^(.*?)\s+(NE|NW|SE|SW)$/);
  return m ? m[1] : null;
}

// ---- two spellings of one street --------------------------------------
//
// The address list is the county's parcel file, and nobody else writes a
// street quite the way it does. A reader types "E Fulton St" where the
// county writes FULTON ST E, and "Saint Andrews" or "Street" where it
// writes ST. The state road layer that neighbors.json comes from writes
// HOLW for HOLLOW, RDG for RIDGE and E BELTLINE for EAST BELTLINE. So every
// word below folds to one form, on both sides of the comparison, and a lone
// N, S, E or W moves to the end whether it led or trailed. router.js reads
// the same leading-or-trailing disagreement between the parcel file and the
// centerlines this way.
//
// Unlike router.js this keeps the street type and the quadrant. The router
// matches a name against road segments and lets the house number settle
// the rest; here the name is what picks the street, and a court and a drive
// of one name are two streets, as is one name in two quadrants. Where the
// county and the state disagree about those, the disagreement stands and
// the street stays unanswered rather than answered as its neighbor.
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

// A whole street name: "E BELTLINE AVE NE" and "EAST BELTLINE AVE NE" both
// come out as BELTLINE AVE NE E. `bare` leaves the quadrant out, for a name
// the state wrote without one.
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

// What a reader has typed so far, which may stop halfway through a word.
// Only a LEADING direction moves: a trailing S may be the start of ST, and
// left where it is it still lines up with the end of the name.
function canonQuery(rest) {
  const w = foldWords(rest);
  if (w.length > 1 && CARDINAL[w[0]]) w.push(w.shift());
  return w;
}

// The same number and street offered in more than one jurisdiction is a
// question only the reader can answer, so each such row says so. Enter
// then opens the list rather than taking the first of them.
function markChoices(list) {
  const count = {};
  list.forEach((o) => {
    const k = `${o.number}|${o.street}`;
    count[k] = (count[k] || 0) + 1;
  });
  list.forEach((o) => { if (count[`${o.number}|${o.street}`] > 1) o.choice = true; });
  return list;
}

// ---- point in polygon --------------------------------------------------
// The one ray cast in the project. The precinct lookup below, app.js's
// "inside this jurisdiction" test that keeps a geocoded address on its own
// town's street, scripts/compare_osrm.mjs and the tests all call this
// rather than keeping their own copy, so none of them can drift into
// disagreeing about which side of a line a point falls on.
//
// Rings are [lat, lng] pairs, as precincts.json stores them; a caller
// holding [lng, lat] rings (boundary.json) swaps them once before calling.
// A polygon with several rings toggles across all of them, so holes work.
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
