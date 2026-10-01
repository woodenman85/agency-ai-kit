// Tests the eligibility-line insert against the description shapes actually
// present in the live Manatal account. Run: node scripts/add-eligibility-line.test.mjs
import { addLine, verify, LINE, SENTENCE, OLD_LINE, OLD_SENTENCE } from './add-eligibility-line.mjs';

const QUALIFICATIONS =
  '<p>intro</p><h3>What you will do</h3><ul><li>call people</li></ul>' +
  '<h3>Qualifications</h3><ul><li>A state life insurance license, or a clear plan to earn one</li>' +
  '<li>Reliable home office setup</li></ul>' +
  '<h3>Compensation</h3><p>This is a 1099 independent contractor position. Earnings are based on individual production.</p>' +
  '<p>Equal opportunity to all applicants.</p>';

// The other heading used across the account.
const WHO_FIT = QUALIFICATIONS.replace('<h3>Qualifications</h3>', '<h3>Who this is a fit for</h3>');

let failures = 0;
const check = (label, cond) => {
  console.log(`  ${cond ? 'pass' : 'FAIL'}  ${label}`);
  if (!cond) failures++;
};

for (const [name, html] of [['Qualifications heading', QUALIFICATIONS], ['Who this is a fit for heading', WHO_FIT]]) {
  console.log(`\n${name}`);
  const r = addLine(html);
  if (!r.ok) { console.log(`  FAIL  refused: ${r.reason}`); failures++; continue; }
  check('verify() reports no problems', verify(html, r.html).length === 0);
  check('line is the FIRST bullet in the list',
    /<ul><li>At least 18 years old and legally authorized to work in the United States<\/li>/.test(r.html));
  check('the existing first bullet still follows it',
    r.html.includes(`${LINE}<li>A state life insurance license`));
  check('compensation section untouched',
    /Earnings are based on individual production\./.test(r.html) && !/commission/i.test(r.html));
  check('EEO paragraph untouched', /Equal opportunity to all applicants\./.test(r.html));
  check('grew by exactly the inserted line', r.html.length === html.length + LINE.length);
  check('re-running is a no-op', addLine(r.html).ok === false);
}

// The skeleton the first pass silently skipped on six live postings: no
// requirements list at all, just a Licensing Requirement paragraph.
console.log('\nRustman-style skeleton (no requirements list)');
{
  const html =
    "<p>intro</p><h3>What You'll Do</h3><ul><li>call people</li></ul>" +
    '<h3>What We Provide</h3><ul><li>training</li></ul>' +
    '<h3>Licensing Requirement</h3><p>A state Life &amp; Health license is required before selling. ' +
    'Unlicensed candidates may apply and must be licensed before any sales activity.</p>' +
    '<h3>Compensation</h3><p>This is a 1099 independent contractor position. Earnings are based on individual production.</p>';
  const r = addLine(html);
  check('is handled rather than skipped', r.ok);
  check('uses the sentence form, not a stray <li>', r.ok && r.added === SENTENCE && !r.html.includes(LINE));
  check('lands inside the Licensing Requirement paragraph',
    r.ok && /sales activity\. Applicants must be at least 18 years old and legally authorized to work in the United States\.<\/p>/.test(r.html));
  check('verify() passes', r.ok && verify(html, r.html, r.added).length === 0);
  check('compensation section untouched',
    r.ok && /Earnings are based on individual production\./.test(r.html));
  check('re-running is a no-op', r.ok && addLine(r.html).ok === false);
}

// All 255 live postings already carried the authorization-only wording, so an
// insert-only script reports "already has the line" for every one and changes
// nothing. The upgrade path is the whole reason this pass does anything at all.
console.log('\nUpgrading the older authorization-only wording');
{
  const old = QUALIFICATIONS.replace('<h3>Qualifications</h3><ul>', `<h3>Qualifications</h3><ul>${OLD_LINE}`);
  const r = addLine(old);
  check('is upgraded, not skipped', r.ok && r.upgraded === true);
  check('now states the age minimum', r.ok && /at least 18 years old/i.test(r.html));
  check('work authorization still appears exactly once',
    r.ok && (r.html.match(/authorized to work/gi) || []).length === 1);
  check('the old wording is gone', r.ok && !r.html.includes(OLD_LINE));
  check('still the FIRST bullet', r.ok && r.html.includes(`<ul>${LINE}<li>A state life insurance license`));
  check('verify() passes on an upgrade', r.ok && verify(old, r.html, r.added, { upgraded: true }).length === 0);
  check('grew by only the difference between the two wordings',
    r.ok && r.html.length === old.length + (LINE.length - OLD_LINE.length));
  check('re-running is a no-op', r.ok && addLine(r.html).ok === false);
}

console.log('\nUpgrading the sentence form');
{
  const old =
    "<p>intro</p><h3>What You'll Do</h3><ul><li>call people</li></ul>" +
    '<h3>Licensing Requirement</h3><p>A state licence is required before selling.' + OLD_SENTENCE + '</p>' +
    '<h3>Compensation</h3><p>This is a 1099 independent contractor position.</p>';
  const r = addLine(old);
  check('is upgraded', r.ok && r.upgraded === true && r.added === SENTENCE);
  check('states the age minimum', r.ok && /at least 18 years old/i.test(r.html));
  check('verify() passes', r.ok && verify(old, r.html, r.added, { upgraded: true }).length === 0);
  check('re-running is a no-op', r.ok && addLine(r.html).ok === false);
}

console.log('\nEdge cases');
check('refuses a description with no requirements list and no licensing paragraph', addLine('<p>nothing</p>').ok === false);
check('refuses an empty description', addLine('').ok === false);
check('reports unrecognized work-authorization wording rather than guessing',
  addLine('<h3>Qualifications</h3><ul><li>Authorized to work in the US</li></ul>').ok === false);
check('verify() catches a lost age minimum',
  verify(QUALIFICATIONS, QUALIFICATIONS.replace('<ul>', `<ul>${OLD_LINE}`), OLD_LINE)
    .some((p) => /age minimum/.test(p)));
check('verify() catches a duplicated line',
  verify(QUALIFICATIONS, QUALIFICATIONS + LINE + LINE).some((p) => /more than once/.test(p)));
check('verify() catches an unrelated edit',
  verify(QUALIFICATIONS, QUALIFICATIONS.replace('Reliable home office setup', 'Something else entirely!!') + LINE)
    .length > 0);

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall passed');
process.exit(failures ? 1 : 0);
