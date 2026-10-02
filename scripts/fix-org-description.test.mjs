// The fixture is the live organization profile as the API returned it on
// 2026-10-02. Run: node scripts/fix-org-description.test.mjs
import { fixDescription, verify, RULES } from './fix-org-description.mjs';

let failures = 0;
const check = (label, cond) => {
  console.log(`  ${cond ? 'pass' : 'FAIL'}  ${label}`);
  if (!cond) failures++;
};

const LIVE = "The Wood Agency Life is an independent life insurance agency based in Prescott Valley, Arizona, serving families nationwide and licensed in all 50 states. Founded by married co-founders Ben and Andrea Wood, we help families with term life, whole life, mortgage protection, final expense, IUL and annuities. Because we're independent rather than captive, we place coverage with the carrier that actually fits the family in front of us. Our agents are 1099 independent contractors compensated by commission; no insurance experience is required to start, and we walk new agents through licensing.";

console.log('The live organization profile');
{
  const r = fixDescription(LIVE);
  check('is rewritten', r.ok);
  check('loses the word', r.ok && !/commission/i.test(r.text));
  check('verify() passes', r.ok && verify(LIVE, r.text).length === 0);
  check('says production instead', r.ok && /earnings are based on individual production/.test(r.text));
  check('re-running is a no-op', r.ok && fixDescription(r.text).ok === false);

  // Every agency fact must survive verbatim. These are the things CLAUDE.md
  // says are never invented — so they must also never be quietly dropped.
  for (const fact of [
    'The Wood Agency Life', 'Prescott Valley, Arizona', 'all 50 states',
    'Ben and Andrea Wood', 'term life', 'whole life', 'mortgage protection',
    'final expense', 'IUL', 'annuities', 'independent rather than captive',
    '1099', 'no insurance experience is required to start', 'licensing',
  ]) check(`keeps "${fact}"`, r.ok && r.text.includes(fact));
}

console.log('\nverify() catches a profile that lost something');
{
  const r = fixDescription(LIVE);
  const cases = [
    ['a changed number', r.text.replace('all 50 states', 'all 48 states'), /number/],
    ['an edit before the clause', r.text.replace('Prescott Valley', 'Phoenix'), /before the compensation clause/],
    ['an edit after the clause', r.text.replace('we walk new agents through licensing', 'good luck'), /after the compensation clause|lost "licens"/],
    ['a surviving commission word', LIVE, /still present/],
  ];
  for (const [label, bad, want] of cases) {
    check(`rejects ${label}`, verify(LIVE, bad).some((p) => want.test(p)));
  }
}

console.log('\nOther phrasings');
for (const [input, wanted] of [
  ['Agents are commission-only contractors.', /production-based/],
  ['Pay is commission-based here.', /production-based/],
  ['Our reps are compensated by commission each month.', /paid based on individual production/],
]) {
  const r = fixDescription(input);
  check(`"${input.slice(0, 40)}…" is handled`, r.ok && wanted.test(r.text) && !/commission/i.test(r.text));
}

console.log('\nGuards');
check('refuses empty', fixDescription('').ok === false);
check('no-op when already clean', fixDescription('A clean profile with no such wording.').ok === false);
check('no rule maps onto a replacement containing the word',
  RULES.every(([, to]) => !/commission/i.test(to)));

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall passed');
process.exit(failures ? 1 : 0);
