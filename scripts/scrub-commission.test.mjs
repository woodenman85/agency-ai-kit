// Fixtures are real sentences taken from live Manatal postings on 2026-09-29.
// Run: node scripts/scrub-commission.test.mjs
import { scrub, verify, RULES, NO_SALARY_RULES, ORIGINAL_COMPENSATION } from './scrub-commission.mjs';

const wrap = (body) =>
  `<p>${body}</p><h3>Qualifications</h3><ul><li>Legally authorized to work in the United States</li></ul>` +
  `<h3>Compensation</h3><p>This is a 1099 independent contractor position. Earnings are based on individual production.</p>` +
  `<p>The Wood Agency Life is an independent insurance agency. Ben Wood, NPN 20251128.</p>` +
  `<p>The Wood Agency Life provides equal opportunity to all applicants.</p>`;

// Every distinct shape found across the 255 published postings.
const REAL = [
  'Background in health, benefits, or another commission-driven sales role — you know how to run a conversation and close it',
  'A track record of closing in a commission or variable-pay environment',
  'This 100% remote role may suit people with a background in advertising, media, or other commission-based sales.',
  'already comfortable explaining financial products and working on commission.',
  'This role suits commission-based sales professionals, including those in solar or home services',
  'Comfortable working as an independent contractor with variable, commission-based pay',
  'Comfortable with commission-based income and the variability that comes with it month to month',
  'open to commission-based sales.',
  'The position may suit commission-based sellers who are used to closing deals face-to-face',
  'This is independent 1099 commission sales work, not a salaried position.',
  'Commission-based 1099 work suits people with a health or benefits sales background',
  'Experienced with commission-based, variable-income work',
];

let failures = 0;
const check = (label, cond) => {
  console.log(`  ${cond ? 'pass' : 'FAIL'}  ${label}`);
  if (!cond) failures++;
};

console.log('Every real phrase loses the word, and verify() is satisfied');
for (const phrase of REAL) {
  const html = wrap(phrase);
  const r = scrub(html);
  const label = phrase.slice(0, 58) + (phrase.length > 58 ? '…' : '');
  if (!r.ok) { console.log(`  FAIL  ${label} — ${r.reason}`); failures++; continue; }
  const gone = !/commission/i.test(r.html);
  const clean = verify(html, r.html).length === 0;
  check(`${label}`, gone && clean);
}

console.log('\nThe posting fix-compensation.mjs skipped');
{
  const html = wrap('Intro.').replace(
    '<p>This is a 1099 independent contractor position. Earnings are based on individual production.</p>',
    `<p>This is a 1099 independent contractor role. ${ORIGINAL_COMPENSATION}</p>`,
  );
  const r = scrub(html);
  check('is rewritten', r.ok);
  check('loses the word', r.ok && !/commission/i.test(r.html));
  check('normalizes to the standard compensation line',
    r.ok && /Earnings are based on individual production\./.test(r.html));
  // The bug the corpus run caught: this drops a no-salary phrase legitimately,
  // and the guard must not treat that as an unwanted removal or the posting is
  // skipped and keeps the word.
  check('verify() allows the one expected no-salary drop', r.ok && verify(html, r.html).length === 0);
}

console.log('\nNo-salary disclosures are protected unless the flag is passed');
{
  const html = wrap('Genuinely comfortable with commission-based work — this role has no salary or guaranteed pay, and that needs to fit your situation before you apply');
  const def = scrub(html);
  check('default keeps the no-salary wording', def.ok && /no salary or guaranteed pay/i.test(def.html));
  check('default still removes the word', def.ok && !/commission/i.test(def.html));
  const dropped = scrub(html, { dropNoSalary: true });
  check('--drop-no-salary rewrites it away', dropped.ok && !/no salary/i.test(dropped.html));
  check('--drop-no-salary leaves a complete sentence',
    dropped.ok && /income that varies from month to month/.test(dropped.html));
  check('verify() passes with the flag', dropped.ok && verify(html, dropped.html, { dropNoSalary: true }).length === 0);
  // A posting carrying BOTH the old compensation paragraph and a separate
  // bullet must still have the bullet protected — hence counting, not a boolean.
  // Keep the "1099 independent contractor role." sentence — that is how the real
  // un-rewritten posting reads, and dropping it makes verify() fail for an
  // unrelated reason.
  const both = html.replace('<h3>Compensation</h3><p>This is a 1099 independent contractor position. Earnings are based on individual production.</p>',
    `<h3>Compensation</h3><p>This is a 1099 independent contractor role. ${ORIGINAL_COMPENSATION}</p>`);
  const r = scrub(both);
  check('a bullet is still protected when the old paragraph is also present',
    r.ok && /no salary or guaranteed pay/i.test(r.html) && verify(both, r.html).length === 0);
}

console.log('\nGuards');
check('refuses an empty description', scrub('').ok === false);
check('no-op on copy with nothing to change', scrub(wrap('Plain intro.')).ok === false);
check('re-running is a no-op', (() => {
  const once = scrub(wrap(REAL[0]));
  return once.ok && scrub(once.html).ok === false;
})());
check('verify() catches a surviving mention',
  verify(wrap(REAL[0]), wrap('still commission-driven here')).some((p) => /still present/.test(p)));
check('verify() catches a lost work-authorization line',
  verify(wrap(REAL[0]), '<p>1099 production-based</p>').some((p) => /work-authorization/.test(p)));
check('no rule maps onto a replacement that still contains the word',
  [...RULES, ...NO_SALARY_RULES].every(([, to]) => !/commission/i.test(to)));

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall passed');
process.exit(failures ? 1 : 0);
