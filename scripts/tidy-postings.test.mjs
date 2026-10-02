// Fixtures are the two real descriptions as the API returned them on 2026-10-02.
// Run: node scripts/tidy-postings.test.mjs
import { readFileSync } from 'node:fs';
import { tidy, verify, ORPHAN_FOOTER } from './tidy-postings.mjs';

let failures = 0;
const check = (label, cond) => {
  console.log(`  ${cond ? 'pass' : 'FAIL'}  ${label}`);
  if (!cond) failures++;
};

const FIXTURES = process.env.FIXTURES;
const real = FIXTURES
  ? readFileSync(FIXTURES, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  : [];

const NPN = '<p>The Wood Agency Life is an independent insurance agency. Ben Wood, NPN 20251128. Questions: (928) 889-6338.</p>';
const EEO = '<p>The Wood Agency Life provides equal opportunity to all applicants without regard to race.</p>';
const ORPHAN = '<p>The Wood Agency Life is an independent insurance agency. Agents are independent contractors.</p>';
const QUALS = '<h3>Qualifications</h3><ul><li>At least 18 years old and legally authorized to work in the United States</li></ul>';
const build = (comp) => `<p>intro</p>${QUALS}<h3>Compensation</h3><p>${comp}</p>`;

console.log('The orphaned old footer is removed when the NPN footer is present');
{
  const html = build('This is a 1099 independent contractor position. Earnings are based on individual production.') + ORPHAN + NPN + EEO;
  const r = tidy(html);
  check('is tidied', r.ok);
  check('the orphan is gone', r.ok && !ORPHAN_FOOTER.test(r.html));
  check('the NPN footer survives', r.ok && r.html.includes(NPN));
  check('the agency is identified exactly once',
    r.ok && (r.html.replace(/<[^>]+>/g, ' ').match(/is an independent insurance agency/gi) || []).length === 1);
  check('verify() passes', r.ok && verify(html, r.html).length === 0);
  check('re-running is a no-op', r.ok && tidy(r.html).ok === false);
}

console.log('\nIt is NOT removed when there is no NPN footer to replace it');
{
  // Stripping it here would leave the posting with no agency identification at all.
  const html = build('This is a 1099 independent contractor position. Earnings are based on individual production.') + ORPHAN + EEO;
  const r = tidy(html);
  check('declines to strip the only identification', r.ok === false);
}

console.log('\n"role" is normalized to "position"');
{
  const html = build('This is a 1099 independent contractor role. Earnings are based on individual production.') + NPN + EEO;
  const r = tidy(html);
  check('is tidied', r.ok);
  check('says position', r.ok && /1099 independent contractor position\./.test(r.html));
  check('no "role" left', r.ok && !/1099 independent contractor role\./.test(r.html));
  check('verify() passes', r.ok && verify(html, r.html).length === 0);
}

console.log('\nverify() refuses anything that loses a required element');
{
  const good = build('This is a 1099 independent contractor position. Earnings are based on individual production.') + NPN + EEO;
  const cases = [
    ['a reintroduced commission word', good.replace('Earnings are', 'Commission. Earnings are'), /commission/],
    ['a lost NPN', good.replace(NPN, ''), /NPN/],
    ['a lost EEO paragraph', good.replace(EEO, ''), /equal-opportunity/],
    ['a lost age minimum', good.replace('At least 18 years old and legally', 'Legally'), /age minimum/],
    ['a lost 1099', good.replace('1099 independent contractor position', 'contractor position'), /1099/],
    ['a pay figure', good.replace('individual production', 'individual production, about $90,000'), /pay figure/],
    ['a duplicated identification', good + ORPHAN, /appears 2 times/],
    ['an unrelated addition', good + '<p>extra</p>', /something other than the intended edits/],
    ['an unrelated deletion', good.replace('<p>intro</p>', ''), /something other than the intended edits/],
  ];
  for (const [label, bad, want] of cases) {
    check(`rejects ${label}`, verify(good, bad).some((p) => want.test(p)));
  }
}

console.log('\nGuards');
check('refuses an empty description', tidy('').ok === false);
check('no-op on a clean posting',
  tidy(build('This is a 1099 independent contractor position. Earnings are based on individual production.') + NPN + EEO).ok === false);

if (real.length) {
  console.log(`\nThe ${real.length} real postings pulled from the API`);
  for (const j of real) {
    const r = tidy(j.description);
    const label = `${j.id} ${j.city}`;
    if (!r.ok) { console.log(`  FAIL  ${label} — not tidied: ${r.reason}`); failures++; continue; }
    const problems = verify(j.description, r.html);
    const once = (r.html.replace(/<[^>]+>/g, ' ').match(/is an independent insurance agency/gi) || []).length === 1;
    check(`${label} tidies cleanly`, problems.length === 0 && once);
    check(`${label} keeps commission out`, !/commission/i.test(r.html));
  }
} else {
  console.log('\n(no API fixtures supplied — set FIXTURES to the jsonl path to include them)');
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall passed');
process.exit(failures ? 1 : 0);
