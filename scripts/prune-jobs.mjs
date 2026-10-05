#!/usr/bin/env node
// Unpublish, republish, or permanently delete specific Manatal jobs. Dry run unless --live.
//
//   node scripts/prune-jobs.mjs --ids 4410630,4410641 --unpublish            # dry run
//   node scripts/prune-jobs.mjs --title "First Responders" --unpublish --live # reversible
//   node scripts/prune-jobs.mjs --title "First Responders" --republish --live # re-render from the current record
//   node scripts/prune-jobs.mjs --ids 4410630 --delete --live --confirm-delete # permanent
//   node scripts/prune-jobs.mjs --clone-drafts --delete                        # every UNPUBLISHED job with a city (clone-jobs leftovers); live ones are never selected
//
// Pick the gentlest action that works: unpublish, then republish, before you ever delete.
// --delete saves a full copy of every job it removes to deleted-jobs-<timestamp>.json first,
// so a deleted posting can be recreated; Manatal itself offers no undo. --delete also refuses any
// job that has applicants (Manatal may delete a job's applications with it) unless you add
// --include-applicants.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './env.mjs';
import { api, fetchAll, pause } from './manatal.mjs';
import { parseStates } from './states.mjs';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const value = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const LIVE = flag('--live');
const actions = ['--unpublish', '--republish', '--publish', '--delete'].filter(flag);
const ids = (value('--ids') || '').split(',').map((s) => s.trim()).filter(Boolean).map(Number);
const title = value('--title');
const duplicateCities = flag('--duplicate-cities'); // every posting in a city except the oldest one
const inStates = parseStates(value('--in-states')).map((x) => x.toLowerCase());
const cloneDrafts = flag('--clone-drafts'); // unpublished jobs that have a city set: what clone-jobs creates before publishing

const usage = (msg) => { console.error(`${msg}\n\nUsage: node scripts/prune-jobs.mjs (--ids 1,2,3 | --title "text" | --clone-drafts | --duplicate-cities | --in-states "Hawaii,NY") (--unpublish | --republish | --publish | --delete) [--live] [--confirm-delete] [--include-applicants] [--include-live]`); process.exit(1); };
if (actions.length !== 1) usage('Choose exactly one of --unpublish, --republish, --delete.');
if (!ids.length && !title && !cloneDrafts && !duplicateCities && !inStates.length) usage('Say which jobs: --ids, --title, --clone-drafts, --duplicate-cities or --in-states.');
if (ids.some(Number.isNaN)) usage('--ids must be comma-separated job ids.');
if (title && title.length < 6) usage('--title is matched as a substring; use at least 6 characters so it cannot match half the account by accident.');
const action = actions[0];
if (action === '--delete' && LIVE && !flag('--confirm-delete')) usage('Deleting is permanent. Add --confirm-delete to proceed.');

const { rows: all, count, complete } = await fetchAll('jobs/');
if (!complete) console.error(`Warning: Manatal reports ${count} jobs but the list returned only ${all.length}. --ids still reaches a job the list misses; --title can only match the ${all.length} it returned.\n`);

const wanted = new Set(ids);
// The oldest posting (lowest id) in each city is the one that stays when --duplicate-cities is used.
const oldestInCity = new Map();
for (const j of all) if (j.city) { const k = `${j.city}|${j.state}`.toLowerCase(); if (!oldestInCity.has(k) || j.id < oldestInCity.get(k)) oldestInCity.set(k, j.id); }
const selected = all.filter((j) => wanted.has(j.id)
  || (title && j.position_name.toLowerCase().includes(title.toLowerCase()))
  || (cloneDrafts && j.city && !j.is_published)
  || (duplicateCities && j.city && oldestInCity.get(`${j.city}|${j.state}`.toLowerCase()) !== j.id)
  || (inStates.length && j.city && inStates.includes((j.state || '').toLowerCase())));
// A job the list doesn't return can still be fetched directly by id.
const missing = [];
for (const id of ids.filter((id) => !all.some((j) => j.id === id))) {
  const res = await api(`jobs/${id}/`);
  if (res.ok) selected.push(await res.json()); else missing.push(id);
}
if (missing.length) console.error(`Not found in this account: ${missing.join(', ')}\n`);
if (!selected.length) { console.error('Nothing selected.'); process.exit(1); }

const verb = { '--unpublish': 'unpublish', '--republish': 'republish', '--publish': 'publish', '--delete': 'PERMANENTLY DELETE' }[action];
console.log(`${selected.length} job(s) selected — would ${verb}:\n`);
for (const j of selected) console.log(`  ${String(j.id).padEnd(9)} ${j.is_published ? 'LIVE ' : 'draft'}  ${(j.city || '-') + ', ' + (j.state || '-')}`.padEnd(48) + j.position_name);

// Applicants hang off jobs. Deleting a job may take its applications with it, so check first.
if (action === '--delete') {
  let withApplicants = [];
  try {
    const matches = await fetchAll('matches/');
    if (!matches.complete) throw new Error(`only ${matches.rows.length} of ${matches.count} applications could be listed`);
    const per = new Map();
    for (const m of matches.rows) per.set(m.job_id, (per.get(m.job_id) || 0) + 1);
    withApplicants = selected.filter((j) => per.has(j.id)).map((j) => ({ id: j.id, n: per.get(j.id) }));
  } catch (e) {
    console.error(`\nCould not check which jobs have applicants (${e.message}).`);
    if (LIVE && !flag('--include-applicants')) { console.error('Refusing to delete without knowing. Nothing was changed.'); process.exit(1); }
  }
  if (withApplicants.length) {
    console.log(`\n${withApplicants.length} of these job(s) have applicants (${withApplicants.reduce((a, b) => a + b.n, 0)} applications): ${withApplicants.map((w) => `${w.id} (${w.n})`).join(', ')}`);
    if (LIVE && !flag('--include-applicants')) {
      console.error('\nRefusing to delete jobs that have applicants — Manatal may delete their applications with them. Unpublish those jobs instead (--unpublish), or add --include-applicants if you have exported the applicants and are sure. Nothing was changed.');
      process.exit(1);
    }
  }
}

const liveOnes = selected.filter((j) => j.is_published);
if (action === '--delete' && liveOnes.length) {
  console.log(`\n${liveOnes.length} of these are LIVE (published) right now.`);
  if (LIVE && !flag('--include-live')) { console.error('Refusing to delete live postings. Unpublish them first, or add --include-live if you are sure. Nothing was changed.'); process.exit(1); }
}

if (!LIVE) { console.log('\nDry run — nothing was changed. Add --live to do it.'); process.exit(0); }

if (action === '--delete') {
  const backup = path.join(ROOT, `deleted-jobs-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(backup, JSON.stringify(selected, null, 2));
  console.log(`\nBacked up ${selected.length} job record(s) to ${path.basename(backup)}`);
}

const step = async (j) => {
  const patch = (is_published) => api(`jobs/${j.id}/`, { method: 'PATCH', body: JSON.stringify({ is_published }) });
  let res;
  if (action === '--delete') res = await api(`jobs/${j.id}/`, { method: 'DELETE' });
  else if (action === '--unpublish') res = await patch(false);
  else if (action === '--publish') res = await patch(true);
  else { res = await patch(false); if (res.ok) { await pause(1500); res = await patch(true); } }
  return res.ok ? { id: j.id } : { id: j.id, error: `HTTP ${res.status} ${await res.text()}` };
};

let ok = 0;
for (let i = 0; i < selected.length; i += 5) {
  const results = await Promise.all(selected.slice(i, i + 5).map(step));
  for (const r of results) {
    if (r.error) console.log(`  FAILED  ${r.id}: ${r.error}`);
    else { ok++; console.log(`  ok      ${r.id}`); }
  }
  if (i + 5 < selected.length) await pause(1200);
}
console.log(`\n${ok} of ${selected.length} done.`);
process.exit(ok === selected.length ? 0 : 1);
