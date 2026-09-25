// Released into the public domain under the Unlicense, see UNLICENSE.
// VoteGR.org, the light version: where you vote in Kent County, Michigan,
// with no map and no directions engine.
// https://github.com/Cantica-Systems/votegr

(function () {
  "use strict";

  const NEAR_M = 10;              // how close to a precinct line counts as "too close to be certain"
  const MAX_SUGGESTIONS = 6;
  const GR_MCD = "34000";         // the state's code for the City of Grand Rapids

  const $ = (id) => document.getElementById(id);
  const input = $("addr"), optionList = $("opts"), statusLine = $("status"), resultBox = $("result");

  // The whole lookup is a dictionary hit against files the page already
  // downloaded. There is no geocoder and no request: the address you type is
  // never sent anywhere, and a city or county server going down cannot stop
  // this working. The lookup itself is ../precinct.js, the one the map page
  // uses, so the two pages cannot give one address two answers.
  let P = null;           // Precincts.county(): every parcel address in the county
  let outside = null;     // street -> jurisdictions, for streets the address list cannot answer
  let clerk = null;       // gr-clerk.json: the city's early voting and drop boxes
  let election = null;    // the next election, or null once every date has passed
  let calendarElections = [];   // the whole calendar, for the day the line rolls over
  let suggestions = [];
  let active = -1;        // highlighted suggestion, -1 for none

  // Build an element. Extra arguments become children; strings become text.
  const el = (tag, cls, ...children) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    for (const child of children) if (child != null) node.append(child);
    return node;
  };

  const say = (message, isError) => {
    statusLine.className = isError ? "status err" : "status";
    statusLine.textContent = message || "";
  };

  const clearResult = () => { resultBox.textContent = ""; };

  const getJSON = async (url) => {
    const response = await fetch(url, { credentials: "omit" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  };

  // Set by render(); the Directions links start the route here.
  let typed = null;       // { text, where }

  // An address as OpenStreetMap's search box wants it, in the answer's
  // jurisdiction: "977 WEALTHY ST SW, 49504" and "Grand Rapids" become
  // "977 WEALTHY ST SW, Grand Rapids, MI 49504". One that already names
  // its town and state is left as it is.
  const fullAddress = (addr, where) => {
    if (/,\s*MI\b/i.test(addr)) return addr;
    const m = addr.match(/^(.*),\s*(\d{5})$/);
    return m ? `${m[1]}, ${where}, MI ${m[2]}` : `${addr}, ${where}, MI`;
  };

  // Both ends are addresses, not coordinates, so OSM's From and To boxes
  // read like the page the person just left. OSM geocodes them when its
  // page opens; nothing loads until the click, and only the click shares
  // the typed address. A place without an address links by coordinates.
  const osmLink = (place) => {
    const where = typed ? typed.where : "Kent County";
    const to = place.address
      ? `to=${encodeURIComponent(fullAddress(place.address, where))}`
      : `to=${place.lat},${place.lng}`;
    if (!typed) return `https://www.openstreetmap.org/directions?${to}`;
    const from = encodeURIComponent(fullAddress(typed.text, where));
    return `https://www.openstreetmap.org/directions?from=${from}&${to}`;
  };

  // The index is ALL CAPS because the parcel file is; that is not how anyone
  // writes an address. The lookup uppercases whatever it is handed, so the
  // box can show the readable form without anything downstream noticing.
  const cased = (s) => (typeof displayCase === "function" ? displayCase(s) : s);

  // The clerk types these however the day went: "gymnasium", "curbside",
  // "Across from Calder Plaza". Only the first letter moves: the rest can
  // hold names that were capitalised on purpose.
  const sentence = (s) => {
    const text = String(s || "").trim();
    return text ? text[0].toUpperCase() + text.slice(1) : "";
  };

  // The state says "Township" when it means one and nothing for a city, and
  // "City" is load-bearing: Grand Rapids Township is a real, different place
  // next door.
  const placeLabel = (name) => /Township$/i.test(name) ? name : `${name} City`;

  const placeList = (where) =>
    where.length === 1 ? where[0]
      : `${where.slice(0, -1).join(", ")} or ${where[where.length - 1]}`;

  // ---- rendering --------------------------------------------------------

  const advisory = (kind, text) => {
    const node = el("div", "advisory", text);
    node.dataset.kind = kind;
    return node;
  };

  // Drawn inline rather than loaded, so it costs no request and there is no
  // icon font to go missing. createElementNS matters here: createElement would
  // make an unknown HTML element that silently never paints.
  const SVG_NS = "http://www.w3.org/2000/svg";
  const directionsIcon = () => {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");     // the link carries the label
    svg.setAttribute("focusable", "false");
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", "M12 2 4.5 20.29l.71.71L12 18l6.79 3 .71-.71z");
    svg.append(path);
    return svg;
  };

  // An icon on its own says nothing to a screen reader, so the link is named
  // for the place it points at rather than left as "link".
  const mapLink = (place) => {
    const link = el("a", "dir-btn");
    link.rel = "noopener";
    link.target = "_blank";
    link.href = osmLink(place);
    link.title = `Directions to ${place.name}`;
    // The visible word is inside the accessible name, which is what keeps the
    // announced label and the printed label from disagreeing.
    link.setAttribute("aria-label", `Directions to ${place.name}`);
    link.append(directionsIcon(), el("span", "dir-label", "Directions"));
    return link;
  };

  // One location: the text on the left, directions on the right. Shared by
  // every place the card names, so they cannot drift apart.
  function locationRow(place, extraClass) {
    const row = el("div", extraClass ? `loc ${extraClass}` : "loc",
      el("div", "loc-text",
        el("div", "place", cased(place.name)),
        el("div", "addr", cased(place.address)),
        place.entrance_note
          ? el("div", "note", el("span", "note-l", "Location: "), sentence(place.entrance_note))
          : null));
    if (place.address || (place.lat != null && place.lng != null)) {
      row.append(mapLink(place));
    }
    return row;
  }

  function pollingPlace(found) {
    const place = found.place;
    if (!place) {
      return [advisory("missing",
        `We do not have a polling place listed for precinct ${found.precinct}. ` +
        "Please check the Michigan Voter Information Center.")];
    }
    const parts = [
      // No date here: the banner above already names the election and its day,
      // and saying it twice on one screen reads as two different facts.
      el("div", "lead-2", "Your voting day location"),
      locationRow(place),
    ];
    if (place.consolidated_with) {
      const host = P.describe(place.consolidated_with).precinct;
      parts.push(advisory("consolidated",
        `For this election, precinct ${found.precinct} votes at precinct ` +
        `${host}'s location${place.note ? `. ${place.note}.` : "."}`));
    }
    return parts;
  }

  // Today IS the day: early voting has closed, a drop box is a race against
  // the poll close, and the polling place is simply the answer. The map page
  // reorders for the same reason.
  const isElectionDay = () => !!election && Elections.todayISO() === election.date;

  function render(found, text) {
    typed = { text, where: found.jurisdiction };
    const { precinct, ward, edgeMetres, rivals, inferred } = found;
    // True when any of the three uncertainty advisories below will fire.
    const uncertain = Boolean(rivals || inferred || edgeMetres <= NEAR_M);
    const body = el("div", "card-body",
      el("div", "lead", "Address: ", el("span", "addr-quote", cased(text))),
      // The map page's words for the same three facts. A township has no
      // wards, so it gets no Ward rather than a blank one.
      el("div", "ward",
        el("span", "wp-label", "Where you vote:"), el("span", "wp-value", found.jurisdiction),
        ...(ward != null
          ? [el("span", "wp-label", "Ward:"), el("span", "wp-value", String(ward))]
          : []),
        el("span", "wp-label", "Precinct:"), el("span", "wp-value", String(precinct))),
      // Same order as the map page: the drop box is usable first and for
      // longest, early voting comes next, and election day is the deadline,
      // except on election day itself, when the deadline is now and the polls
      // lead. A reader who checks both pages should recognise the second.
      ...(isElectionDay()
        ? [...pollingPlace(found), ...dropBoxes(found), ...earlyVoting(found, uncertain)]
        : [...dropBoxes(found), ...earlyVoting(found, uncertain), ...pollingPlace(found)]),

      // Said plainly rather than buried: an address that straddles a line, or
      // that we only inferred from its neighbours, is a guess and should be
      // checked. They sit under the polling place because that is the answer
      // they qualify: the precinct is what is uncertain, not the drop box.
      rivals ? advisory("ambiguous",
        `This address sits where precincts ${rivals.join(" and ")} meet, so we ` +
        "cannot tell which one it votes in. Please check with your clerk or " +
        "the Michigan Voter Information Center.") : null,
      !rivals && inferred ? advisory("inferred",
        "We do not have this exact address, so this is taken from the addresses " +
        "either side of it on the same side of the street. They agree, but it is " +
        "worth confirming.") : null,
      !rivals && edgeMetres <= NEAR_M ? advisory("boundary",
        `This address sits about ${Math.round(edgeMetres)} m from the edge of the ` +
        "precinct, which is too close to be certain. Please check with your " +
        "clerk or the Michigan Voter Information Center.") : null);

    clearResult();
    resultBox.append(el("div", "card", body));
  }

  const failed = (message) => {
    clearResult();
    say(`${message} Check the number and the street, or look it up at the ` +
        "Michigan Voter Information Center.", true);
  };

  // ---- suggestions ------------------------------------------------------

  function closeList() {
    optionList.textContent = "";
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    active = -1;
  }

  function renderList() {
    optionList.textContent = "";
    suggestions.forEach((suggestion, i) => {
      // Every row names its jurisdiction: a list where some rows are labelled
      // and some are bare leaves the reader to work out what bare means. Same
      // rule and same colour for every row as the map page's type-ahead.
      const option = el("li", null, cased(suggestion.text),
        el("span", "opt-where", ` ${placeList(suggestion.where.map(placeLabel))}`));
      option.id = `opt-${i}`;
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", i === active ? "true" : "false");
      option.addEventListener("mousedown", (event) => { event.preventDefault(); choose(i); });
      optionList.append(option);
    });
    input.setAttribute("aria-expanded", suggestions.length ? "true" : "false");
    // The ids exist for exactly this: tell assistive tech which option is lit.
    if (active >= 0) input.setAttribute("aria-activedescendant", `opt-${active}`);
    else input.removeAttribute("aria-activedescendant");
  }

  function suggest(text) {
    const { number, rest } = P.parseTyped(text);

    // Nothing until the text starts with a house number: a street on its own
    // is not an address. With one, offer the full address, one row per place
    // that could hold it, and only where the list can actually answer it.
    suggestions = number === null ? []
      : P.suggest(text, MAX_SUGGESTIONS)
          .filter((s) => s.kind === "exact" || s.kind === "inferred" || s.kind === "quadrant")
          .map((s) => ({ text: `${s.number} ${s.street}`, street: s.street, number: s.number,
                         mcd: s.mcd, where: s.where || [], choice: !!s.choice }));
    if (number !== null) {
      suggestions = suggestions.concat(outsideMatches(rest, number, suggestions))
                               .slice(0, MAX_SUGGESTIONS);
    }

    active = -1;
    renderList();
    say(suggestions.length ? "" : notFoundHint(number, rest));
  }

  // A street the address list cannot answer is still a real street, so it is
  // offered last, filling only what the list's own matches leave, and labelled
  // with where it actually is: a street in Ottawa County with a Grand Rapids
  // mailing address, or one in the county with no parcel of its own.
  const outsideMatches = (rest, number, already) => {
    if (!outside || !rest || rest.length < 2) return [];
    const have = new Set(already.map((s) => s.street));
    return Object.keys(outside)
      .filter((name) => !have.has(name) && name.startsWith(rest))
      .sort()
      .slice(0, MAX_SUGGESTIONS)
      .map((street) => ({ text: `${number} ${street}`, street, number,
                          where: outside[street], outside: true }));
  };

  // Picking one is an answer, not a rejection: which jurisdiction it is in,
  // and where to go instead. The address stays in the box, because it is
  // right.
  function renderOutside(picked) {
    const where = placeList(picked.where.map(placeLabel));
    const covered = picked.where.some((j) => P.coversJurisdiction(j));
    clearResult();
    resultBox.append(el("div", "card", el("div", "card-body",
      el("div", "lead", "Address: ", el("span", "addr-quote", cased(picked.text))),
      advisory("outside", covered
        ? `That street is in ${where}, but the county's address list has no ` +
          "address on it, so this page cannot look it up."
        : `This address is in ${where}, outside Kent County, so this page ` +
          "cannot say where you vote. A Grand Rapids mailing address does not " +
          `always mean you live in Kent County. Your clerk is the one for ${where}.`),
      el("div", "ev-note", "The Michigan Voter Information Center at " +
        "mvic.sos.state.mi.us has the polling place for any Michigan address."))));
  }

  const notFoundHint = (number, rest) => {
    if (number === null) return "Start with the house number, like 300 Monroe Ave NW.";
    if (P.matchingStreets(rest).length) {
      return `We have no number ${number} on that street. Check the number, ` +
             "or look it up at the Michigan Voter Information Center.";
    }
    return "No address found. Try the number and the direction, like 300 Monroe Ave NW. " +
           "Addresses outside Kent County are not listed here.";
  };

  function choose(index) {
    const picked = suggestions[index];
    if (!picked) return;
    input.value = cased(picked.text);
    closeList();
    if (picked.outside) { renderOutside(picked); return; }

    clearResult();
    const found = P.lookup(picked.text, picked.mcd);
    if (found.error) return failed("We do not have that address.");
    say("");
    // The answer is what matters now, not the box. Dismiss the soft keyboard
    // so the result is not hidden behind it.
    input.blur();
    render(found, picked.text);
  }

  // No debounce: the index is already in memory, so this is a dictionary
  // lookup rather than a request, and waiting would only add lag.
  input.addEventListener("input", () => {
    const text = input.value.trim();
    clearResult();
    say("");
    if (text.length < 3) return closeList();
    suggest(text);
  });

  input.addEventListener("keydown", (event) => {
    if (!suggestions.length) return;
    const move = (step) => {
      event.preventDefault();
      const count = suggestions.length;
      // Nothing highlighted yet: down goes to the first, up to the last.
      active = active < 0 ? (step > 0 ? 0 : count - 1)
                          : (active + step + count) % count;
      renderList();
    };
    if (event.key === "ArrowDown") move(1);
    else if (event.key === "ArrowUp") move(-1);
    else if (event.key === "Enter") {
      event.preventDefault();
      // The same address in two places is the reader's to pick, never ours.
      if (active < 0 && suggestions[0].choice) {
        say("That address is in more than one place. Pick yours from the list.");
        return;
      }
      choose(active >= 0 ? active : 0);
    }
    else if (event.key === "Escape") closeList();
  });

  // ---- next election ----------------------------------------------------
  // Shows the first date that has not passed and hides the rest, so a stale
  // entry is harmless while a missing one simply shows nothing. The calendar
  // itself (today, the next election, the state of the early voting window,
  // the date formats) comes from ../elections.js, which the map page reads
  // too; only the wording below is this page's own.

  // On election day itself the line stops naming the date and counts the
  // polls instead, the way the map page's banner does: to 7 AM, then to
  // 8 PM, then that they have closed. Same Elections.pollsPhase, same
  // statutory hours, so the two pages cannot disagree about the polls.
  let pollsTimer = null;

  function showPolls(next, hours) {
    const banner = $("election");
    const tick = () => {
      const now = new Date();
      const phase = Elections.pollsPhase(next, hours, now);
      if (!phase) {
        // Midnight has passed: the calendar moves on and this line with it.
        clearInterval(pollsTimer); pollsTimer = null;
        banner.textContent = "";
        showNextElection(Elections.next(calendarElections), hours);
        return;
      }
      const hms = (ms) => {
        let s = Math.max(0, Math.floor(ms / 1000));
        const h = Math.floor(s / 3600); s -= h * 3600;
        const m = Math.floor(s / 60); s -= m * 60;
        return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
      };
      banner.textContent = "";
      if (phase === "before") {
        banner.append(el("strong", null,
          `Polls open in ${hms(Elections.atTime(next.date, hours.open) - now)}`),
          el("span", "ev", `Today is the ${next.name}. Polls open at ${Elections.shortTime(hours.open)}.`));
      } else if (phase === "open") {
        banner.append(el("strong", null,
          `Polls close in ${hms(Elections.atTime(next.date, hours.close) - now)}`),
          el("span", "ev", `Today is the ${next.name}. Polls are open until ${Elections.shortTime(hours.close)}.`));
      } else {
        banner.append(el("strong", null, `Polls have closed`),
          el("span", "ev", hours.in_line_note ||
            "Everyone in line when the polls closed must be allowed to vote."));
      }
      banner.hidden = false;
    };
    tick();
    if (!pollsTimer) pollsTimer = setInterval(tick, 1000);
  }

  function showNextElection(next, hours) {
    const banner = $("election");
    if (!banner || !next) return;

    if (hours && Elections.pollsPhase(next, hours)) { showPolls(next, hours); return; }

    banner.append("Next election: ", el("strong", null, `${next.name}, ${Elections.withWeekday(next.date)}`));

    // The calendar's early voting window is the city clerk's, so it is said
    // as the city's. Every other clerk sets its own dates. Closed is said,
    // not left blank: silence reads like an election with no early voting,
    // on the days most people look. The closed sentence leaves out the site
    // count, since those doors are shut.
    const state = Elections.windowState(next);
    const { early_voting_from: from, early_voting_to: to } = next;
    if (state !== "none") {
      const count = (next.early_voting_sites || []).length;
      const where = count ? `, at ${count} site${count === 1 ? "" : "s"}` : "";
      banner.append(el("span", "ev",
        state === "closed" ? `Early voting in Grand Rapids ended ${Elections.withWeekday(to)}.`
        : state === "open" ? `Early voting in Grand Rapids is open now, through ${Elections.withWeekday(to)}${where}.`
        : `Early voting in Grand Rapids runs from ${Elections.withWeekday(from)} through ${Elections.withWeekday(to)}${where}.`));
    }
    banner.hidden = false;
  }

  // Early voting, for a Grand Rapids address, shown while the next election
  // carries sites and the window has not closed. Every other clerk sets its
  // own dates and sites and this page has no current source for them, so
  // outside the city there is no block rather than the city's. Returns an
  // empty array otherwise, so render can spread it without a conditional.
  //
  // The clerk's own dates and sites when the file is about THIS election, the
  // calendar's otherwise. gr-clerk.json names the election it describes, and
  // that is checked rather than assumed: a file about a finished election
  // must not supply dates for the next one.
  const clerkWindow = () => {
    if (!clerk || !clerk.early_voting || !election ||
        clerk.election !== election.date) return null;
    return {
      early_voting_from: clerk.early_voting.from,
      early_voting_to: clerk.early_voting.to,
      early_voting_sites: clerk.early_voting_sites || [],
      early_voting_hours: null,
    };
  };

  function earlyVoting(found, uncertain) {
    if (!election || found.mcd !== GR_MCD) return [];
    const source = clerkWindow() || election;
    const { early_voting_from: from, early_voting_to: to,
            early_voting_sites: sites, early_voting_hours: hours } = source;
    if (!(sites || []).length) return [];

    const state = Elections.windowState(source);
    if (state === "none" || state === "closed") return [];
    const open = state === "open";

    const parts = [];

    // Said first, because for an address we could not place with certainty this
    // is the answer: every site holds the voter's registration, so which
    // precinct wins stops mattering.
    if (uncertain) {
      parts.push(advisory("early-voting",
        "Vote early and verify there. All early voting locations have your information."));
    }

    // The heading says what this is; the dates say when, underneath it, and
    // they are the part set in bold.
    parts.push(el("div", "lead-2 sec-head", "Vote early"));
    parts.push(open
      ? el("div", "sec-sub", "Through ", el("strong", "when", Elections.withWeekday(to)))
      : el("div", "sec-sub", el("strong", "when", Elections.withWeekday(from)),
           " through ", el("strong", "when", Elections.withWeekday(to))));
    parts.push(el("div", "ev-note",
      "Any Grand Rapids voter may use any of these, whatever precinct they are in."));

    // The same row the voting day location gets, so a site reads the same
    // wherever it appears on the card.
    for (const site of sites) parts.push(locationRow(site, "ev-site"));

    // Hours last, as aligned rows with today's picked out: where to go is
    // the answer, when it is open is the detail that follows it.
    if ((hours || []).length) {
      const todayAbbr = open ? Elections.todayAbbr() : null;
      const table = el("div", "ev-hours");
      for (const rule of hours) {
        const isToday = todayAbbr !== null && (rule.days || []).includes(todayAbbr);
        const mark = isToday ? " is-today" : "";
        table.append(
          el("span", `ev-day${mark}`, rule.days.join(", ") + (isToday ? " (today)" : "")),
          el("span", `ev-time${mark}`, `${rule.open} to ${rule.close}`));
      }
      parts.push(table);
    }

    return [el("div", "ev-block ev-early", ...parts)];
  }

  // The county and the state write round-the-clock as "24 hours a day, 7 days
  // a week" where the city clerk writes "24/7"; both are the usual case.
  const ALWAYS_OPEN = /^24\/7$|24\s*hours?\s*(a|per)\s*day.*7\s*days/i;

  // A jurisdiction's drop boxes: the city clerk's for Grand Rapids, while
  // that file is about this election; the county's page or the state's
  // release for everywhere else. Where none is published, the clerk's office,
  // because an absentee ballot goes only to the voter's own clerk (MCL
  // 168.764a) and never to a neighbour's box. Every box is listed with its
  // directions link and no "nearest": this page does no geocoding and cannot
  // honestly rank them by distance, so the reader picks the one they know.
  function boxesFor(found) {
    if (found.mcd === GR_MCD) {
      return clerk && election && clerk.election === election.date ? clerk.drop_boxes || [] : [];
    }
    return P.dropBoxes(found.mcd);
  }

  function dropBoxes(found) {
    if (!election) return [];
    const boxes = boxesFor(found);
    // Grand Rapids does publish boxes; an empty list there means the clerk's
    // file is about another election, not that the city has none.
    const office = boxes.length || found.mcd === GR_MCD ? null : P.clerkOf(found.mcd);
    if (!boxes.length && !office) return [];

    const parts = [el("div", "lead-2 sec-head", "Drop off an absentee ballot")];
    // A box is only useful once there is a ballot to put in it, and a
    // returned ballot has to be in hand when the polls close. The first day
    // is the map page's, from ../elections.js.
    const from = Elections.absenteeFrom(election);
    const early = !!from && Elections.todayISO() < from;
    parts.push(el("div", "sec-sub",
      early
        ? el("span", null, el("strong", "when", Elections.monthDay(from)),
             " through ", el("strong", "when", Elections.monthDay(election.date)))
        : el("span", null, "Through ",
             el("strong", "when", Elections.monthDay(election.date)))));
    const when = early
      ? `Ballots are mailed from ${Elections.monthDay(from)}, and ` +
        `${office ? "the clerk accepts" : "boxes accept"} them until the polls close on election day. `
      : "Return it by the time the polls close on election day. ";

    if (office) {
      parts.push(el("div", "ev-note", when +
        `No drop box is published for ${found.jurisdiction}, so an absentee ` +
        "ballot goes to your clerk's office, during office hours" +
        (office.phone ? ` (${office.phone}).` : ".")));
      parts.push(locationRow({
        name: `${found.jurisdiction} clerk's office`,
        address: office.address,
      }, "ev-site"));
      return [el("div", "ev-block ev-boxes", ...parts)];
    }

    const odd = boxes.filter((b) => !ALWAYS_OPEN.test(b.hours || "")).length;
    parts.push(el("div", "ev-note", when +
      // Not our claim: MCL 168.761d requires the clerk to monitor each box.
      "Drop boxes are monitored, as Michigan law requires." +
      (odd ? ` Most are accessible 24/7; ${odd === 1 ? "one is not, and its" : `${odd} are not, and their`}` +
             " hours are listed with it."
           : boxes.length === 1 ? " It is accessible 24/7." : " They are accessible 24/7.")));

    for (const box of boxes) {
      parts.push(locationRow({
        name: box.name || box.address || "Drop box",
        address: box.address || "Inside City Hall",
        // Hours per row only where they differ from 24/7, so the exception
        // stands out rather than being one line among many that say the same.
        entrance_note: [box.note,
                        ALWAYS_OPEN.test(box.hours || "") || !box.hours
                          ? null : `Open hours: ${box.hours}`]
          .filter(Boolean).join(" · "),
      }, "ev-site"));
    }
    return [el("div", "ev-block ev-boxes", ...parts)];
  }

  // ---- clicks outside the suggestion list close it ------------------------

  document.addEventListener("click", (event) => {
    if (!optionList.contains(event.target) && event.target !== input) closeList();
  });

  // ---- boot -------------------------------------------------------------

  (async () => {
    input.disabled = true;
    say("Loading...");
    try {
      const optional = (url) => getJSON(url).catch(() => null);
      // The precinct index names the thirty jurisdictions, and each has its
      // own address and polling file, so the index comes first.
      const index = await getJSON("../data/precincts.json");
      const mcds = (index.jurisdictions || []).map((j) => j.mcd);
      const [addresses, pollingFiles, cityPolling, calendar, neighbourData, clerkData] =
        await Promise.all([
          Promise.all(mcds.map((m) => getJSON(`../data/addresses/${m}.json`))),
          Promise.all(mcds.map((m) => optional(`../data/polling/${m}.json`))),
          optional("../data/polling.json"),
          getJSON("../data/elections.json"),
          // Both optional. A copy of this page hosted without them still
          // answers the question it exists to answer; it just answers less.
          optional("../data/neighbors.json"),
          optional("../data/gr-clerk.json"),
        ]);
      P = Precincts.county({
        index, addresses, polling: pollingFiles.filter(Boolean), cityPolling, cityMcd: GR_MCD,
      });
      // neighbors.json is street names around the city in the state's
      // spelling. Only the ones the address list cannot answer are offered
      // as such; the rest it answers itself.
      outside = neighbourData && neighbourData.streets ? P.unindexed(neighbourData.streets) : null;
      clerk = clerkData || null;

      election = Elections.next(calendar.elections);
      calendarElections = calendar.elections;
      showNextElection(election, calendar.election_day_hours || null);

      input.disabled = false;
      say("");
    } catch (e) {
      say("Could not load the precinct data files. If you are hosting this yourself, " +
          "check that the data folder sits next to this page.", true);
    }
  })();
})();
