#!/usr/bin/env node
// Replace a piece of text inside the descriptions of specific Manatal jobs. Dry run unless --live.
//
//   node scripts/edit-jobs.mjs --title "Property and Casualty Pros" --find "no office or salary" --replace "no office"
//   node scripts/edit-jobs.mjs --title "Property and Casualty Pros" --find "no office or salary" --replace "no office" --live
//
// The match is literal text, not a regex, and applies to every occurrence in a description.
// After each write the job is read back from Manatal and checked — a PATCH that returned 200
// has not been proven to have landed until the record says so.
import { api, fetchAll, pause } from './manatal.mjs';

const argv = process.argv.slice(2);
const has = (n) => argv.includes(n);
const value = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const LIVE = has('--live');
const ids = (value('--ids') || '').split(',').map((s) => s.trim()).filter(Boolean).map(Number);
const title = value('--title');
const find = value('--find');
const replace = value('--replace');

const usage = (msg) => { console.error(`${msg}\n\nUsage: node scripts/edit-jobs.mjs (--ids 1,2,3 | --title "text") --find "old text" --replace "new text" [--live]`); process.exit(1); };
if (!ids.length && !title) usage('Say which jobs: --ids or --title.');
if (ids.some(Number.isNaN)) usage('--ids must be comma-separated job ids.');
if (title && title.length < 6) usage('--title is matched as a substring; use at least 6 characters.');
if (!find || find.length < 4) usage('--find is required and must be at least 4 characters.');
if (!has('--replace') || replace === undefined) usage('--replace is required (use --replace "" to delete the text).');

const plain = (s) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const around = (s, text) => { const i = plain(s).indexOf(plain(text)); return i < 0 ? '' : plain(s).slice(Math.max(0, i - 40), i + plain(text).length + 40).trim(); };

const { rows: all, count, complete } = await fetchAll('jobs/');
if (!complete) console.error(`Warning: Manatal reports ${count} jobs but the list returned only ${all.length}. --title can only match the ${all.length} it returned; use --ids for any other job.\n`);

const wanted = new Set(ids);
const selected = all.filter((j) => wanted.has(j.id) || (title && j.position_name.toLowerCase().includes(title.toLowerCase())));
const missing = [];
for (const id of ids.filter((id) => !all.some((j) => j.id === id))) {
  const res = await api(`jobs/${id}/`);
  if (res.ok) selected.push(await res.json()); else missing.push(id);
}
if (missing.length) console.error(`Not found in this account: ${missing.join(', ')}\n`);

const targets = selected.filter((j) => (j.description || '').includes(find));
console.log(`${selected.length} job(s) selected; ${targets.length} contain "${find}".`);
if (selected.length > targets.length) console.log(`${selected.length - targets.length} do not and will be left alone.`);
if (!targets.length) process.exit(0);

console.log(`\nChange:  …${around(targets[0].description, find)}…`);
console.log(`     to  …${around(targets[0].description.split(find).join(replace), replace || ' ') || '(text removed)'}…\n`);
for (const j of targets) console.log(`  ${String(j.id).padEnd(9)} ${(j.city || '-') + ', ' + (j.state || '-')}`.padEnd(40) + j.position_name);

if (!LIVE) { console.log('\nDry run — nothing was changed. Add --live to do it.'); process.exit(0); }

let verified = 0;
for (let i = 0; i < targets.length; i += 5) {
  const results = await Promise.all(targets.slice(i, i + 5).map(async (j) => {
    const expected = j.description.split(find).join(replace);
    const res = await api(`jobs/${j.id}/`, { method: 'PATCH', body: JSON.stringify({ description: expected }) });
    if (!res.ok) return { id: j.id, error: `PATCH HTTP ${res.status} ${await res.text()}` };
    const back = await api(`jobs/${j.id}/`);
    if (!back.ok) return { id: j.id, error: `could not read it back: HTTP ${back.status}` };
    const now = await back.json();
    if (now.description !== expected) return { id: j.id, error: 'Manatal accepted the edit but the record does not show it' };
    return { id: j.id };
  }));
  for (const r of results) {
    if (r.error) console.log(`  FAILED    ${r.id}: ${r.error}`);
    else { verified++; console.log(`  verified  ${r.id}`); }
  }
  if (i + 5 < targets.length) await pause(1200);
}
console.log(`\n${verified} of ${targets.length} edited and confirmed by reading the record back.`);
process.exit(verified === targets.length ? 0 : 1);
