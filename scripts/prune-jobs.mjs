#!/usr/bin/env node
// Unpublish, republish, or permanently delete specific Manatal jobs. Dry run unless --live.
//
//   node scripts/prune-jobs.mjs --ids 4410630,4410641 --unpublish            # dry run
//   node scripts/prune-jobs.mjs --title "First Responders" --unpublish --live # reversible
//   node scripts/prune-jobs.mjs --title "First Responders" --republish --live # re-render from the current record
//   node scripts/prune-jobs.mjs --ids 4410630 --delete --live --confirm-delete # permanent
//
// Pick the gentlest action that works: unpublish, then republish, before you ever delete.
// --delete saves a full copy of every job it removes to deleted-jobs-<timestamp>.json first,
// so a deleted posting can be recreated; Manatal itself offers no undo.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, requireKey } from './env.mjs';

const key = requireKey('MANATAL_API_KEY', 'Get the key in Manatal: Settings -> Integrations -> Open API. It is account-wide, so treat it like a password.');
const BASE = process.env.MANATAL_API_BASE || 'https://api.manatal.com/open/v3/';

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const value = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const LIVE = flag('--live');
const actions = ['--unpublish', '--republish', '--delete'].filter(flag);
const ids = (value('--ids') || '').split(',').map((s) => s.trim()).filter(Boolean).map(Number);
const title = value('--title');

const usage = (msg) => { console.error(`${msg}\n\nUsage: node scripts/prune-jobs.mjs (--ids 1,2,3 | --title "text") (--unpublish | --republish | --delete) [--live] [--confirm-delete]`); process.exit(1); };
if (actions.length !== 1) usage('Choose exactly one of --unpublish, --republish, --delete.');
if (!ids.length && !title) usage('Say which jobs: --ids or --title.');
if (ids.some(Number.isNaN)) usage('--ids must be comma-separated job ids.');
if (title && title.length < 6) usage('--title is matched as a substring; use at least 6 characters so it cannot match half the account by accident.');
const action = actions[0];
if (action === '--delete' && LIVE && !flag('--confirm-delete')) usage('Deleting is permanent. Add --confirm-delete to proceed.');

const api = (p, init = {}) => fetch(`${BASE}${p}`, {
  ...init,
  headers: { Authorization: `Token ${key}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
});

const all = [];
for (let page = 1; ; page++) {
  const res = await api(`jobs/?page=${page}&page_size=50`);
  if (!res.ok) { console.error(`list jobs failed: HTTP ${res.status}`); process.exit(1); }
  const j = await res.json();
  all.push(...j.results);
  if (!j.next) break;
}

const wanted = new Set(ids);
const selected = all.filter((j) => wanted.has(j.id) || (title && j.position_name.toLowerCase().includes(title.toLowerCase())));
const missing = ids.filter((id) => !all.some((j) => j.id === id));
if (missing.length) console.error(`Not found in this account: ${missing.join(', ')}\n`);
if (!selected.length) { console.error('Nothing selected.'); process.exit(1); }

const verb = { '--unpublish': 'unpublish', '--republish': 'republish', '--delete': 'PERMANENTLY DELETE' }[action];
console.log(`${selected.length} job(s) selected — would ${verb}:\n`);
for (const j of selected) console.log(`  ${String(j.id).padEnd(9)} ${j.is_published ? 'LIVE ' : 'draft'}  ${(j.city || '-') + ', ' + (j.state || '-')}`.padEnd(48) + j.position_name);

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
  else { res = await patch(false); if (res.ok) { await new Promise((r) => setTimeout(r, 1500)); res = await patch(true); } }
  return res.ok ? { id: j.id } : { id: j.id, error: `HTTP ${res.status} ${await res.text()}` };
};

let ok = 0;
for (let i = 0; i < selected.length; i += 5) {
  const results = await Promise.all(selected.slice(i, i + 5).map(step));
  for (const r of results) {
    if (r.error) console.log(`  FAILED  ${r.id}: ${r.error}`);
    else { ok++; console.log(`  ok      ${r.id}`); }
  }
  if (i + 5 < selected.length) await new Promise((r) => setTimeout(r, 1200));
}
console.log(`\n${ok} of ${selected.length} done.`);
process.exit(ok === selected.length ? 0 : 1);
