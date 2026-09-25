/* Precinct + polling-place lookup.
 * Released into the public domain under the Unlicense, see UNLICENSE.
 *
 * The matching logic here (parseTyped / streetMatches / resolve) is carried
 * over from the earlier vote-gr project, so the two tools answer "which
 * precinct is this address in" identically. Keeping it a faithful copy is
 * deliberate: two implementations of the same lookup would eventually
 * disagree, and disagreeing about someone's polling place is the one failure
 * this tool must not have. Like everything else here it is public domain
 * under the Unlicense.
 *
 * As in vote-gr, the whole lookup is a dictionary hit against a file the page
 * already downloaded. The address is never sent anywhere.
 */
(function (root) {
  'use strict';

  // Two ways to build one.
  //
  // The original: addresses.json and polling.json, the Grand Rapids files,
  // where a precinct is identified by its bare number ("52") and every row is
  // [house number, "52", metres from the precinct edge]. /simple and the
  // tests still build this way, and it keeps working unchanged.
  //
  // Precincts.county(): all thirty jurisdictions at once. There a bare number
  // is no identity at all -- there is a Precinct 1 in twenty-nine places --
  // so every precinct is identified by the state's 13-digit code
  // ("0814282001001": county 081, Kentwood 42820, ward 01, precinct 001),
  // and the display number, the ward if the jurisdiction has wards, and the
  // jurisdiction's name are looked up from that code. Both modes store rows
  // the same way, [number, id, edge metres, rivals], so every method below
  // works on an `id` and does not know which kind it is holding.
  function Precincts(addresses, polling) {
    this.county = false;
    this.wards = addresses.wards || {};
    this.streets = addresses.streets || {};
    this.streetNames = Object.keys(this.streets);
    this.polling = (polling && polling.precincts) || {};
    this.byCode = null;
    this.boxes = {};
    this.clerks = {};
  }

  // opts: { index: precincts.json, addresses: [chunk...], polling: [chunk...],
  //         cityPolling: polling.json, cityMcd: '34000' }
  Precincts.county = function (opts) {
    var P = Object.create(Precincts.prototype);
    P.county = true;
    P.wards = {};
    P.streets = {};
    P.polling = {};
    P.boxes = {};
    P.clerks = {};
    P.byCode = {};
    P.jurisdictions = {};
    var i, j, code;

    // Identity, from the precinct index: what each code means.
    var list = (opts.index && opts.index.precincts) || [];
    for (i = 0; i < list.length; i++) {
      var pr = list[i];
      P.byCode[pr.code] = { mcd: pr.mcd, jurisdiction: pr.jurisdiction,
                            ward: pr.ward == null ? null : pr.ward,
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
    var docs = opts.addresses || [];
    var dirty = {};
    for (i = 0; i < docs.length; i++) {
      var doc = docs[i], codes = doc.precincts || [];
      var streets = doc.streets || {};
      for (var name in streets) {
        if (!Object.prototype.hasOwnProperty.call(streets, name)) continue;
        var rows = streets[name];
        var into = P.streets[name] || (P.streets[name] = []);
        if (into.length) dirty[name] = 1;
        for (j = 0; j < rows.length; j++) {
          var r = rows[j];
          var out = [r[0], codes[r[1]], r[2]];
          if (r[3]) {
            out.push(r[3].map(function (k) { return codes[k]; }));
          }
          into.push(out);
        }
      }
    }
    for (var d in dirty) {
      if (Object.prototype.hasOwnProperty.call(dirty, d)) {
        P.streets[d].sort(function (a, b) { return a[0] - b[0]; });
      }
    }
    P.streetNames = Object.keys(P.streets);

    // Polling places, keyed by code. The county's scrape supplies every
    // jurisdiction; Grand Rapids is then overwritten from polling.json, the
    // hand transcription with coordinates, entrance notes and the one
    // consolidation the county page does not know about.
    var pdocs = opts.polling || [];
    for (i = 0; i < pdocs.length; i++) {
      var pd = pdocs[i], recs = pd.precincts || {};
      for (code in recs) {
        if (Object.prototype.hasOwnProperty.call(recs, code)) P.polling[code] = recs[code];
      }
      if (pd.mcd && pd.drop_boxes) P.boxes[pd.mcd] = pd.drop_boxes;
      if (pd.mcd && pd.clerk) P.clerks[pd.mcd] = pd.clerk;
    }
    var cityMcd = opts.cityMcd || '34000';
    var cityRecs = (opts.cityPolling && opts.cityPolling.precincts) || {};
    var numberToCode = {};
    for (code in P.byCode) {
      if (Object.prototype.hasOwnProperty.call(P.byCode, code) &&
          P.byCode[code].mcd === cityMcd) {
        numberToCode[String(P.byCode[code].precinct)] = code;
      }
    }
    for (var num in cityRecs) {
      if (!Object.prototype.hasOwnProperty.call(cityRecs, num)) continue;
      var target = numberToCode[num];
      if (!target) continue;
      var rec = cityRecs[num], copy = {};
      for (var k in rec) if (Object.prototype.hasOwnProperty.call(rec, k)) copy[k] = rec[k];
      if (copy.consolidated_with != null) {
        copy.consolidated_with = numberToCode[String(copy.consolidated_with)] ||
                                 copy.consolidated_with;
      }
      P.polling[target] = copy;
    }
    return P;
  };

  // What an id means for display. In the city files the id IS the number.
  Precincts.prototype.describe = function (id) {
    if (this.byCode) {
      var d = this.byCode[id];
      return d ? { code: id, precinct: d.precinct, ward: d.ward,
                   jurisdiction: d.jurisdiction, mcd: d.mcd }
               : { code: id, precinct: id, ward: null, jurisdiction: null, mcd: null };
    }
    return { code: String(id), precinct: id, ward: this.wards[id] || null,
             jurisdiction: null, mcd: null };
  };

  // The id a polygon carries, in whichever mode this index is in.
  Precincts.prototype.idOf = function (polygon) {
    return this.byCode ? polygon.code : String(polygon.precinct);
  };

  // Which jurisdictions a street's rows fall in. Cached: the type-ahead asks
  // for every suggestion on every keystroke.
  Precincts.prototype.whereIs = function (street) {
    if (!this.byCode) return null;
    this._where = this._where || {};
    if (this._where[street]) return this._where[street];
    var rows = this.streets[street] || [], seen = {}, names = [];
    for (var i = 0; i < rows.length; i++) {
      var d = this.byCode[rows[i][1]];
      if (d && !seen[d.jurisdiction]) { seen[d.jurisdiction] = 1; names.push(d.jurisdiction); }
    }
    return (this._where[street] = names);
  };

  // A jurisdiction's drop boxes, from the county's page. Grand Rapids' own
  // come from the city clerk's file instead and are not here.
  Precincts.prototype.dropBoxes = function (mcd) {
    return (this.boxes && this.boxes[mcd]) || [];
  };

  // The jurisdiction's own clerk: address, phone, and a coordinate where the
  // build could place it. Where no drop box is published this is where an
  // absentee ballot goes, because under MCL 168.764a it has to reach the
  // voter's own clerk and nobody else's.
  Precincts.prototype.clerkOf = function (mcd) {
    return (this.clerks && this.clerks[mcd]) || null;
  };

  // "250 Monroe Ave. NW" -> { number: 250, rest: "MONROE AVE NW" }
  Precincts.prototype.parseTyped = function (text) {
    var clean = String(text || '').toUpperCase().replace(/[.,]/g, ' ')
      .replace(/\s+/g, ' ').trim();
    var m = clean.match(/^(\d+)\s*(.*)$/);
    return m ? { number: Number(m[1]), rest: m[2] } : { number: null, rest: clean };
  };

  // Every typed word must begin a word of the street name, in order.
  function streetMatches(street, tokens) {
    var words = street.split(' '), at = 0;
    for (var i = 0; i < tokens.length; i++) {
      while (at < words.length && words[at].indexOf(tokens[i]) !== 0) at++;
      if (at >= words.length) return false;
      at++;
    }
    return true;
  }

  // "BURTON ST SE" -> "BURTON ST". Used to find the same street in a different
  // quadrant; returns null when there is no quadrant to strip.
  function strippedQuadrant(name) {
    var m = String(name || '').toUpperCase().trim()
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
  // centrelines this way.
  //
  // Unlike router.js this keeps the street type and the quadrant. The router
  // matches a name against road segments and lets the house number settle
  // the rest; here the name is what picks the street, and a court and a drive
  // of one name are two streets, as is one name in two quadrants. Where the
  // county and the state disagree about those, the disagreement stands and
  // the street stays unanswered rather than answered as its neighbour.
  var WORDS = {
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
  var CARDINAL = { N: 1, S: 1, E: 1, W: 1 };
  var QUADRANT = { NE: 1, NW: 1, SE: 1, SW: 1 };

  function foldWords(text) {
    return String(text || '').toUpperCase().replace(/[.,]/g, ' ')
      .replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)
      .map(function (t) { return WORDS[t] || t; });
  }

  // A whole street name: "E BELTLINE AVE NE" and "EAST BELTLINE AVE NE" both
  // come out as BELTLINE AVE NE E. `bare` leaves the quadrant out, for a name
  // the state wrote without one.
  function canonName(name) {
    var w = foldWords(name), dir = null, quad = null;
    if (w.length > 1 && CARDINAL[w[w.length - 1]]) dir = w.pop();
    else if (w.length > 1 && CARDINAL[w[0]]) dir = w.shift();
    if (w.length > 1 && QUADRANT[w[w.length - 1]]) quad = w.pop();
    var bare = dir ? w.concat([dir]) : w;
    return { key: (quad ? w.concat([quad]) : w).concat(dir ? [dir] : []).join(' '),
             bare: bare.join(' '), quad: quad };
  }

  // What a reader has typed so far, which may stop halfway through a word.
  // Only a LEADING direction moves: a trailing S may be the start of ST, and
  // left where it is it still lines up with the end of the name.
  function canonQuery(rest) {
    var w = foldWords(rest);
    if (w.length > 1 && CARDINAL[w[0]]) w.push(w.shift());
    return w;
  }

  // Every street in the list in its canonical form, built once. `bare` has
  // every name with its quadrant left out; `unquartered` only the names that
  // never had one.
  Precincts.prototype._canon = function () {
    if (this._canonCache) return this._canonCache;
    var names = this.streetNames, list = [], quartered = [];
    var full = {}, bare = {}, unquartered = {};
    for (var i = 0; i < names.length; i++) {
      var c = canonName(names[i]);
      list.push(c.key);
      quartered.push(!!c.quad);
      full[c.key] = 1;
      bare[c.bare] = 1;
      if (!c.quad) unquartered[c.bare] = 1;
    }
    return (this._canonCache = { list: list, quartered: quartered, full: full,
                                 bare: bare, unquartered: unquartered });
  };

  Precincts.prototype.matchingStreets = function (rest) {
    var tokens = String(rest || '').split(' ').filter(Boolean);
    if (!tokens.length) return [];
    var hits = this.streetNames.filter(function (s) { return streetMatches(s, tokens); });
    if (hits.length) {
      return hits.sort(function (a, b) {
        var lead = function (s) { return s.indexOf(tokens[0]) === 0 ? 0 : 1; };
        return lead(a) - lead(b) || a.length - b.length || a.localeCompare(b);
      });
    }
    // Nothing under the county's spelling, so try it under everyone's. This
    // runs only when the match above found nothing, so no answer that match
    // gives can change: the lookup it was copied from still holds.
    var q = canonQuery(rest), k = this._canon(), names = this.streetNames;
    var canon = k.list;
    if (!q.length) return [];
    var at = [], i;
    for (i = 0; i < canon.length; i++) if (streetMatches(canon[i], q)) at.push(i);
    // Still nothing, and the text names a quadrant: try it against the
    // streets the county writes with none. The state writes E FULTON ST SE in
    // Ada where the county writes FULTON ST E, and covers() already counts
    // those as one street, so the match has to be able to find it too.
    if (!at.length) {
      var unq = q.filter(function (t) { return !QUADRANT[t]; });
      if (unq.length && unq.length < q.length) {
        for (i = 0; i < canon.length; i++) {
          if (!k.quartered[i] && streetMatches(canon[i], unq)) at.push(i);
        }
        q = unq;
      }
    }
    return at.sort(function (a, b) {
      var lead = function (k) { return canon[k].indexOf(q[0]) === 0 ? 0 : 1; };
      return lead(a) - lead(b) || canon[a].length - canon[b].length ||
             names[a].localeCompare(names[b]);
    }).map(function (k) { return names[k]; });
  };

  // Whether the address list has this street, under any spelling of it. A
  // quadrant on one side and none on the other is not a disagreement: the
  // state writes ARBOR CHASE CT where the county writes ARBOR CHASE CT NE,
  // and E FULTON ST SE in Ada where the county writes FULTON ST E. Two
  // different quadrants are, and stay two streets.
  Precincts.prototype.covers = function (name) {
    var c = canonName(name), k = this._canon();
    return !!(k.full[c.key] ||
              (!c.quad && k.bare[c.bare]) ||
              (c.quad && k.unquartered[c.bare]));
  };

  // Whether the address list has any addresses in this jurisdiction, by the
  // name the precinct index gives it ("Walker", "Grand Rapids Township").
  Precincts.prototype.coversJurisdiction = function (name) {
    if (!this._jset) {
      this._jset = {};
      for (var mcd in this.jurisdictions || {}) {
        if (Object.prototype.hasOwnProperty.call(this.jurisdictions, mcd)) {
          this._jset[this.jurisdictions[mcd]] = 1;
        }
      }
    }
    return !!this._jset[name];
  };

  // Of a street -> [jurisdiction] map, the part this index cannot answer. A
  // street it has under any spelling is dropped, except in a jurisdiction it
  // has no addresses for; a street it does not have is kept whole. What is
  // left is what the page may truthfully call a street it cannot look up.
  Precincts.prototype.unindexed = function (streets) {
    var out = {}, self = this;
    for (var name in streets || {}) {
      if (!Object.prototype.hasOwnProperty.call(streets, name)) continue;
      var where = streets[name] || [];
      if (this.covers(name)) {
        where = where.filter(function (j) { return !self.coversJurisdiction(j); });
      }
      if (where.length) out[name] = where;
    }
    return out;
  };

  // ---- one street name, several places -------------------------------------
  //
  // 25 N Main St NE is a real address in Rockford and in Cedar Springs, eight
  // miles apart. Read off the merged list, it was answered as whichever town
  // sorted first, and a number between two of one town's houses could be
  // inferred from the other town's. So the jurisdiction comes first: which
  // ones could hold this address, and then the answer within one of them.

  // The jurisdiction a row is in, by its code. Null in the city files.
  Precincts.prototype.mcdOf = function (row) {
    var d = this.byCode && this.byCode[row[1]];
    return d ? d.mcd : null;
  };

  // A street's rows, or only those in one jurisdiction.
  Precincts.prototype._rows = function (street, mcd) {
    var rows = this.streets[street];
    if (!rows || !mcd || !this.byCode) return rows || null;
    var self = this;
    var mine = rows.filter(function (r) { return self.mcdOf(r) === mcd; });
    return mine.length ? mine : null;
  };

  // Every jurisdiction that could hold this address: those with the number on
  // file, or failing that, those whose own rows on the street bracket it.
  // Usually one. Empty in the city files, and when a number falls between two
  // jurisdictions' rows on a street that crosses the line, which resolve()
  // then answers from the merged list as the boundary case it is.
  Precincts.prototype.places = function (street, number) {
    var rows = this.streets[street];
    if (!rows || !this.byCode || number == null) return [];
    var self = this, mcds = [], seen = {}, exact = [], i, m;
    for (i = 0; i < rows.length; i++) {
      m = this.mcdOf(rows[i]);
      if (m && !seen[m]) { seen[m] = 1; mcds.push(m); }
      if (m && rows[i][0] === number && exact.indexOf(m) < 0) exact.push(m);
    }
    if (exact.length) return exact;
    return mcds.filter(function (mcd) { return !!self.resolve(street, number, mcd); });
  };

  // Resolve a house number on a street. Answers only when the neighbors on
  // the SAME SIDE agree, because a precinct line often runs down the middle of
  // a street, putting odd and even in different precincts. With `mcd`, only
  // that jurisdiction's rows are read.
  Precincts.prototype.resolve = function (street, number, mcd) {
    var rows = this._rows(street, mcd);
    if (!rows) return null;

    var exact = null;
    for (var i = 0; i < rows.length; i++) if (rows[i][0] === number) { exact = rows[i]; break; }
    if (exact) {
      return { precinct: exact[1], edgeMetres: exact[2],
               rivals: exact[3] || null, inferred: false };
    }
    var sameSide = rows.filter(function (r) { return r[0] % 2 === number % 2; });
    var below = null, above = null;
    for (var j = 0; j < sameSide.length; j++) {
      if (sameSide[j][0] < number) below = sameSide[j];
      else if (sameSide[j][0] > number) { above = sameSide[j]; break; }
    }
    if (!below || !above) return null;      // outside known range: do not extrapolate
    if (below[1] !== above[1]) {
      return { precinct: below[1], rivals: [below[1], above[1]], inferred: true,
               edgeMetres: Infinity };
    }
    return { precinct: below[1], edgeMetres: Math.min(below[2], above[2]),
             rivals: null, inferred: true };
  };

  // Where a precinct actually votes. Honors `consolidated_with`, which is how
  // the clerk records a precinct voting at another precinct's location for one
  // election -- it appears only in the directory's FOOTNOTES.
  Precincts.prototype.pollingPlace = function (precinct) {
    var p = this.polling[precinct];
    if (!p) return null;
    if (p.consolidated_with && this.polling[p.consolidated_with]) {
      var host = this.polling[p.consolidated_with];
      return { name: host.name, address: host.address, lat: host.lat, lng: host.lng,
               entrance_note: host.entrance_note,
               consolidated_with: p.consolidated_with, note: p.note };
    }
    return { name: p.name, address: p.address, lat: p.lat, lng: p.lng,
             entrance_note: p.entrance_note };
  };

  Precincts.prototype.ward = function (id) { return this.describe(id).ward; };

  // Suggestions for the type-ahead. Returns real addresses that exist in the
  // index, so the person picks a known answer instead of being told after the
  // fact that what they typed is not in it. A house number that is missing
  // stops being an error and becomes "did you mean one of these".
  Precincts.prototype.suggest = function (text, limit) {
    limit = limit || 8;
    var t = this.parseTyped(text);
    var streets = this.matchingStreets(t.rest);
    if (!streets.length) return [];

    // No number yet: offer streets, so the next keystroke has somewhere to go.
    var self = this;
    var tag = function (o) {
      var w = o.mcd ? [self.jurisdictions[o.mcd]] : self.whereIs(o.street);
      if (w && w.length) o.where = w;
      return o;
    };
    if (t.number == null) {
      return streets.slice(0, limit).map(function (s) {
        return tag({ street: s, number: null, kind: 'street' });
      });
    }

    var out = [];
    // Exact hits first, across every matching street, then inferred ones
    // (between known neighbors on the same side). One row per jurisdiction
    // that could hold the address, each naming only that jurisdiction.
    ['exact', 'inferred'].forEach(function (kind) {
      streets.forEach(function (s) {
        if (out.some(function (o) { return o.street === s; })) return;
        var hasExact = self._hasNumber(s, t.number);
        if ((kind === 'exact') !== hasExact) return;
        var mcds = self.places(s, t.number);
        if (mcds.length) {
          mcds.forEach(function (mcd) {
            out.push({ street: s, number: t.number, kind: kind, mcd: mcd });
          });
        } else if (hasExact || self.resolve(s, t.number)) {
          out.push({ street: s, number: t.number, kind: kind });
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
    var base = strippedQuadrant(t.rest);
    if (base) {
      this.streetNames.forEach(function (s) {
        if (streets.indexOf(s) >= 0) return;
        if (strippedQuadrant(s) !== base) return;
        if (!self._hasNumber(s, t.number)) return;
        var mcds = self.places(s, t.number);
        (mcds.length ? mcds : [undefined]).forEach(function (mcd) {
          out.push({ street: s, number: t.number, kind: 'quadrant', mcd: mcd });
        });
      });
      if (out.length) return markChoices(out).slice(0, limit).map(tag);
    }

    streets.slice(0, 3).forEach(function (s) {
      var rows = self.streets[s] || [];
      var near = rows.slice().sort(function (a, b) {
        var da = Math.abs(a[0] - t.number), db = Math.abs(b[0] - t.number);
        if (da !== db) return da - db;
        // prefer the same side of the street
        var pa = a[0] % 2 === t.number % 2 ? 0 : 1;
        var pb = b[0] % 2 === t.number % 2 ? 0 : 1;
        return pa - pb;
      });
      for (var i = 0; i < near.length && i < 3; i++) {
        if (near[i][0] === t.number) continue;
        out.push({ street: s, number: near[i][0], kind: 'near',
                   mcd: self.mcdOf(near[i]) || undefined });
      }
    });

    // De-duplicate, keeping the strongest kind for each address.
    var seen = {}, uniq = [];
    out.forEach(function (o) {
      var k = o.number + '|' + o.street + '|' + (o.mcd || '');
      if (seen[k]) return;
      seen[k] = 1; uniq.push(o);
    });
    return markChoices(uniq).slice(0, limit).map(tag);
  };

  Precincts.prototype._hasNumber = function (street, number) {
    var rows = this.streets[street] || [];
    for (var i = 0; i < rows.length; i++) if (rows[i][0] === number) return true;
    return false;
  };

  // The same number and street offered in more than one jurisdiction is a
  // question only the reader can answer, so each such row says so. Enter
  // then opens the list rather than taking the first of them.
  function markChoices(list) {
    var count = {};
    list.forEach(function (o) {
      var k = o.number + '|' + o.street;
      count[k] = (count[k] || 0) + 1;
    });
    list.forEach(function (o) { if (count[o.number + '|' + o.street] > 1) o.choice = true; });
    return list;
  }

  // Full lookup: typed text -> everything the page needs, or a reason it can't.
  // `mcd` is the jurisdiction the reader picked. Without one, an address
  // more than one jurisdiction could hold is not answered: the error names
  // the places, and the reader chooses.
  Precincts.prototype.lookup = function (text, mcd) {
    var self = this;
    var t = this.parseTyped(text);
    if (t.number == null) return { error: 'no_number', rest: t.rest,
                                   suggestions: this.matchingStreets(t.rest).slice(0, 6) };
    var candidates = this.matchingStreets(t.rest);
    if (!candidates.length) return { error: 'no_street', rest: t.rest };
    // exact name wins; otherwise the best-ranked match
    var street = candidates.indexOf(t.rest) >= 0 ? t.rest : candidates[0];
    var places = mcd ? [mcd] : this.places(street, t.number);
    if (places.length > 1) {
      return { error: 'several_places', street: street, number: t.number,
               places: places.map(function (m) {
                 return { mcd: m, jurisdiction: self.jurisdictions[m] };
               }) };
    }
    var res = this.resolve(street, t.number, places[0]);
    if (!res) return { error: 'no_number_on_street', street: street,
                       number: t.number, ambiguous: candidates.slice(0, 6) };
    var place = this.pollingPlace(res.precinct);
    var who = this.describe(res.precinct);
    return {
      number: t.number, street: street,
      // `precinct` is the number a voter recognises; `code` is the identity.
      // In the city files they are the same string.
      code: who.code, precinct: who.precinct, ward: who.ward,
      jurisdiction: who.jurisdiction, mcd: who.mcd, place: place,
      // Rivals as display numbers, since that is what the reader is shown.
      rivals: res.rivals ? res.rivals.map(function (id) {
        return self.describe(id).precinct;
      }) : null,
      inferred: res.inferred, edgeMetres: res.edgeMetres,
      ambiguousStreet: candidates.length > 1 && candidates.indexOf(t.rest) < 0
        ? candidates.slice(0, 6) : null
    };
  };

  // ---- point in polygon --------------------------------------------------
  // The one ray cast in the project. The precinct lookup below, the city
  // limits check in app.js and the audit scripts all call this rather than
  // keeping their own copy, so none of them can drift into disagreeing about
  // which side of a line a point falls on.
  //
  // Rings are [lat, lng] pairs, as precincts.json stores them; a caller
  // holding [lng, lat] rings (boundary.json) swaps them once before calling.
  // A polygon with several rings toggles across all of them, so holes work.
  function pointInRings(lat, lng, rings) {
    var inside = false;
    for (var r = 0; r < rings.length; r++) {
      var ring = rings[r];
      for (var a = 0, b = ring.length - 1; a < ring.length; b = a++) {
        var yi = ring[a][0], xi = ring[a][1], yj = ring[b][0], xj = ring[b][1];
        if (((yi > lat) !== (yj > lat)) &&
            (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
      }
    }
    return inside;
  }

  Precincts.prototype.precinctAt = function (lat, lng, polygons) {
    if (!polygons) return null;
    for (var i = 0; i < polygons.length; i++) {
      if (pointInRings(lat, lng, polygons[i].rings)) return polygons[i];
    }
    return null;
  };

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
  Precincts.prototype.refineWithPolygon = function (r, geocodeFn, polygons) {
    if (!r || r.error || !r.inferred || !geocodeFn || !polygons) return r;
    var pt = geocodeFn(r.number, r.street);
    if (!pt) return r;
    var hit = this.precinctAt(pt.lat, pt.lng, polygons);
    if (!hit) return r;
    var id = this.idOf(hit);
    if (id === String(r.code)) return r;
    var was = r.precinct;
    var who = this.describe(id);
    r.code = who.code; r.precinct = who.precinct; r.ward = who.ward;
    r.jurisdiction = who.jurisdiction; r.mcd = who.mcd;
    r.place = this.pollingPlace(id);
    r.rivals = [r.precinct, was];
    r.refined = true;
    return r;
  };

  Precincts.pointInRings = pointInRings;
  root.Precincts = Precincts;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { Precincts: Precincts, pointInRings: pointInRings };
  }
})(typeof self !== 'undefined' ? self : this);
