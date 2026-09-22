// Released into the public domain under the Unlicense, see UNLICENSE.
// The link checker's inputs: every file it says it reads, read. Makes no
// request. Run: node tests/test_check_links_inputs.mjs
//
// test_check_links.mjs covers what the checker makes of a response. This
// covers whether it ever gets to ask, which turned out to be a thing that
// could break entirely on its own.
//
// It exists because of a real failure, and a quiet one. TEXT_FILES named
// `compare_osrm.mjs` at the repository root. 98b3c81 moved that file into
// scripts/ and updated the workflows, the README and BUILD.md, but not the
// one path that lived inside the moved file itself. collect() threw ENOENT
// on its first read, so the weekly run died before its first request and
// reported nothing at all: not the missing file, not the two dozen links it
// never reached. It ran red on 2026-09-14 and again on 2026-09-21, eleven
// seconds each time, and said so only in a log nobody had reason to open.
//
// Nothing on a pull request could have caught it. checks.yml ran the
// classifier tests, and the classifier was fine. The live check runs weekly
// by design, because it depends on a dozen other organisations' servers. So
// the move went green and stayed green.
//
// This is the part of the live check that depends on nobody else's server,
// which is exactly the part that can run here, on the pull request that does
// the renaming. The checker no longer dies on a path that moved -- it reports
// it and carries on -- but reporting it weekly is still a week late.
import { TEXT_FILES, DATA_FILES, collect } from '../scripts/check_links.mjs';

let fails = 0;
const ok = (n, c, d = '') => { console.log((c ? '  ok   ' : '  FAIL ') + n + (c ? '' : '  ' + d)); if (!c) fails++; };

// Asking collect() beats a second copy of the two lists here, which would be
// one more thing to leave stale in exactly the way this test is about. It
// reports what it could not read rather than throwing, so what comes back is
// the answer either way: a path that moved, a name that is now a directory,
// a data file whose JSON stopped parsing.
const { foundIn, unreadable } = await collect();

ok(`the checker can read all ${TEXT_FILES.length + DATA_FILES.length} files it names`,
   unreadable.length === 0,
   unreadable.map(([f, why]) => `${f} (${why})`).join(', '));

// A checker that reads every file and finds nothing to check would pass the
// assertion above, run green every week, and be worth nothing. That is the
// same silent no-op the missing file caused, arrived at from the other side.
ok('and found links in them', foundIn.size > 0,
   'every file read, and not one URL came out');

console.log(`\n${fails === 0 ? 'check_links inputs: all passed' : fails + ' FAILED'}`);
process.exit(fails ? 1 : 0);
