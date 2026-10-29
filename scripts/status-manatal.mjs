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
import { api, fetchAll, pause } from './manatal.mjs';

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
const liveByCity = new Map();
for (const j of cityJobs.filter((x) => x.is_published)) liveByCity.set(key(j.city, j.state), [...(liveByCity.get(key(j.city, j.state)) || []), j]);
const repeated = [...liveByCity.values()].filter((v) => v.length > 1);
const banned = cityJobs.filter((j) => EXCLUDED.includes((j.state || '').toLowerCase()));
const cityInTitle = cityJobs.filter((j) => j.city && new RegExp(`\\b${j.city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(j.position_name));
console.log(`\nCities with more than one LIVE posting: ${repeated.length}${repeated.length ? ' — ' + repeated.slice(0, 8).map((v) => `${v[0].city}, ${v[0].state} (${v.length})`).join('; ') + (repeated.length > 8 ? '; …' : '') : ''}`);
console.log(`Postings in Hawaii / Alaska / New York: ${banned.length}${banned.length ? ' — ' + banned.slice(0, 8).map((j) => `${j.city}, ${j.state} [${j.id}]`).join('; ') : ''}`);
console.log(`Postings with the city in the title: ${cityInTitle.length}`);
console.log(`Jobs with flagged wording (commission / salary / hourly / pay figure): ${jobs.filter((j) => FLAGS.test(`${j.position_name} ${(j.description || '').replace(/<[^>]+>/g, ' ')}`)).length}`);

console.log('\nCity pools (excluding Hawaii / Alaska / New York):');
const poolFiles = fs.readdirSync(path.join(ROOT, 'scripts')).filter((f) => /^cities(-\d+|-all)?\.json$/.test(f)).sort((a, b) => (a.includes('all') ? 999 : parseInt(a.replace(/\D/g, '') || '1')) - (b.includes('all') ? 999 : parseInt(b.replace(/\D/g, '') || '1')));
for (const f of poolFiles) {
  const p = path.join(ROOT, 'scripts', f);
  const list = JSON.parse(fs.readFileSync(p, 'utf8')).filter((c) => !EXCLUDED.includes(c.state.toLowerCase()));
  const liveNow = list.filter((c) => liveByCity.has(key(c.city, c.state))).length;
  const everPosted = list.filter((c) => perCity.has(key(c.city, c.state))).length;
  console.log(`  ${f.padEnd(15)} ${list.length} usable: ${liveNow} live now, ${everPosted - liveNow} posted before (not live), ${list.length - everPosted} never posted`);
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

// Applicants in the last 14 days: how many per day and where they came from. Counts only, no names.
try {
  const since = new Date(Date.now() - 14 * 86400000).toISOString();
  const url = (page) => `candidates/?created_at__gte=${encodeURIComponent(since)}&page=${page}&page_size=50`;
  const res = await api(url(1));
  if (res.ok) {
    const first = await res.json();
    const rows = [...first.results];
    let more = first.next;
    for (let page = 2; more && page <= 40; page++) {
      const r = await api(url(page));
      if (!r.ok) break;
      const j = await r.json(); rows.push(...j.results); more = j.next;
      await pause(150);
    }
    const honored = rows.every((r) => !r.created_at || Date.parse(r.created_at) >= Date.parse(since) - 1000);
    console.log(`\nApplicants in the last 14 days: ${honored ? first.count : 'unknown (Manatal ignored the date filter)'}${honored && first.count > rows.length ? `` : ''}`);
    if (honored && rows.length) {
      // exact per-day counts (UTC days): one count request per day, so the sample cap below cannot skew them
      const perDay = [];
      for (let back = 13; back >= 0; back--) {
        const day = new Date(Date.now() - back * 86400000).toISOString().slice(0, 10);
        const r = await api(`candidates/?created_at__gte=${day}T00:00:00Z&created_at__lte=${day}T23:59:59Z&page=1&page_size=1`);
        if (!r.ok) { perDay.length = 0; break; }
        perDay.push([day, (await r.json()).count]);
        await pause(100);
      }
      if (perDay.length) console.log(`  per day (UTC, exact): ${perDay.filter(([, n]) => n).map(([d, n]) => `${d.slice(5)} ${n}`).join('; ')}`);
      if (first.count > rows.length) console.log(`  the board breakdown below is the ${rows.length} applicants Manatal returned, not all ${first.count}`);
      // source fields, opened one or two levels down so a board's name is not cut off
      const flat = new Map();
      const add = (k, v) => { if (!flat.has(k)) flat.set(k, []); flat.get(k).push(v); };
      const walk = (prefix, v, depth) => {
        if (v && typeof v === 'object' && !Array.isArray(v) && depth < 3) for (const [k2, v2] of Object.entries(v)) walk(`${prefix}.${k2}`, v2, depth + 1);
        else add(prefix, v);
      };
      for (const r of rows) for (const k of Object.keys(r).filter((k) => /source/i.test(k))) walk(k, r[k], 0);
      for (const [k, vals] of flat) {
        const t = tally(vals);
        if (t.length === 1 && t[0][0] === '(empty)') continue;
        console.log(`  ${k}: ${t.length > 8 ? `${t.length} different values; top ${line(t.slice(0, 4))}` : line(t)}`);
      }
    }
  } else console.log(`\nApplicants: could not be read (HTTP ${res.status}).`);
} catch (e) { console.log(`\nApplicants: could not be read (${e.message}).`); }

// Where the applications land: live postings grouped by the day they were created. Counts only.
try {
  const since = new Date(Date.now() - 14 * 86400000).toISOString();
  const matches = [];
  let more = true, total = null;
  for (let page = 1; more && page <= 60; page++) {
    const r = await api(`matches/?created_at__gte=${encodeURIComponent(since)}&page=${page}&page_size=100`);
    if (!r.ok) { if (page === 1) throw new Error(`HTTP ${r.status}`); break; }
    const j = await r.json(); total = j.count ?? total; matches.push(...j.results); more = Boolean(j.next);
    await pause(150);
  }
  const honored = matches.every((m) => !m.created_at || Date.parse(m.created_at) >= Date.parse(since) - 1000);
  if (!honored) console.log('\nApplications by posting: Manatal ignored the date filter, so this was skipped.');
  else if (matches.length) {
    const per = new Map();
    for (const m of matches) { const id = m.job_id ?? m.job; per.set(id, (per.get(id) || 0) + 1); }
    const groups = new Map();
    for (const j of cityJobs.filter((x) => x.is_published)) {
      const d = (j.created_at || '').slice(0, 10), n = per.get(j.id) || 0;
      const g = groups.get(d) || { postings: 0, apps: 0, none: 0 };
      g.postings++; g.apps += n; if (!n) g.none++;
      groups.set(d, g);
    }
    console.log(`\nApplications in the last 14 days, by the day each live city posting was created${total && total > matches.length ? ` (covers ${matches.length} of ${total})` : ''}:`);
    for (const [d, g] of [...groups].sort()) console.log(`  ${d.slice(5)}  ${String(g.postings).padStart(3)} postings  ${String(g.apps).padStart(5)} applications  ${(g.apps / g.postings).toFixed(1).padStart(5)} per posting  ${String(g.none).padStart(3)} with none`);
    const onTemplates = templates.reduce((a, t) => a + (per.get(t.id) || 0), 0);
    if (onTemplates) console.log(`  the ${templates.length} templates (no city): ${onTemplates} applications`);
  }
} catch (e) { console.log(`\nApplications by posting: could not be read (${e.message}).`); }

console.log('\nNothing was changed.');
