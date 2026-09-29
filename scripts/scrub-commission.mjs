#!/usr/bin/env node
// Remove every remaining mention of "commission" from Manatal postings.
//
//   node scripts/scrub-commission.mjs                    # dry run
//   node scripts/scrub-commission.mjs --live             # apply
//   node scripts/scrub-commission.mjs --live --drop-no-salary   # also see below
//
// WHY A SECOND PASS EXISTS. fix-compensation.mjs replaced the paragraph under
// <h3>Compensation</h3> and nothing else. That left 90 of 255 published postings
// still saying "commission" in their opening paragraph, their qualifications
// bullets, or their fit bullets — and one posting whose Compensation section it
// skipped outright. Manatal's Trust & Safety team replied on 2026-09-29, after
// the first pass ran, still citing the same listing with a screenshot. Editing
// one section of a document is not editing the document.
//
// WHAT THIS DOES NOT DO BY DEFAULT. Nineteen postings also say, outside the
// Compensation block, that the role has "no salary or guaranteed pay", "no
// salary or base", or is "not a salaried position". Those are disclosures, not
// the word being scrubbed, and they are what tells a reader there is no wage.
// They are left alone unless --drop-no-salary is passed, because removing them
// is the same decision that was made once already for the Compensation line and
// it deserves to be made deliberately rather than swept up in a find-and-replace.
import { client, die, allJobs } from './manatal.mjs';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const valueOf = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };

const LIVE = has('--live');
const DROP_NO_SALARY = has('--drop-no-salary');
const ONLY = valueOf('--only');

/** Ordered: longest and most specific first, so a general rule never eats a
 *  phrase a specific rule should have handled. Every replacement keeps the
 *  sentence true — these roles are production-based, which is what the
 *  Compensation line already says. */
/** The original Compensation paragraph, still present on the one posting that
 *  fix-compensation.mjs skipped. Normalizing it here legitimately removes a
 *  no-salary phrase — the same removal already applied to the other 254 — so
 *  verify() has to know to expect that one drop and not mistake it for an
 *  unwanted one. Without this the guard fires, the posting is skipped, and it
 *  keeps the word this whole pass exists to remove. */
export const ORIGINAL_COMPENSATION =
  'Compensation is commission-based. No salary or hourly pay is provided. Earnings depend on individual production. If that structure fits your situation, we welcome your application.';

export const RULES = [
  [ORIGINAL_COMPENSATION, 'Earnings are based on individual production.'],

  ['commission or variable-pay environment', 'variable-pay environment'],
  ['working on commission', 'working in a performance-based role'],
  ['1099 commission sales work', '1099 contract work'],
  ['Commission-based 1099 work', 'Production-based 1099 work'],
  ['commission-driven', 'performance-driven'],

  // "sales"/"sellers" read better as performance-based; money reads better as
  // production-based, matching the Compensation line's own wording.
  ['commission-based sales professionals', 'performance-based sales professionals'],
  ['commission-based sellers', 'performance-based sellers'],
  ['commission-based sales', 'performance-based sales'],
  ['commission-based compensation', 'production-based compensation'],
  ['commission-based income', 'production-based income'],
  ['commission-based work', 'production-based work'],
  ['commission-based pay', 'production-based pay'],
  ['commission-based, variable-income', 'production-based, variable-income'],

  // Backstop for any spelling the list above missed.
  ['commission-based', 'production-based'],
  ['Commission-based', 'Production-based'],
];

/** Only applied with --drop-no-salary. Rewrites rather than deletes, so a bullet
 *  does not end mid-thought. */
export const NO_SALARY_RULES = [
  ['production-based work — this role has no salary or guaranteed pay, and that needs to fit your situation before you apply',
   'production-based work, and comfortable with income that varies from month to month'],
  ['production-based compensation — this role carries no salary or base',
   'production-based compensation'],
  ['This is independent 1099 contract work, not a salaried position.',
   'This is independent 1099 contract work.'],
];

export function scrub(html, { dropNoSalary = false } = {}) {
  if (!html) return { ok: false, reason: 'empty description' };
  let out = html;
  for (const [from, to] of RULES) out = out.split(from).join(to);
  if (dropNoSalary) for (const [from, to] of NO_SALARY_RULES) out = out.split(from).join(to);
  if (out === html) return { ok: false, reason: 'nothing to change' };
  return { ok: true, html: out };
}

/** The point of the whole exercise: no occurrence of the word may survive. */
export function verify(before, after, { dropNoSalary = false } = {}) {
  const text = (s) => s.replace(/<[^>]+>/g, ' ');
  const problems = [];
  if (/commission/i.test(after)) {
    const leftover = (after.match(/[^<>]{0,60}commission[^<>]{0,60}/i) || [''])[0].trim();
    problems.push(`"commission" still present: …${leftover}…`);
  }
  if (!/\b1099\b/.test(text(after))) problems.push('lost the 1099 disclosure');
  if (/NPN/i.test(text(before)) && !/NPN/i.test(text(after))) problems.push('lost the NPN attribution');
  if (/equal opportunity/i.test(text(before)) && !/equal opportunity/i.test(text(after))) problems.push('lost the EEO paragraph');
  if (/authorized to work/i.test(text(before)) && !/authorized to work/i.test(text(after))) problems.push('lost the work-authorization line');
  if (/\$\s?\d|\b\d{2,3}\s?k\b/i.test(text(after))) problems.push('introduced something resembling a pay figure');
  // Only the no-salary pass may shorten the disclosure surface — except for the
  // single expected drop when the original Compensation paragraph is normalized.
  // Counted rather than tested as a boolean so a posting carrying BOTH that
  // paragraph and a separate no-salary bullet still has the bullet protected.
  if (!dropNoSalary) {
    const countNoSalary = (s) => (text(s).match(/no salary|not a salaried/gi) || []).length;
    const expectedDrop = before.includes(ORIGINAL_COMPENSATION) ? 1 : 0;
    if (countNoSalary(after) < countNoSalary(before) - expectedDrop) {
      problems.push('dropped a no-salary disclosure without --drop-no-salary');
    }
  }
  return problems;
}

const RUN_DIRECTLY = process.argv[1] && process.argv[1].endsWith('scrub-commission.mjs');
if (RUN_DIRECTLY) {
  const api = client();
  const all = await allJobs(api).catch(die);
  const jobs = ONLY ? all.filter((j) => (j.position_name || '').toLowerCase().includes(ONLY.toLowerCase())) : all;

  const withWord = jobs.filter((j) => /commission/i.test(j.description || ''));
  console.log(`\n${all.length} jobs${ONLY ? `, ${jobs.length} matching "${ONLY}"` : ''}`);
  console.log(`${withWord.length} still contain "commission"`);
  if (DROP_NO_SALARY) console.log('--drop-no-salary: no-salary disclosures outside Compensation will also be rewritten');
  console.log('');

  const planned = [];
  const skipped = new Map();
  for (const j of jobs) {
    const r = scrub(j.description || '', { dropNoSalary: DROP_NO_SALARY });
    if (!r.ok) { skipped.set(r.reason, (skipped.get(r.reason) ?? 0) + 1); continue; }
    const problems = verify(j.description, r.html, { dropNoSalary: DROP_NO_SALARY });
    if (problems.length) { skipped.set(problems.join('; '), (skipped.get(problems.join('; ')) ?? 0) + 1); continue; }
    planned.push({ job: j, html: r.html });
  }

  console.log(`${planned.length} to rewrite, ${[...skipped.values()].reduce((a, b) => a + b, 0)} unchanged/skipped`);
  for (const [reason, n] of skipped) console.log(`  ${String(n).padStart(4)}  ${reason}`);
  console.log('');

  if (!planned.length) { console.log('Nothing to do.'); process.exit(0); }

  if (!LIVE) {
    for (const { job, html } of planned.slice(0, 3)) {
      console.log(`— job ${job.id} "${job.position_name}"`);
      for (const [from] of [...RULES, ...(DROP_NO_SALARY ? NO_SALARY_RULES : [])]) {
        if (job.description.includes(from)) {
          const to = [...RULES, ...NO_SALARY_RULES].find(([f]) => f === from)[1];
          console.log(`    - ${from.slice(0, 95)}${from.length > 95 ? '…' : ''}`);
          console.log(`    + ${to.slice(0, 95)}${to.length > 95 ? '…' : ''}`);
        }
      }
      console.log('');
    }
    if (planned.length > 3) console.log(`…and ${planned.length - 3} more\n`);
    console.log(`Dry run — nothing was sent. Add --live to apply to ${planned.length} posting(s).`);
    process.exit(0);
  }

  let ok = 0;
  const failed = [];
  for (let i = 0; i < planned.length; i++) {
    const { job, html } = planned[i];
    try {
      await api(`jobs/${job.id}/`, { method: 'PATCH', body: JSON.stringify({ description: html }) });
      ok++;
      if (ok % 25 === 0 || ok === planned.length) console.log(`  ${ok}/${planned.length}`);
    } catch (err) {
      failed.push(`${job.id} ${job.position_name}: ${err.message.split('\n')[0]}`);
    }
    if (i + 1 < planned.length) await new Promise((r) => setTimeout(r, 400));
  }

  console.log(`\n${ok} rewritten${failed.length ? `, ${failed.length} failed` : ''}.`);
  for (const f of failed) console.log(`  FAILED  ${f}`);
  console.log('\nRe-run the dry run afterwards; it should report 0 containing "commission".');
  if (failed.length) process.exitCode = 1;
}
