#!/usr/bin/env node
// Are candidates actually arriving in Manatal, and when did the last one land?
//
//   node scripts/check-applicants.mjs           # summary
//   node scripts/check-applicants.mjs --jobs    # per-job counts for jobs with applicants
//   node scripts/check-applicants.mjs --shape   # dump one record's fields (API spelunking)
//
// Read-only.
//
// This exists to split a question that looks like one problem and is two:
//
//   (a) nobody is applying              -> a distribution problem; the ads aren't seen
//   (b) people apply, nothing reaches the CRM -> a plumbing problem
//
// Those have opposite fixes, and from inside GoHighLevel they look identical:
// an empty pipeline. Manatal has NO outbound webhooks (reference/manatal-api.md)
// and their support confirmed on 2026-08-28 that GoHighLevel is not a supported
// integration, so (b) is not a hypothetical — nothing moves candidates out of
// the ATS unless something polls for them.
//
// If this prints a healthy candidate count and the CRM is empty, stop looking at
// the job postings. The ads are working and the handoff is what is missing.
import { client, die, allJobs } from './manatal.mjs';

const args = new Set(process.argv.slice(2));
const api = client();

const DAY = 86400000;
const ago = (d) => new Date(Date.now() - d * DAY);
const dateOf = (c) => new Date(c.created_at || c.created || c.applied_at || 0);

/** Walk a paginated Manatal collection. Capped — this is a health check, not an
 *  export, and an account with thousands of candidates should not stall here. */
async function collect(path, cap = 2000) {
  const out = [];
  for (let page = 1; out.length < cap; page++) {
    const res = await api(`${path}${path.includes('?') ? '&' : '?'}page=${page}&page_size=50`);
    const j = await res.json();
    if (!Array.isArray(j.results)) break;
    out.push(...j.results);
    if (!j.next) break;
  }
  return out;
}

let candidates = [];
try {
  candidates = await collect('candidates/');
} catch (err) {
  die(err);
}

if (args.has('--shape')) {
  if (!candidates.length) {
    console.log('No candidates returned, so there is no record shape to show.');
    process.exit(0);
  }
  console.log('Fields on one candidate record:\n');
  console.log(Object.keys(candidates[0]).join('\n'));
  console.log('\nFirst record:\n');
  console.log(JSON.stringify(candidates[0], null, 2).slice(0, 2000));
  process.exit(0);
}

const jobs = await allJobs(api).catch(die);
const live = jobs.filter((j) => j.is_published).length;

console.log(`\n${jobs.length} jobs (${live} live)`);
console.log(`${candidates.length} candidates in the ATS\n`);

if (!candidates.length) {
  console.log('NO CANDIDATES AT ALL.');
  console.log('');
  console.log('This is a distribution problem, not a CRM plumbing problem — nothing has');
  console.log('arrived to hand off. Check that the free job board is actually re-enabled,');
  console.log('and run `node scripts/audit-jobs.mjs` to see whether the postings are');
  console.log('duplicates of each other as far as a job board is concerned.');
  process.exit(0);
}

// ── recency: a dead feed and a working one look the same in a total ──
const buckets = [
  ['last 7 days', 7],
  ['last 30 days', 30],
  ['last 90 days', 90],
];
console.log('ARRIVALS');
for (const [label, d] of buckets) {
  const n = candidates.filter((c) => dateOf(c) >= ago(d)).length;
  console.log(`  ${label.padEnd(14)} ${n}`);
}
const newest = candidates.map(dateOf).sort((a, b) => b - a)[0];
if (newest && newest.getTime() > 0) {
  const days = Math.floor((Date.now() - newest.getTime()) / DAY);
  console.log(`  most recent    ${newest.toISOString().slice(0, 10)} (${days} day(s) ago)`);
}

// ── which jobs actually pull ────────────────────────────────────────
const jobOf = (c) => c.job ?? c.job_id ?? (c.jobs && c.jobs[0]) ?? null;
const byJob = new Map();
for (const c of candidates) {
  const k = jobOf(c);
  if (k == null) continue;
  byJob.set(k, (byJob.get(k) ?? 0) + 1);
}

if (byJob.size) {
  const title = new Map(jobs.map((j) => [j.id, j.position_name]));
  const ranked = [...byJob.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`\n${byJob.size} of ${jobs.length} jobs have received at least one applicant.`);
  if (args.has('--jobs')) {
    console.log('');
    for (const [id, n] of ranked) console.log(`  ${String(n).padStart(4)}  ${title.get(Number(id)) ?? title.get(id) ?? `job ${id}`}`);
  } else {
    console.log('Top:');
    for (const [id, n] of ranked.slice(0, 8)) console.log(`  ${String(n).padStart(4)}  ${title.get(Number(id)) ?? title.get(id) ?? `job ${id}`}`);
    console.log('\n  (--jobs for the full list)');
  }
} else {
  console.log('\nCandidates exist but none could be matched to a job — the field naming');
  console.log('may differ from what this script expects. Run with --shape.');
}

console.log(`
WHAT THIS MEANS
  Candidates are arriving in Manatal. If GoHighLevel looks empty, the postings
  are NOT the problem — the handoff is. Manatal has no outbound webhooks and no
  GoHighLevel integration, so nothing moves these records into the CRM unless
  something polls for them on a schedule.
`);
