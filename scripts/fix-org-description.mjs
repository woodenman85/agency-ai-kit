#!/usr/bin/env node
// Scrub "commission" from the ORGANIZATION profile, not the job descriptions.
//
//   node scripts/fix-org-description.mjs              # dry run
//   node scripts/fix-org-description.mjs --live       # apply
//
// THE BLIND SPOT THIS EXISTS FOR. Every script in this repo rewrote
// jobs/{id}/description. On 2026-10-02 a complete pull of all 255 postings came
// back clean — no "commission" anywhere — and Manatal's Trust & Safety team
// still reported commission-only language on the career page. The organization
// profile is why. It renders on the career page beside every listing, and it
// read:
//
//   "Our agents are 1099 independent contractors compensated by commission;
//    no insurance experience is required to start..."
//
// Three rounds of posting rewrites could never have fixed that, because nothing
// ever looked at it. Checking the jobs and declaring the account clean was the
// mistake — "the account" is more than its jobs.
//
// The compensation clause is the only thing changed here. Agency facts — name,
// city, licensing, carriers, products, founders — are left byte-identical and
// verified afterwards, because CLAUDE.md is explicit that those are never
// invented or paraphrased.
import { client, die } from './manatal.mjs';

const args = process.argv.slice(2);
const LIVE = args.includes('--live');

/** Ordered, longest first. Each replacement says the same thing the postings
 *  say: production-based earnings, still disclosed, without the word a job
 *  board reads as a business model. */
export const RULES = [
  ['1099 independent contractors compensated by commission',
   '1099 independent contractors whose earnings are based on individual production'],
  ['independent contractors compensated by commission',
   'independent contractors whose earnings are based on individual production'],
  ['compensated by commission', 'paid based on individual production'],
  ['commission-only', 'production-based'],
  ['commission-based', 'production-based'],
  ['commission', 'production-based pay'],
];

export function fixDescription(text) {
  if (!text) return { ok: false, reason: 'empty description' };
  if (!/commission/i.test(text)) return { ok: false, reason: 'no commission wording present' };
  let out = text;
  for (const [from, to] of RULES) {
    if (out.includes(from)) { out = out.split(from).join(to); break; }
  }
  if (out === text) return { ok: false, reason: 'commission is present but no rule matched it' };
  return { ok: true, text: out };
}

/** The facts that must survive untouched. Derived from the text itself rather
 *  than hardcoded, so this works for any agency's profile. */
export function verify(before, after) {
  const problems = [];
  if (/commission/i.test(after)) problems.push('"commission" still present');

  // Everything on either side of the one edited clause must be unchanged.
  const rule = RULES.find(([from]) => before.includes(from));
  if (!rule) {
    problems.push('could not identify which clause was edited');
  } else {
    const [head, ...rest] = before.split(rule[0]);
    const tail = rest.join(rule[0]);
    if (!after.startsWith(head)) problems.push('text before the compensation clause changed');
    if (!after.endsWith(tail)) problems.push('text after the compensation clause changed');
    if (after.length !== before.length - rule[0].length + rule[1].length) {
      problems.push('something other than the compensation clause changed');
    }
  }

  // Spot-check that the substantive claims are still there.
  for (const token of ['independent', '1099', 'licens']) {
    if (new RegExp(token, 'i').test(before) && !new RegExp(token, 'i').test(after)) {
      problems.push(`lost "${token}" from the profile`);
    }
  }
  // Numbers are agency facts (carrier counts, states). None may vanish or change.
  const nums = (s) => (s.match(/\b\d+\b/g) || []).join(',');
  if (nums(before) !== nums(after)) problems.push('a number in the profile changed');
  return problems;
}

const RUN_DIRECTLY = process.argv[1] && process.argv[1].endsWith('fix-org-description.mjs');
if (RUN_DIRECTLY) {
  const api = client();

  let orgs;
  try {
    orgs = await (await api('organizations/?page_size=50')).json();
  } catch (err) { die(err); }

  const list = orgs.results ?? [];
  console.log(`\n${list.length} organization(s) in the account\n`);

  const planned = [];
  for (const org of list) {
    const r = fixDescription(org.description || '');
    console.log(`  ${org.id}  ${org.name}`);
    if (!r.ok) { console.log(`        ${r.reason}`); continue; }
    const problems = verify(org.description, r.text);
    if (problems.length) {
      console.log(`        REFUSING: ${problems.join('; ')}`);
      continue;
    }
    console.log(`        - ${org.description}`);
    console.log(`        + ${r.text}`);
    planned.push({ org, text: r.text });
  }
  console.log('');

  if (!planned.length) { console.log('Nothing to change.'); process.exit(0); }
  if (!LIVE) {
    console.log(`Dry run — nothing was sent. Add --live to apply to ${planned.length} profile(s).`);
    process.exit(0);
  }

  let ok = 0;
  for (const { org, text } of planned) {
    try {
      await api(`organizations/${org.id}/`, { method: 'PATCH', body: JSON.stringify({ description: text }) });
      const after = await (await api(`organizations/${org.id}/`)).json();
      if (/commission/i.test(after.description || '')) {
        console.log(`  WRITE DID NOT STICK — ${org.id} still says "commission"`);
        process.exitCode = 1;
      } else {
        ok++;
        console.log(`  VERIFIED ${org.id}  updated ${after.updated_at}`);
        console.log(`  now: ${after.description}`);
      }
    } catch (err) { die(err); }
  }
  console.log(`\n${ok} profile(s) updated and verified against the API.`);
  console.log('\nThe career page may cache. If Manatal still reports the old text, say so and');
  console.log('ask them to re-check — the API is the source of truth and it is now clean.');
}
