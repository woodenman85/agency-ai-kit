// Fixtures are the exact paragraphs live in the Manatal account on 2026-09-29.
// Run: node scripts/add-npn-footer.test.mjs
import { resolveFooter, addFooter, verify } from './add-npn-footer.mjs';

const FOOTER =
  '<p>The Wood Agency Life is an independent insurance agency. Ben Wood, NPN 20251128. Questions: (928) 889-6338.</p>';
const EEO =
  '<p>The Wood Agency Life provides equal opportunity to all applicants without regard to race, color, ' +
  'religion, sex, national origin, age, disability, veteran status, or any other status protected by law.</p>';
const BODY =
  '<p>intro</p><h3>Qualifications</h3><ul><li>Legally authorized to work in the United States</li></ul>' +
  '<h3>Compensation</h3><p>This is a 1099 independent contractor position. Earnings are based on individual production.</p>';

const WITHOUT = BODY + EEO;
const WITH = BODY + FOOTER + EEO;

let failures = 0;
const check = (label, cond) => {
  console.log(`  ${cond ? 'pass' : 'FAIL'}  ${label}`);
  if (!cond) failures++;
};

console.log('Resolving the footer from the account rather than writing one');
{
  const r = resolveFooter([WITH, WITHOUT, WITH]);
  check('finds the footer already in use', r.ok && r.footer === FOOTER);
  check('counts how many carry it', r.ok && r.count === 2);
  check('refuses when no posting has one', resolveFooter([WITHOUT, WITHOUT]).ok === false);
  // Two variants means there is no single right answer, and picking one would be
  // the script inventing an agency fact by choosing which is authoritative.
  const conflicting = resolveFooter([WITH, BODY + '<p>Other Agency. Jane Doe, NPN 99999999.</p>' + EEO]);
  check('refuses when the account disagrees with itself', conflicting.ok === false);
  check('names both variants so a human can choose', !conflicting.ok && /NPN 99999999/.test(conflicting.reason));
}

console.log('\nInserting it');
{
  const r = addFooter(WITHOUT, FOOTER);
  check('is added', r.ok);
  check('lands immediately before the EEO paragraph', r.ok && r.html === WITH);
  check('EEO paragraph survives', r.ok && r.html.includes(EEO));
  check('work-authorization line untouched', r.ok && /authorized to work in the United States/.test(r.html));
  check('compensation line untouched', r.ok && /Earnings are based on individual production\./.test(r.html));
  check('introduces no "commission"', r.ok && !/commission/i.test(r.html));
  check('grew by exactly the footer', r.ok && r.html.length === WITHOUT.length + FOOTER.length);
  check('verify() passes', r.ok && verify(WITHOUT, r.html, FOOTER).length === 0);
  check('re-running is a no-op', r.ok && addFooter(r.html, FOOTER).ok === false);
}

console.log('\nGuards');
check('skips a posting that already has one', addFooter(WITH, FOOTER).ok === false);
check('refuses an empty description', addFooter('', FOOTER).ok === false);
check('refuses when there is no EEO paragraph to anchor to', addFooter(BODY, FOOTER).ok === false);
check('verify() catches a duplicated NPN',
  verify(WITHOUT, WITH + FOOTER, FOOTER).some((p) => /more than once/.test(p)));
check('verify() catches a lost EEO paragraph',
  verify(WITHOUT, BODY + FOOTER, FOOTER).some((p) => /equal-opportunity/.test(p)));
// compliance.md's own footer template still says "compensated by commission",
// and appending it would undo the account-wide scrub.
check('verify() rejects a footer that reintroduces "commission"',
  verify(WITHOUT, BODY + '<p>Agents are compensated by commission. NPN 20251128.</p>' + EEO,
    '<p>Agents are compensated by commission. NPN 20251128.</p>')
    .some((p) => /commission/.test(p)));

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall passed');
process.exit(failures ? 1 : 0);
