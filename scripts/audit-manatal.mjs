#!/usr/bin/env node
// Read-only audit of a Manatal account against the wording Manatal's Trust & Safety team flags.
// Scans every job AND the organization profile (the "about us" text shown beside every listing,
// which is easy to forget because it is not part of any job). Writes nothing to Manatal.
//
//   node scripts/audit-manatal.mjs             # scan what the API returns
//   node scripts/audit-manatal.mjs --public    # also scan each listing's public careers-page HTML,
//                                              # which is what a reviewer actually sees
//   node scripts/audit-manatal.mjs --json      # also write manatal-audit.json (ids per finding)
//
// Exit code: 0 clean, 1 something flagged, 2 the scan was incomplete (a "clean" can't be trusted).
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, requireKey } from './env.mjs';

const key = requireKey('MANATAL_API_KEY', 'Get the key in Manatal: Settings -> Integrations -> Open API. It is account-wide, so treat it like a password.');
const BASE = process.env.MANATAL_API_BASE || 'https://api.manatal.com/open/v3/';
const args = new Set(process.argv.slice(2));

const api = (p) => fetch(`${BASE}${p}`, { headers: { Authorization: `Token ${key}` } });

// What Manatal's reviewers quoted back to us, plus the neighbouring phrasings of the same claim.
const FLAGS = [
  ['commission', /commission/i],
  ['salary / hourly / wage wording', /\b(salary|salaried|hourly|wages?)\b/i],
  ['pay figure', /\$\s?\d|\b\d{2,3}\s?k\b|\b(six|seven)[- ]figures?\b/i],
];

const text = (s) => String(s ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const snippet = (s, m) => text(s).slice(Math.max(0, m.index - 50), m.index + m[0].length + 50).trim();

/** Every page of a list endpoint. offset/limit are silently ignored by Manatal; page/page_size are not. */
async function pageAll(p) {
  const rows = [];
  let count = null;
  for (let page = 1; ; page++) {
    const res = await api(`${p}?page=${page}&page_size=50`);
    if (!res.ok) throw new Error(`GET ${p} page ${page}: HTTP ${res.status}`);
    const j = await res.json();
    count = j.count ?? count;
    rows.push(...j.results);
    if (!j.next) break;
  }
  const byId = new Map(rows.map((r) => [r.id, r]));
  return { rows: [...byId.values()], count };
}

const findings = []; // { where, id, title, kind, snippet }
const warnings = []; // { id, title, note }
const incomplete = [];

// ── completeness first: a scan that skipped jobs proves nothing ──────────
const jobs = await pageAll('jobs/');
if (jobs.count != null && jobs.rows.length !== jobs.count) incomplete.push(`fetched ${jobs.rows.length} jobs but Manatal reports ${jobs.count}`);
const orgs = await pageAll('organizations/');
if (!orgs.rows.length) incomplete.push('no organization returned, so the company profile was not scanned');

// ── organization profile ─────────────────────────────────────────────────
for (const o of orgs.rows) {
  for (const [kind, re] of FLAGS) {
    const m = re.exec(text(o.description));
    if (m) findings.push({ where: `organization profile "${o.name}"`, id: o.id, title: 'company description', kind, snippet: snippet(o.description, m) });
  }
}

// ── jobs ─────────────────────────────────────────────────────────────────
for (const j of jobs.rows) {
  const custom = Object.keys(j.custom_fields || {}).length ? JSON.stringify(j.custom_fields) : '';
  const blob = `${j.position_name}\n${j.description}\n${custom}`;
  const label = `${j.position_name} (${j.city || 'no city'}, ${j.state || '-'})`;
  for (const [kind, re] of FLAGS) {
    const m = re.exec(text(blob));
    if (m) findings.push({ where: 'job', id: j.id, title: label, kind, snippet: snippet(blob, m) });
  }
  if (j.salary_min != null || j.salary_max != null) findings.push({ where: 'job', id: j.id, title: label, kind: 'salary field populated', snippet: `salary_min=${j.salary_min} salary_max=${j.salary_max}` });
  if (!/1099/.test(j.description || '')) warnings.push({ id: j.id, title: label, note: 'never says 1099' });
  if (!/NPN/i.test(j.description || '')) warnings.push({ id: j.id, title: label, note: 'no agency identification / NPN' });
  if (j.contract_details && j.contract_details !== 'contractor') warnings.push({ id: j.id, title: label, note: `contract_details is "${j.contract_details}", not "contractor" — boards will show a 1099 role as ${j.contract_details}` });
}

// ── what the public page shows (optional) ────────────────────────────────
if (args.has('--public')) {
  const targets = jobs.rows.filter((j) => j.career_page_url);
  let unreadable = 0;
  for (let i = 0; i < targets.length; i += 5) {
    await Promise.all(targets.slice(i, i + 5).map(async (j) => {
      const label = `${j.position_name} (${j.city || 'no city'}, ${j.state || '-'})`;
      try {
        const res = await fetch(j.career_page_url, { redirect: 'follow' });
        const html = await res.text();
        // A page that doesn't contain the posting at all (client-rendered, error, bot wall) proves nothing.
        if (!res.ok || !html.includes('1099')) { unreadable++; return; }
        for (const [kind, re] of FLAGS) {
          const m = re.exec(text(html));
          if (m) findings.push({ where: 'public page', id: j.id, title: label, kind, snippet: snippet(html, m) });
        }
      } catch { unreadable++; }
    }));
    await new Promise((r) => setTimeout(r, 400));
  }
  if (unreadable) incomplete.push(`${unreadable} of ${targets.length} public pages could not be read as text (client-rendered or blocked), so the public scan is partial`);
}

// ── report ───────────────────────────────────────────────────────────────
const published = jobs.rows.filter((j) => j.is_published).length;
console.log(`${jobs.rows.length} jobs (${published} published), ${orgs.rows.length} organization profile(s) scanned.\n`);

const byKind = new Map();
for (const f of findings) byKind.set(`${f.where} — ${f.kind}`, [...(byKind.get(`${f.where} — ${f.kind}`) || []), f]);
if (!findings.length) console.log('No flagged wording found.\n');
for (const [label, list] of byKind) {
  console.log(`FLAGGED  ${label}: ${list.length}`);
  for (const f of list.slice(0, 10)) console.log(`    ${String(f.id).padEnd(9)} ${f.title}\n              …${f.snippet}…`);
  if (list.length > 10) console.log(`    …and ${list.length - 10} more (use --json for every id)`);
  console.log();
}
if (warnings.length) {
  const notes = new Map();
  for (const w of warnings) notes.set(w.note, (notes.get(w.note) || 0) + 1);
  console.log('Worth a look (not Manatal\'s stated reason, but wrong for a 1099 posting):');
  for (const [n, c] of notes) console.log(`    ${String(c).padStart(4)}  ${n}`);
  console.log();
}
for (const i of incomplete) console.log(`INCOMPLETE  ${i}`);

if (args.has('--json')) {
  fs.writeFileSync(path.join(ROOT, 'manatal-audit.json'), JSON.stringify({ at: new Date().toISOString(), jobs: jobs.rows.length, findings, warnings, incomplete }, null, 2));
  console.log('Wrote manatal-audit.json');
}

console.log('A clean result means the wording Manatal quoted is gone. It does not mean Manatal considers a');
console.log('production-based 1099 role eligible for the free job boards — only Manatal can say that.');
process.exit(incomplete.length ? 2 : findings.length ? 1 : 0);
