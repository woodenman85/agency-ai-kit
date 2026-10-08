#!/usr/bin/env node
// Read-only snapshot of the Manatal account, short enough to paste into a chat. Changes nothing.
//
//   node scripts/status-manatal.mjs
//
// Shows: what is live, which cities have a posting, duplicates, excluded states, how many cities are
// left in each city pool, any flagged wording (count only; run audit-manatal.mjs for the detail), the
// fields the API exposes on a job (to see what it says about free job boards), and how many applicants
// arrived recently and from where (counts only; no names). Prints no candidate data and no secrets.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './env.mjs';
import { api, fetchAll } from './manatal.mjs';

const EXCLUDED = ['hawaii', 'alaska', 'new york'];
const FLAGS = /commission|\b(salary|salaried|hourly|wages?)\b|\$\s?\d|\b\d{2,3}\s?k\b|\b(six|seven)[- ]figures?\b/i;
const BOARDISH = /board|free|feed|distribut|syndic|channel|indeed|ziprecruiter|external|source|publish/i;
const key = (c, s) => `${c || ''}|${s || ''}`.toLowerCase();
const tally = (values) => { const m = new Map(); for (const v of values) { const k = v === null || v === undefined || v === '' ? '(empty)' : typeof v === 'object' ? JSON.stringify(v).slice(0, 60) : String(v).slice(0, 60); m.set(k, (m.get(k) || 0) + 1); } return [...m.entries()].sort((a, b) => b[1] - a[1]); };
const line = (pairs) => pairs.map(([k, n]) => `${k} ${n}`).join('; ');

const { rows: jobs, count, complete } = await fetchAll('jobs/');
const { rows: orgs } = await fetchAll('organizations/');
console.log(`Manatal status — ${orgs.map((o) => `${o.name} (org ${o.id})`).join(', ') || 'no organization returned'}`);
console.log(`Jobs: ${count} reported, ${jobs.length} read${complete ? ' (complete)' : ' — INCOMPLETE, numbers below can be short'}\n`);

const templates = jobs.filter((j) => !j.city && !j.state).sort((a, b) => a.id - b.id);
const cityJobs = jobs.filter((j) => j.city || j.state);
const live = (list) => list.filter((j) => j.is_published).length;

console.log(`Templates (no city): ${templates.length}, ${live(templates)} live`);
for (const t of templates) console.log(`  ${String(t.id).padEnd(9)} ${t.is_published ? 'LIVE ' : 'draft'} ${t.position_name}`);

console.log(`\nCity postings: ${cityJobs.length} — ${live(cityJobs)} live, ${cityJobs.length - live(cityJobs)} draft`);
for (const [title, n] of tally(cityJobs.map((j) => j.position_name))) console.log(`  ${String(n).padStart(3)}  ${title}`);

const perCity = new Map();
for (const j of cityJobs) perCity.set(key(j.city, j.state), [...(perCity.get(key(j.city, j.state)) || []), j]);
const repeated = [...perCity.values()].filter((v) => v.length > 1);
const banned = cityJobs.filter((j) => EXCLUDED.includes((j.state || '').toLowerCase()));
const cityInTitle = cityJobs.filter((j) => j.city && new RegExp(`\\b${j.city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(j.position_name));
console.log(`\nCities with more than one posting: ${repeated.length}${repeated.length ? ' — ' + repeated.slice(0, 8).map((v) => `${v[0].city}, ${v[0].state} (${v.length})`).join('; ') + (repeated.length > 8 ? '; …' : '') : ''}`);
console.log(`Postings in Hawaii / Alaska / New York: ${banned.length}${banned.length ? ' — ' + banned.slice(0, 8).map((j) => `${j.city}, ${j.state} [${j.id}]`).join('; ') : ''}`);
console.log(`Postings with the city in the title: ${cityInTitle.length}`);
console.log(`Jobs with flagged wording (commission / salary / hourly / pay figure): ${jobs.filter((j) => FLAGS.test(`${j.position_name} ${(j.description || '').replace(/<[^>]+>/g, ' ')}`)).length}`);

console.log('\nCity pools (cities still without a posting, excluding Hawaii / Alaska / New York):');
for (const f of ['cities.json', 'cities-2.json']) {
  const p = path.join(ROOT, 'scripts', f);
  if (!fs.existsSync(p)) continue;
  const list = JSON.parse(fs.readFileSync(p, 'utf8')).filter((c) => !EXCLUDED.includes(c.state.toLowerCase()));
  const open = list.filter((c) => !perCity.has(key(c.city, c.state)));
  console.log(`  ${f.padEnd(14)} ${list.length} usable, ${list.length - open.length} have a posting, ${open.length} left`);
}

const sample = jobs[0];
if (sample) {
  console.log(`\nFields the API returns on a job:\n  ${Object.keys(sample).sort().join(', ')}`);
  const extra = Object.keys(sample).filter((k) => BOARDISH.test(k) && !['is_published', 'position_name'].includes(k)).sort();
  for (const k of extra) console.log(`  ${k}: ${line(tally(jobs.map((j) => j[k])).slice(0, 6))}`);
}
if (orgs[0]) {
  const orgExtra = Object.keys(orgs[0]).filter((k) => BOARDISH.test(k)).sort();
  if (orgExtra.length) { console.log('\nOrganization fields that mention boards / feeds / sources:'); for (const k of orgExtra) console.log(`  ${k}: ${line(tally(orgs.map((o) => o[k])).slice(0, 6))}`); }
}

// Applicants in the last 14 days, counted by where they came from. Counts only.
try {
  const since = new Date(Date.now() - 14 * 86400000).toISOString();
  const res = await api(`candidates/?created_at__gte=${encodeURIComponent(since)}&page=1&page_size=50`);
  if (res.ok) {
    const first = await res.json();
    const rows = [...first.results];
    for (let page = 2; first.next && page <= 6; page++) {
      const r = await api(`candidates/?created_at__gte=${encodeURIComponent(since)}&page=${page}&page_size=50`);
      if (!r.ok) break;
      const j = await r.json(); rows.push(...j.results); if (!j.next) break;
    }
    const honored = rows.every((r) => !r.created_at || Date.parse(r.created_at) >= Date.parse(since) - 1000);
    console.log(`\nApplicants in the last 14 days: ${honored ? first.count : 'unknown (Manatal ignored the date filter)'}`);
    if (honored && rows.length) {
      const srcKeys = Object.keys(rows[0]).filter((k) => /source/i.test(k));
      for (const k of srcKeys) console.log(`  ${k}: ${line(tally(rows.map((r) => r[k])).slice(0, 8))}`);
      if (first.count > rows.length) console.log(`  (breakdown covers the first ${rows.length} of ${first.count})`);
    }
  } else console.log(`\nApplicants: could not be read (HTTP ${res.status}).`);
} catch (e) { console.log(`\nApplicants: could not be read (${e.message}).`); }

console.log('\nNothing was changed.');
