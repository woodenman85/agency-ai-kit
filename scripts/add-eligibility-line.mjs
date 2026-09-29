#!/usr/bin/env node
// Add the US work-authorization requirement to every Manatal posting.
//
//   node scripts/add-eligibility-line.mjs             # dry run
//   node scripts/add-eligibility-line.mjs --live      # apply
//   node scripts/add-eligibility-line.mjs --only "First Responders"
//
// Inserted as the first bullet of the requirements list:
//
//   <li>Legally authorized to work in the United States</li>
//
// Why: on 2026-09-29 three applicants reached the pipeline with no US location
// and had to be dispositioned by hand. Nothing in the postings stated the
// requirement, so the filtering happened after people had already applied.
// Stating it up front screens at the source.
//
// This is a work-AUTHORIZATION requirement, not a nationality one, and the
// distinction is the whole point. Authorization to work in the US is a bona
// fide requirement of a role that needs a state insurance producer licence.
// Screening on national origin is not, and reference/compliance.md bans
// protected-class filters in postings. The wording above is the standard
// phrasing precisely because it describes eligibility rather than origin —
// do not "improve" it into anything about citizenship, visa status, or where
// someone is from.
//
// Licensing is deliberately NOT repeated here: every posting's requirements
// list already carries a state-licence bullet, and saying it twice reads as
// padding. The equivalent change is already applied to all 865 Warp postings
// for this agency.
import { client, die, allJobs } from './manatal.mjs';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const valueOf = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };

const LIVE = has('--live');
const ONLY = valueOf('--only');

export const LINE = '<li>Legally authorized to work in the United States</li>';

/** Postings use one of two headings for the requirements section, so match
 *  either and insert immediately after its opening <ul>. Verified against the
 *  live account: every posting uses one or the other. */
const HEADING = /(<h3>\s*(?:Qualifications|Who this is a fit for)\s*<\/h3>\s*<ul>)/i;

export function addLine(html) {
  if (!html) return { ok: false, reason: 'empty description' };
  if (/authorized to work/i.test(html)) return { ok: false, reason: 'already has the line' };
  if (!HEADING.test(html)) return { ok: false, reason: 'no Qualifications / Who this is a fit for list' };
  return { ok: true, html: html.replace(HEADING, `$1${LINE}`) };
}

/** Refuse anything that changed more than it should have. Runs against live
 *  postings, so a silent regression is expensive. */
export function verify(before, after) {
  const problems = [];
  if (!after.includes(LINE)) problems.push('the line is not present');
  if ((after.match(/authorized to work/gi) || []).length !== 1) problems.push('the line appears more than once');
  if (after.length !== before.length + LINE.length) problems.push('something other than the inserted line changed');
  if (!after.endsWith(before.slice(-120))) problems.push('the tail of the description changed');
  return problems;
}

const RUN_DIRECTLY = process.argv[1] && process.argv[1].endsWith('add-eligibility-line.mjs');
if (RUN_DIRECTLY) {
  const api = client();
  const all = await allJobs(api).catch(die);
  const jobs = ONLY ? all.filter((j) => (j.position_name || '').toLowerCase().includes(ONLY.toLowerCase())) : all;

  console.log(`\n${all.length} jobs${ONLY ? `, ${jobs.length} matching "${ONLY}"` : ''}\n`);

  const planned = [];
  const skipped = new Map();
  for (const j of jobs) {
    const r = addLine(j.description || '');
    if (!r.ok) { skipped.set(r.reason, (skipped.get(r.reason) ?? 0) + 1); continue; }
    const problems = verify(j.description, r.html);
    if (problems.length) { skipped.set(problems.join('; '), (skipped.get(problems.join('; ')) ?? 0) + 1); continue; }
    planned.push({ job: j, html: r.html });
  }

  console.log(`${planned.length} to update, ${[...skipped.values()].reduce((a, b) => a + b, 0)} skipped`);
  for (const [reason, n] of skipped) console.log(`  ${String(n).padStart(4)}  ${reason}`);
  console.log('');

  if (!planned.length) { console.log('Nothing to do.'); process.exit(0); }

  if (!LIVE) {
    const { job, html } = planned[0];
    const at = html.search(HEADING);
    console.log(`Example — job ${job.id} "${job.position_name}"\n`);
    console.log('  ' + html.slice(at, at + 300) + '…\n');
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

  console.log(`\n${ok} updated${failed.length ? `, ${failed.length} failed` : ''}.`);
  for (const f of failed) console.log(`  FAILED  ${f}`);
  if (failed.length) process.exitCode = 1;
}
