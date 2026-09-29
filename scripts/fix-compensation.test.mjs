// Tests the compensation rewrite against the two description shapes actually
// found in the live Manatal account on 2026-09-29. Run: node scripts/fix-compensation.test.mjs
import { rewrite, verify } from './fix-compensation.mjs';

// Job 4410641 "Remote Sales Consultant — First Responders Welcome" — the one
// Manatal's second notice named. No NPN anywhere in it.
const FIRST_RESPONDERS =
  '<p>intro</p><h3>What you will do</h3><ul><li>x</li></ul><h3>Compensation</h3>' +
  '<p>This is a 1099 independent contractor role. Compensation is commission-based. ' +
  'No salary or hourly pay is provided. Earnings depend on individual production. ' +
  'If that structure fits your situation, we welcome your application.</p>' +
  '<p>The Wood Agency Life is an independent insurance agency. Agents are independent contractors.</p>' +
  '<p>The Wood Agency Life provides equal opportunity to all applicants without regard to race, ' +
  'color, religion, sex, national origin, age, disability, veteran status, or any other status protected by law.</p>';

// Job 4392655 "Account Representative" — different shape, and its second
// paragraph carries the NPN, which must survive.
const ACCOUNT_REP =
  '<p>intro</p><h3>Compensation</h3>' +
  '<p>This is a 1099 independent contractor opportunity with commission-based compensation. ' +
  'Earnings depend on individual production. No salary or hourly pay is provided.</p>' +
  '<p>The Wood Agency Life is an independent insurance agency. Ben Wood, NPN 20251128. Questions: (928) 889-6338.</p>' +
  '<p>The Wood Agency Life provides equal opportunity to all applicants.</p>';

let failures = 0;
const check = (label, cond) => {
  console.log(`  ${cond ? 'pass' : 'FAIL'}  ${label}`);
  if (!cond) failures++;
};

for (const [name, html] of [['First Responders (no NPN)', FIRST_RESPONDERS], ['Account Rep (has NPN)', ACCOUNT_REP]]) {
  console.log(`\n${name}`);
  const r = rewrite(html);
  if (!r.ok) { console.log(`  FAIL  rewrite refused: ${r.reason}`); failures++; continue; }

  check('verify() reports no problems', verify(html, r.html).length === 0);
  check('the word "commission" is gone', !/commission/i.test(r.html));
  check('1099 survives', /\b1099\b/.test(r.html));
  check('no-salary disclosure survives', /no salary or hourly wage/i.test(r.html));
  check('EEO paragraph survives', /equal opportunity/i.test(r.html));
  check('shorter than before', r.html.length < html.length);
  if (/NPN/.test(html)) check('NPN attribution survives', /NPN 20251128/.test(r.html));
  else check('redundant contractor line dropped', !/Agents are independent contractors/i.test(r.html));

  const twice = rewrite(r.html);
  check('idempotent — a second pass changes nothing', twice.ok && twice.html === r.html);
}

console.log('\nEdge cases');
check('refuses HTML with no Compensation heading', rewrite('<p>nothing</p>').ok === false);
check('refuses when heading is not followed by a paragraph', rewrite('<h3>Compensation</h3><ul><li>x</li></ul>').ok === false);
check('verify() catches a lost no-salary line',
  verify(ACCOUNT_REP, '<h3>Compensation</h3><p>This is a 1099 independent contractor position.</p>').length > 0);
check('verify() catches an introduced pay figure',
  verify(ACCOUNT_REP, '<p>1099, no salary or hourly wage. $50,000 typical.</p>').some((p) => /pay figure/.test(p)));

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall passed');
process.exit(failures ? 1 : 0);
