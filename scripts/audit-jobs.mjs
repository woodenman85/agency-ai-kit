#!/usr/bin/env node
// Read every job in the Manatal account and report what is wrong with the set.
//
//   node scripts/audit-jobs.mjs            # summary
//   node scripts/audit-jobs.mjs --ids      # summary + the job ids behind each finding
//   node scripts/audit-jobs.mjs --json     # machine-readable, for pasting somewhere
//
// Read-only. It never writes, publishes, or unpublishes anything.
//
// The finding this exists for: a bulk city run produces N postings that differ
// only in a city name. Job boards deduplicate aggressively, so 200 copies of one
// ad do not get 200 listings' worth of traffic — they get one, and the rest are
// suppressed as duplicates. That is invisible from the Manatal UI, which happily
// shows all 200 as LIVE. `manatal-api.md` warns about it; nothing measured it.
import { client, die, allJobs } from './manatal.mjs';

const args = new Set(process.argv.slice(2));
const SHOW_IDS = args.has('--ids');
const AS_JSON = args.has('--json');

const api = client();
const jobs = await allJobs(api).catch(die);

const text = (h) => (h || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

/** Body with this job's own city/state/title removed, so two postings that are
 *  "the same ad, localized" collapse to the same string. This is the number
 *  that matters: boards compare the ad, not the metadata around it. */
function deLocalized(j) {
  let t = text(j.description).toLowerCase();
  for (const token of [j.city, j.state, j.position_name].filter(Boolean)) {
    t = t.split(token.toLowerCase()).join(' ');
  }
  return t.replace(/\s+/g, ' ').trim();
}

/** Overlapping word runs, the way a dedupe filter sees a document. */
function shingles(s, n = 8) {
  const w = s.split(' ').filter(Boolean);
  const out = new Set();
  for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(' '));
  return out;
}

const jaccard = (a, b) => {
  if (!a.size || !b.size) return 0;
  let hit = 0;
  for (const x of a) if (b.has(x)) hit++;
  return hit / (a.size + b.size - hit);
};

const live = jobs.filter((j) => j.is_published);

// ── grouping ─────────────────────────────────────────────────────────
const byTitle = new Map();
for (const j of jobs) {
  const k = j.position_name || '(untitled)';
  (byTitle.get(k) ?? byTitle.set(k, []).get(k)).push(j);
}

const byBody = new Map();
for (const j of jobs) {
  const k = deLocalized(j);
  (byBody.get(k) ?? byBody.set(k, []).get(k)).push(j);
}

// ── per-posting checks ───────────────────────────────────────────────
const issue = (name) => ({ name, jobs: [] });
const checks = {
  no1099: issue('body never says 1099'),
  noCommission: issue('no commission word — feed validators reject this'),
  noFooter: issue('compliance footer missing (no NPN)'),
  noRemote: issue('never states the role is remote'),
  payFigure: issue('a pay figure in the body — income claim'),
  salaryField: issue('salary_min/max populated on a commission role'),
  commissionOnly: issue('contains the literal "commission-only"'),
  cityInTitle: issue('city is in the job title'),
  thin: issue('body under 150 words'),
  noHeadings: issue('no <h3> sections'),
};

for (const j of jobs) {
  const body = text(j.description);
  const words = body.split(' ').filter(Boolean).length;
  const push = (c) => c.jobs.push(j);

  if (!/\b1099\b/.test(body)) push(checks.no1099);
  if (!/commission/i.test(body)) push(checks.noCommission);
  if (!/NPN/i.test(body)) push(checks.noFooter);
  if (!/remote|work[- ]from[- ]home|telecommut/i.test(body)) push(checks.noRemote);
  if (/\$\s?\d|\b\d{2,3}\s?k\b/i.test(body)) push(checks.payFigure);
  if (j.salary_min != null || j.salary_max != null) push(checks.salaryField);
  if (/commission[-\s]only/i.test(body)) push(checks.commissionOnly);
  if (j.city && new RegExp(`\\b${j.city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(j.position_name || ''))
    push(checks.cityInTitle);
  if (words && words < 150) push(checks.thin);
  if (!/<h3>/i.test(j.description || '')) push(checks.noHeadings);
}

// ── near-duplicate bodies across DIFFERENT de-localized text ─────────
// Exact groups above catch "identical once the city is removed". This catches
// the softer version: two ads a human would call different that a dedupe filter
// would not. Compared on de-localized text so a city swap cannot mask it.
const reps = [...byBody.entries()].map(([k, v]) => ({ k, v, sh: shingles(k) }));
const nearPairs = [];
for (let i = 0; i < reps.length; i++) {
  for (let x = i + 1; x < reps.length; x++) {
    const sim = jaccard(reps[i].sh, reps[x].sh);
    if (sim >= 0.6) nearPairs.push({ a: reps[i], b: reps[x], sim });
  }
}

// ── report ───────────────────────────────────────────────────────────
const dupTitles = [...byTitle.entries()].filter(([, v]) => v.length > 1).sort((a, b) => b[1].length - a[1].length);
const dupBodies = [...byBody.entries()].filter(([, v]) => v.length > 1).sort((a, b) => b[1].length - a[1].length);
const largestDup = dupBodies[0]?.[1].length ?? 0;

if (AS_JSON) {
  console.log(JSON.stringify({
    total: jobs.length,
    live: live.length,
    distinctTitles: byTitle.size,
    distinctBodies: byBody.size,
    largestIdenticalGroup: largestDup,
    duplicateTitleGroups: dupTitles.map(([t, v]) => ({ title: t, count: v.length })),
    duplicateBodyGroups: dupBodies.map(([, v]) => ({ count: v.length, title: v[0].position_name, ids: v.map((j) => j.id) })),
    nearDuplicatePairs: nearPairs.length,
    findings: Object.values(checks).filter((c) => c.jobs.length)
      .map((c) => ({ issue: c.name, count: c.jobs.length, ids: c.jobs.map((j) => j.id) })),
  }, null, 2));
  process.exit(0);
}

console.log(`\n${jobs.length} jobs (${live.length} live, ${jobs.length - live.length} draft)\n`);

console.log('DISTINCTNESS  — what a job board dedupe filter sees');
console.log(`  distinct titles              ${byTitle.size} across ${jobs.length} postings`);
console.log(`  distinct bodies (city-blind) ${byBody.size} across ${jobs.length} postings`);
if (largestDup > 1) {
  console.log(`  largest identical group      ${largestDup} postings share ONE body`);
}
console.log(`  near-duplicate body pairs    ${nearPairs.length} (≥60% of 8-word runs shared)`);

if (dupBodies.length) {
  console.log('\n  Identical bodies (city removed):');
  for (const [, v] of dupBodies.slice(0, 12)) {
    console.log(`    ${String(v.length).padStart(4)} x  ${v[0].position_name}`);
    if (SHOW_IDS) console.log(`           ${v.map((j) => j.id).join(' ')}`);
  }
  if (dupBodies.length > 12) console.log(`    …and ${dupBodies.length - 12} more groups`);
}

if (dupTitles.length) {
  console.log('\n  Repeated titles:');
  for (const [t, v] of dupTitles.slice(0, 12)) console.log(`    ${String(v.length).padStart(4)} x  ${t}`);
  if (dupTitles.length > 12) console.log(`    …and ${dupTitles.length - 12} more`);
}

const found = Object.values(checks).filter((c) => c.jobs.length);
console.log('\nCONTENT & COMPLIANCE');
if (!found.length) {
  console.log('  no issues found');
} else {
  for (const c of found) {
    console.log(`  ${String(c.jobs.length).padStart(4)}  ${c.name}`);
    if (SHOW_IDS) console.log(`        ${c.jobs.slice(0, 40).map((j) => j.id).join(' ')}${c.jobs.length > 40 ? ' …' : ''}`);
  }
}

console.log(`\nRun with --ids to see which jobs, or --json to paste the whole thing somewhere.\n`);
