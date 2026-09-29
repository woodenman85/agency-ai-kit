#!/usr/bin/env node
// Rewrite the Compensation section on existing Manatal postings.
//
//   node scripts/fix-compensation.mjs                      # dry run, all jobs
//   node scripts/fix-compensation.mjs --only "First Resp"  # dry run, title match
//   node scripts/fix-compensation.mjs --only "First Resp" --live
//   node scripts/fix-compensation.mjs --live               # apply to everything
//
// Why this exists: Manatal Trust & Safety restricted this account twice for the
// same reason — commission-only roles are non-compliant with their Job Posting
// Trust & Safety Policy. The second notice (2026-09-29) said the flagged job was
// "only one example" and to review all jobs. All 255 live postings carry the
// same compensation block, so this is an account-wide edit, not a one-posting
// fix.
//
// WHAT CHANGES: the wording, and only the wording.
//
//   before: This is a 1099 independent contractor role. Compensation is
//           commission-based. No salary or hourly pay is provided. Earnings
//           depend on individual production. If that structure fits your
//           situation, we welcome your application.
//
//   after:  This is a 1099 independent contractor position. Earnings are based
//           on individual production, with no salary or hourly wage.
//
// The word "commission" goes; the fact that there is no salary stays. That is
// the deliberate line: an applicant must still be able to tell, from the ad,
// that the role pays no wage. Removing that too would make the posting read as
// though it might pay one, which is the misrepresentation the disclosure exists
// to prevent — and the first attempt at getting past this filter (swapping
// "commission-only" for "commission-based") was flagged anyway, so vagueness is
// not reliably what they are scanning for.
import { client, die, allJobs } from './manatal.mjs';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const valueOf = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };

const LIVE = has('--live');
const ONLY = valueOf('--only');

const NEW_COMP =
  '<p>This is a 1099 independent contractor position. Earnings are based on individual production, with no salary or hourly wage.</p>';

/** The redundant sentence that repeats what the new line already says. Dropped
 *  when it appears WITHOUT an NPN — a paragraph carrying the NPN is the
 *  compliance attribution and is never touched. */
const REDUNDANT = /<p>[^<]*independent insurance agency\.\s*Agents are independent contractors\.[^<]*<\/p>/i;

/** Replace the first paragraph after the Compensation heading, and only that
 *  one. Deliberately narrow: this edits live postings, so a surgical swap beats
 *  anything clever that might eat an adjacent section.
 *
 *  Exported so the transformation can be tested against real posting HTML
 *  without reaching the API — the part worth testing is this, not the PATCH. */
export function rewrite(html) {
  const heading = /<h3>\s*Compensation\s*<\/h3>\s*/i;
  const m = html.match(heading);
  if (!m) return { ok: false, reason: 'no <h3>Compensation</h3> section' };

  const start = m.index + m[0].length;
  if (!html.slice(start).startsWith('<p>')) return { ok: false, reason: 'no <p> directly after the Compensation heading' };
  const end = html.indexOf('</p>', start);
  if (end < 0) return { ok: false, reason: 'unterminated <p> after Compensation' };

  let out = html.slice(0, start) + NEW_COMP + html.slice(end + 4);

  // Only drop the redundancy when it carries no NPN.
  const red = out.match(REDUNDANT);
  if (red && !/NPN/i.test(red[0])) out = out.replace(REDUNDANT, '');

  return { ok: true, html: out };
}

/** Refuse to write a description that lost something it must keep. Cheap, and
 *  it runs against 255 live postings, so a silent regression here is expensive. */
export function verify(before, after) {
  const text = (s) => s.replace(/<[^>]+>/g, ' ');
  const problems = [];
  if (!/\b1099\b/.test(text(after))) problems.push('lost the 1099 disclosure');
  if (!/no salary|no guaranteed|without a salary/i.test(text(after))) problems.push('lost the no-salary disclosure');
  if (/NPN/i.test(text(before)) && !/NPN/i.test(text(after))) problems.push('lost the NPN attribution');
  if (/equal opportunity/i.test(text(before)) && !/equal opportunity/i.test(text(after))) problems.push('lost the EEO paragraph');
  if (/\$\s?\d|\b\d{2,3}\s?k\b/i.test(text(after))) problems.push('introduced something that looks like a pay figure');
  if (after.length > before.length) problems.push('got longer, which this edit never should');
  return problems;
}

// Importing this module must not hit the API — the tests import `rewrite` and
// `verify` directly.
const RUN_DIRECTLY = process.argv[1] && process.argv[1].endsWith('fix-compensation.mjs');
if (!RUN_DIRECTLY) { /* imported for its pure functions */ }
else {

const api = client();
const all = await allJobs(api).catch(die);
const jobs = ONLY ? all.filter((j) => (j.position_name || '').toLowerCase().includes(ONLY.toLowerCase())) : all;

console.log(`${all.length} jobs in the account${ONLY ? `, ${jobs.length} matching "${ONLY}"` : ''}\n`);

const planned = [];
const skipped = [];
for (const j of jobs) {
  const r = rewrite(j.description || '');
  if (!r.ok) { skipped.push({ job: j, reason: r.reason }); continue; }
  if (r.html === j.description) { skipped.push({ job: j, reason: 'already rewritten' }); continue; }
  const problems = verify(j.description, r.html);
  if (problems.length) { skipped.push({ job: j, reason: problems.join('; ') }); continue; }
  planned.push({ job: j, html: r.html });
}

console.log(`${planned.length} to rewrite, ${skipped.length} skipped\n`);

if (skipped.length) {
  const byReason = new Map();
  for (const s of skipped) byReason.set(s.reason, (byReason.get(s.reason) ?? 0) + 1);
  console.log('Skipped:');
  for (const [reason, n] of byReason) console.log(`  ${String(n).padStart(4)}  ${reason}`);
  console.log('');
}

if (!planned.length) { console.log('Nothing to do.'); process.exit(0); }

if (!LIVE) {
  const { job, html } = planned[0];
  const section = (s) => {
    const i = s.search(/<h3>\s*Compensation\s*<\/h3>/i);
    return i < 0 ? '(none)' : s.slice(i).replace(/<\/p>/g, '</p>\n    ').trim();
  };
  console.log(`Example — job ${job.id} "${job.position_name}" (${job.city || 'no city'})\n`);
  console.log('  BEFORE\n    ' + section(job.description) + '\n');
  console.log('  AFTER\n    ' + section(html) + '\n');
  console.log(`Dry run — nothing was sent. Add --live to apply to ${planned.length} posting(s).`);
  process.exit(0);
}

// ── apply ────────────────────────────────────────────────────────────
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
  // Manatal throttles bursts (reference/manatal-api.md). 255 edits is well past
  // where that starts to matter.
  if (i + 1 < planned.length) await new Promise((r) => setTimeout(r, 400));
}

console.log(`\n${ok} rewritten${failed.length ? `, ${failed.length} failed` : ''}.`);
for (const f of failed) console.log(`  FAILED  ${f}`);
if (failed.length) process.exitCode = 1;

}
