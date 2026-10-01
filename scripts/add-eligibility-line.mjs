#!/usr/bin/env node
// Add the US work-authorization requirement to every Manatal posting.
//
//   node scripts/add-eligibility-line.mjs             # dry run
//   node scripts/add-eligibility-line.mjs --live      # apply
//   node scripts/add-eligibility-line.mjs --only "First Responders"
//
// Inserted as the first bullet of the requirements list:
//
//   <li>At least 18 years old and legally authorized to work in the United States</li>
//
// The age minimum was added 2026-10-01 at the agency owner's request. It is a
// bona fide requirement, not a preference: no state issues a life insurance
// producer licence to a minor, so an under-18 applicant cannot do this job at
// all. A FLOOR of 18 is lawful for that reason; the ADEA protects applicants
// aged 40 and over, and nothing here may express a preference for younger
// candidates or cap an age. See reference/compliance.md.
//
// Postings that already carry the older authorization-only wording are UPGRADED
// in place rather than skipped — all 255 live postings had it, so an insert-only
// script would have reported "already has the line" for every one of them and
// changed nothing.
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

export const LINE = '<li>At least 18 years old and legally authorized to work in the United States</li>';

/** The same requirement as a sentence, for postings built on a different
 *  skeleton — see SENTENCE_TARGET below. */
export const SENTENCE = ' Applicants must be at least 18 years old and legally authorized to work in the United States.';

/** What the line and sentence said before the age minimum was added. Postings
 *  carrying these are rewritten to the versions above. */
export const OLD_LINE = '<li>Legally authorized to work in the United States</li>';
export const OLD_SENTENCE = ' Applicants must be legally authorized to work in the United States.';

/** Most postings put requirements in a list under one of two headings. */
const LIST_HEADING = /(<h3>\s*(?:Qualifications|Who this is a fit for)\s*<\/h3>\s*<ul>)/i;

/** Six postings use an older skeleton with no requirements list at all — its
 *  sections are What You'll Do / What We Provide / Licensing Requirement /
 *  Compensation. The first pass skipped every one of them and reported it, and
 *  the skip went unnoticed because nobody read the output. Licensing Requirement
 *  is the right home for this: it is already the paragraph about what a
 *  candidate must be able to do before selling. */
const SENTENCE_TARGET = /(<h3>\s*Licensing Requirement\s*<\/h3>\s*<p>[^<]*?)(<\/p>)/i;

export function addLine(html) {
  if (!html) return { ok: false, reason: 'empty description' };

  // Already current — nothing to do.
  if (html.includes(LINE) || html.includes(SENTENCE)) {
    return { ok: false, reason: 'already has the current requirement' };
  }

  // Carries the older authorization-only wording: upgrade it in place. This has
  // to come before the /authorized to work/ bail-out below, or every posting
  // that already had the old line would be skipped.
  if (html.includes(OLD_LINE)) {
    return { ok: true, html: html.replace(OLD_LINE, LINE), added: LINE, upgraded: true };
  }
  if (html.includes(OLD_SENTENCE)) {
    return { ok: true, html: html.replace(OLD_SENTENCE, SENTENCE), added: SENTENCE, upgraded: true };
  }

  // Some other phrasing mentions work authorization. Do not guess at rewriting
  // it — report it so it can be looked at.
  if (/authorized to work/i.test(html)) {
    return { ok: false, reason: 'mentions work authorization in wording this script does not recognize' };
  }

  if (LIST_HEADING.test(html)) {
    return { ok: true, html: html.replace(LIST_HEADING, `$1${LINE}`), added: LINE };
  }
  if (SENTENCE_TARGET.test(html)) {
    return { ok: true, html: html.replace(SENTENCE_TARGET, `$1${SENTENCE}$2`), added: SENTENCE };
  }
  return { ok: false, reason: 'no requirements list and no Licensing Requirement paragraph' };
}

/** Refuse anything that changed more than it should have. Runs against live
 *  postings, so a silent regression is expensive. */
export function verify(before, after, added = LINE, { upgraded = false } = {}) {
  const problems = [];
  if (!after.includes(added)) problems.push('the requirement is not present');
  if ((after.match(/authorized to work/gi) || []).length !== 1) problems.push('it appears more than once');
  if (!/\bat least 18 years old\b/i.test(after)) problems.push('lost the age minimum');

  // An upgrade REPLACES the old wording, so the length grows only by the
  // difference between the two. An insert adds the whole thing.
  const old = added === LINE ? OLD_LINE : OLD_SENTENCE;
  const delta = upgraded ? added.length - old.length : added.length;
  if (after.length !== before.length + delta) problems.push('something other than the requirement changed');

  // The sentence variant sits mid-document, so only the list variant leaves the
  // tail byte-identical.
  if (added === LINE && !after.endsWith(before.slice(-120))) problems.push('the tail of the description changed');
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
    const problems = verify(j.description, r.html, r.added, { upgraded: r.upgraded });
    if (problems.length) { skipped.set(problems.join('; '), (skipped.get(problems.join('; ')) ?? 0) + 1); continue; }
    planned.push({ job: j, html: r.html, upgraded: !!r.upgraded });
  }

  const upgrades = planned.filter((p) => p.upgraded).length;
  console.log(`${planned.length} to update (${upgrades} upgrading the older wording, ${planned.length - upgrades} newly inserted), ` +
    `${[...skipped.values()].reduce((a, b) => a + b, 0)} skipped`);
  for (const [reason, n] of skipped) console.log(`  ${String(n).padStart(4)}  ${reason}`);
  console.log('');

  if (!planned.length) { console.log('Nothing to do.'); process.exit(0); }

  if (!LIVE) {
    const { job, html } = planned[0];
    const at = Math.max(0, html.search(/<h3>\s*(?:Qualifications|Who this is a fit for|Licensing Requirement)\s*<\/h3>/i));
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
