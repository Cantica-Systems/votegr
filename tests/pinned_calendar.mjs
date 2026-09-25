// Released into the public domain under the Unlicense, see UNLICENSE.
// A calendar held still, for the browser suites. Not a suite itself.
//
// Some of what the pages show is a function of today: the countdown, which
// cards are shut, which ways of voting are on the card at all. A check on
// any of that cannot read the calendar that ships, because that calendar
// moves under it and then runs out. So those checks serve this instead,
// with every date relative to today the way test_early_voting_states.mjs
// does it, so the fixture cannot rot into a fixed one.
//
// It has to pin two files, not one. Both pages take the early voting window
// from gr-clerk.json whenever that file names the active election (evWindow
// in app.js, clerkWindow in simple/lookup.js), and fall back to
// elections.json only when it does not, so pinning the calendar alone would
// leave the early voting card reading a real date. /simple also lists the
// clerk's drop boxes only while that file names the active election.
//
// One module rather than a copy in each suite, so the two pages cannot end up
// checked against two different ideas of a pinned calendar.
import { readFileSync } from 'fs';
import { join } from 'path';

// LOCAL date, the way Elections.todayISO() reckons it, not toISOString(),
// which is UTC and already tomorrow after 8 PM Eastern.
const iso = (d) => {
  const x = new Date(); x.setDate(x.getDate() + d);
  const pad = (n) => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
};
const shiftDate = (d, by) => {
  const x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() + by);
  const pad = (n) => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
};
const dayGap = (a, b) =>
  Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);

// A map of served path -> object, for a suite's static server to answer
// with in place of the files under root.
export function pinnedCalendar(root, daysOut) {
  const realElections = JSON.parse(readFileSync(join(root, 'data/elections.json'), 'utf8'));
  const realClerk = JSON.parse(readFileSync(join(root, 'data/gr-clerk.json'), 'utf8'));
  const ELECTION_DAY = iso(daysOut);
  // Every date in the clerk's file moves by the same amount, so the window,
  // the per-day hours and the election it names stay consistent with each
  // other rather than being three separately invented dates.
  const by = dayGap(realClerk.election, ELECTION_DAY);
  const clerk = JSON.parse(JSON.stringify(realClerk));
  clerk.election = ELECTION_DAY;
  clerk.early_voting.from = shiftDate(realClerk.early_voting.from, by);
  clerk.early_voting.to = shiftDate(realClerk.early_voting.to, by);
  clerk.early_voting.days = realClerk.early_voting.days.map(
    (d) => ({ ...d, date: shiftDate(d.date, by) }));
  // The real general election, moved, rather than an invented one: it keeps
  // whatever sites and hours ship with it.
  const general = realElections.elections[realElections.elections.length - 1];
  return {
    '/data/elections.json': {
      election_day_hours: realElections.election_day_hours,
      elections: [{ ...general, date: ELECTION_DAY,
                    early_voting_from: clerk.early_voting.from,
                    early_voting_to: clerk.early_voting.to }],
    },
    '/data/gr-clerk.json': clerk,
  };
}
