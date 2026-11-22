#!/usr/bin/env node
// Make every city posting's description match its approved template, word for word. Dry run unless --live.
//
//   node scripts/sync-descriptions.mjs --titles-file scripts/titles-2.json           # dry run: what differs
//   node scripts/sync-descriptions.mjs --titles-file scripts/titles-2.json --live    # restore the template text
//
// The templates are the jobs with NO city (the ones Manatal reviewed). A city posting is matched to its template
// by title: the template's own title, or its new title from --titles-file. Only the description is written; the
// title, city, published state and everything else are left alone, and the templates themselves are never edited.
// It refuses to run if a template contains the wording Manatal flagged. After each write the job is read back,
// and nothing is called restored until the record shows the template text.
import { api, fetchAll, pause } from './manatal.mjs';
import fs from 'node:fs';

const argv = process.argv.slice(2);
const has = (n) => argv.includes(n);
const value = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const LIVE = has('--live');
const titlesFile = value('--titles-file');
const sourceIds = (value('--source-ids') || '').split(',').map((s) => s.trim()).filter(Boolean).map(Number);

const usage = (msg) => { console.error(`${msg}\n\nUsage: node scripts/sync-descriptions.mjs [--titles-file path] [--source-ids 1,2,3] [--live]`); process.exit(1); };

// What Manatal's reviewers flagged. A template with any of it is not an approved source.
const FLAGS = [['commission', /commission/i], ['salary / hourly / wage wording', /\b(salary|salaried|hourly|wages?)\b/i], ['pay figure', /\$\s?\d|\b\d{2,3}\s?k\b|\b(six|seven)[- ]figures?\b/i]];
const flaggedIn = (text) => FLAGS.filter(([, re]) => re.test(text.replace(/<[^>]+>/g, ' '))).map(([kind]) => kind);
const norm = (s) => (s || '').replace(/\r\n/g, '\n').trim();

const { rows: all, count, complete } = await fetchAll('jobs/');
if (!complete) {
  console.error(`Manatal reports ${count} jobs but the list returned only ${all.length}, so some postings would be missed.`);
  if (LIVE) { console.error('Refusing to write on an incomplete list. Nothing was changed.'); process.exit(1); }
  console.error('');
}

const templates = (sourceIds.length ? all.filter((j) => sourceIds.includes(j.id)) : all.filter((j) => !j.city && !j.state)).sort((a, b) => a.id - b.id);
if (!templates.length) usage('No template jobs found. Templates are the jobs with no city set (or pass --source-ids).');
for (const t of templates) {
  const bad = flaggedIn(`${t.position_name} ${t.description || ''}`);
  if (bad.length) { console.error(`Template "${t.position_name}" (${t.id}) contains ${bad.join(', ')}. Fix the template first; it is the source of truth. Nothing was changed.`); process.exit(1); }
}

// title -> template (its own title, plus the new title from --titles-file)
const byTitle = new Map(templates.map((t) => [t.position_name.toLowerCase(), t]));
if (titlesFile) {
  const map = JSON.parse(fs.readFileSync(titlesFile, 'utf8'));
  for (const [oldTitle, newTitle] of Object.entries(map)) {
    const t = templates.find((x) => x.position_name === oldTitle);
    if (t) byTitle.set(String(newTitle).toLowerCase(), t);
  }
}

const postings = all.filter((j) => j.city || j.state);
const matched = [], noTemplate = [];
for (const j of postings) { const t = byTitle.get((j.position_name || '').toLowerCase()); if (t) matched.push({ j, t }); else noTemplate.push(j); }
const drifted = matched.filter(({ j, t }) => norm(j.description) !== norm(t.description));
const driftedFlagged = drifted.filter(({ j }) => flaggedIn(j.description || '').length);

console.log(`${templates.length} template(s), all clean:`);
for (const t of templates) console.log(`  ${String(t.id).padEnd(9)} ${t.position_name}`);
console.log(`\n${postings.length} city postings: ${matched.length - drifted.length} already match their template; ${drifted.length} differ (${driftedFlagged.length} of those contain the flagged wording); ${noTemplate.length} have a title with no template.`);
if (noTemplate.length) {
  const titles = [...new Set(noTemplate.map((j) => j.position_name))];
  console.log(`  No template for: ${titles.slice(0, 8).map((x) => `"${x}"`).join(', ')}${titles.length > 8 ? ', …' : ''} (pass --titles-file if these are new titles). They will not be touched.`);
}
if (drifted.length) {
  const plain = (s) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const a = plain(drifted[0].j.description || ''), b = plain(drifted[0].t.description || '');
  let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++;
  console.log(`\nFirst difference (${drifted[0].j.city}, ${drifted[0].j.state}):`);
  console.log(`  now:       …${a.slice(Math.max(0, i - 30), i + 140)}…`);
  console.log(`  approved:  …${b.slice(Math.max(0, i - 30), i + 140)}…`);
  console.log('');
  for (const { j } of drifted.slice(0, 10)) console.log(`  ${String(j.id).padEnd(9)} ${j.is_published ? 'LIVE ' : 'draft'} ${((j.city || '-') + ', ' + (j.state || '-')).padEnd(30)} ${j.position_name}`);
  if (drifted.length > 10) console.log(`  …and ${drifted.length - 10} more`);
}
if (!drifted.length) { console.log('\nEvery matched posting already carries its template text. Nothing to do.'); process.exit(0); }
if (!LIVE) { console.log('\nDry run — nothing was changed. Add --live to restore the template text on those postings.'); process.exit(0); }

let done = 0; const failed = [];
for (let i = 0; i < drifted.length; i += 5) {
  const results = await Promise.all(drifted.slice(i, i + 5).map(async ({ j, t }) => {
    const res = await api(`jobs/${j.id}/`, { method: 'PATCH', body: JSON.stringify({ description: t.description }) });
    if (!res.ok) return { id: j.id, error: `PATCH HTTP ${res.status} ${await res.text()}` };
    const back = await api(`jobs/${j.id}/`);
    if (!back.ok) return { id: j.id, error: `could not read it back: HTTP ${back.status}` };
    if (norm((await back.json()).description) !== norm(t.description)) return { id: j.id, error: 'Manatal accepted the edit but the record does not show it' };
    return { id: j.id };
  }));
  for (const r of results) { if (r.error) { failed.push(r); console.log(`  FAILED    ${r.id}: ${r.error}`); } else done++; }
  if ((i / 5) % 10 === 9 || i + 5 >= drifted.length) console.log(`  …${done} restored and confirmed so far (${Math.min(i + 5, drifted.length)} of ${drifted.length} tried)`);
  if (i + 5 < drifted.length) await pause(1500);
}
console.log(`\n${done} of ${drifted.length} restored and confirmed by reading each record back.`);
if (failed.length) console.log(`${failed.length} failed. Run the same command again; it only touches postings that still differ.`);
console.log('Next: node scripts/audit-manatal.mjs');
process.exit(done === drifted.length ? 0 : 1);
