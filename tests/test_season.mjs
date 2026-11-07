// Released into the public domain under the Unlicense, see UNLICENSE.
// Election season and the next possible election date, in Elections (site/voting.js).
// Both pages read their mode from Elections.season, so its edges are pinned here:
// election mode from the day absentee ballots go out through election day, off-season
// every other day. The statutory dates are pinned against the days Michigan actually
// used and has announced, worked out by hand, not by the function under test.
import { Elections } from '../site/voting.js';

let failed = 0, passed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; console.log(`  ok   ${name}`); }
  else { failed++; console.log(`  FAIL ${name}${detail !== undefined ? ` (${JSON.stringify(detail)})` : ''}`); }
}

const GENERAL = { date: '2026-11-03', name: 'General Election' };
const PRIMARY = { date: '2026-08-04', name: 'Primary Election' };
const MAY = { date: '2027-05-04', name: 'May Election' };
const cal = [GENERAL, PRIMARY];

// --- season edges ---
// Absentee ballots go out 40 days before: September 24 for November 3, 2026.
ok('absentee day is 40 days out', Elections.absenteeFrom(GENERAL) === '2026-09-24',
   Elections.absenteeFrom(GENERAL));
const at = (today, list = cal) => Elections.season(list, today);
ok('the day before ballots go out is off-season',
   at('2026-09-23').inSeason === false && at('2026-09-23').election === GENERAL);
ok('the day ballots go out is election mode', at('2026-09-24').inSeason === true);
ok('election day is election mode', at('2026-11-03').inSeason === true);
ok('the day after is off-season with nothing entered',
   at('2026-11-04').inSeason === false && at('2026-11-04').election === null);
ok('between the primary and the general, in season for the general',
   at('2026-10-01').election === GENERAL && at('2026-10-01').inSeason);
ok('an election entered months ahead is upcoming but not in season',
   at('2026-11-07', [...cal, MAY]).election === MAY && !at('2026-11-07', [...cal, MAY]).inSeason);
ok('an empty calendar is off-season', at('2026-11-07', []).inSeason === false);
ok('a missing calendar is off-season', at('2026-11-07', null).inSeason === false);

// --- the last election ---
ok('the last election after the general is the general',
   Elections.last(cal, '2026-11-04') === GENERAL);
ok('on election day the last one is the one before',
   Elections.last(cal, '2026-11-03') === PRIMARY);
ok('file order does not matter', Elections.last([GENERAL, PRIMARY], '2026-12-01') === GENERAL &&
   Elections.last([PRIMARY, GENERAL], '2026-12-01') === GENERAL);
ok('none before the first', Elections.last(cal, '2026-01-01') === null);

// --- next possible date (MCL 168.641, MCL 168.613a) ---
const np = (d) => Elections.nextPossible(d);
// Days Michigan held or has set: Nov 3 2026, Aug 4 2026, May 5 2026, Feb 27 2024.
ok('November 2026 general', np('2026-10-01') === '2026-11-03', np('2026-10-01'));
ok('August 2026 primary', np('2026-06-01') === '2026-08-04', np('2026-06-01'));
ok('May 2026', np('2026-03-01') === '2026-05-05', np('2026-03-01'));
ok('the 2024 presidential primary, fourth Tuesday of February', np('2024-01-15') === '2024-02-27',
   np('2024-01-15'));
// From today: the agreed off-season line.
ok('after the November 2026 general, May 4, 2027', np('2026-11-07') === '2027-05-04', np('2026-11-07'));
ok('the day of a possible date is that date', np('2027-05-04') === '2027-05-04');
ok('the day after rolls to August', np('2027-05-05') === '2027-08-03', np('2027-05-05'));
// A November whose first day is a Tuesday: the election is the 8th, not the 1st.
ok('November 2022 was the 8th, not the 1st', np('2022-10-15') === '2022-11-08', np('2022-10-15'));
ok('no February date in an odd year', np('2027-01-01') === '2027-05-04', np('2027-01-01'));
ok('a February date in a presidential year', np('2027-11-03') === '2028-02-22', np('2027-11-03'));
ok('after November rolls into next year', np('2028-11-08') === '2029-05-08', np('2028-11-08'));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
