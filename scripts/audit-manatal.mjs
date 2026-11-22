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
import { ROOT } from './env.mjs';
import { fetchAll, pause } from './manatal.mjs';

const args = new Set(process.argv.slice(2));

// What Manatal's reviewers quoted back to us, plus the neighbouring phrasings of the same claim.
const FLAGS = [
  ['commission', /commission/i],
  ['salary / hourly / wage wording', /\b(salary|salaried|hourly|wages?)\b/i],
  ['pay figure', /\$\s?\d|\b\d{2,3}\s?k\b|\b(six|seven)[- ]figures?\b/i],
];

const text = (s) => String(s ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const snippet = (s, m) => text(s).slice(Math.max(0, m.index - 50), m.index + m[0].length + 50).trim();

const findings = []; // { where, id, title, kind, snippet }
const warnings = []; // { id, title, note }
const incomplete = [];
const notes = [];

// ── completeness first: a scan that skipped jobs proves nothing ──────────
const jobs = await fetchAll('jobs/');
if (!jobs.complete) incomplete.push(`found ${jobs.rows.length} jobs but Manatal reports ${jobs.count}, even after re-reading the list with several page sizes — ${jobs.count - jobs.rows.length} job(s) are not being returned by the list and were NOT scanned`);
const orgs = await fetchAll('organizations/');
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
// The careers page is rendered by JavaScript, so a plain fetch usually sees an empty shell. We
// probe one batch first; if none of it is readable we stop rather than hit the site 250 more times.
if (args.has('--public')) {
  const targets = jobs.rows.filter((j) => j.career_page_url);
  let readable = 0;
  let unreadable = 0;
  for (let i = 0; i < targets.length; i += 5) {
    const results = await Promise.all(targets.slice(i, i + 5).map(async (j) => {
      const label = `${j.position_name} (${j.city || 'no city'}, ${j.state || '-'})`;
      try {
        const res = await fetch(j.career_page_url, { redirect: 'follow' });
        const html = await res.text();
        // A page that doesn't contain the posting at all (client-rendered, error, bot wall) proves nothing.
        if (!res.ok || !html.includes('1099')) return false;
        for (const [kind, re] of FLAGS) {
          const m = re.exec(text(html));
          if (m) findings.push({ where: 'public page', id: j.id, title: label, kind, snippet: snippet(html, m) });
        }
        return true;
      } catch { return false; }
    }));
    readable += results.filter(Boolean).length;
    unreadable += results.filter((r) => !r).length;
    if (i === 0 && !readable) {
      notes.push('The public careers pages could not be read as text (they are rendered by JavaScript), so --public could not check what a reviewer sees. Open a listing in your browser to check it by eye.');
      break;
    }
    await pause(400);
  }
  if (readable && unreadable) incomplete.push(`${unreadable} of ${targets.length} public pages could not be read as text, so the public scan is partial`);
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
  const counts = new Map();
  for (const w of warnings) counts.set(w.note, (counts.get(w.note) || 0) + 1);
  console.log('Worth a look (not Manatal\'s stated reason, but wrong for a 1099 posting):');
  for (const [n, c] of counts) console.log(`    ${String(c).padStart(4)}  ${n}`);
  console.log();
}
for (const n of notes) console.log(`NOTE  ${n}\n`);
for (const i of incomplete) console.log(`INCOMPLETE  ${i}`);

if (args.has('--json')) {
  fs.writeFileSync(path.join(ROOT, 'manatal-audit.json'), JSON.stringify({ at: new Date().toISOString(), jobs: jobs.rows.length, findings, warnings, incomplete }, null, 2));
  console.log('Wrote manatal-audit.json');
}

const flaggedJobs = new Set(findings.filter((f) => !f.where.startsWith('organization')).map((f) => f.id)).size;
console.log(`\nRESULT: ${findings.length} finding(s) across ${flaggedJobs} job(s)${findings.some((f) => f.where.startsWith('organization')) ? ' and the company profile' : ''}; ${incomplete.length ? 'scan INCOMPLETE' : 'scan complete'}.`);
console.log('A clean result means the wording Manatal quoted is gone. It does not mean Manatal considers a');
console.log('production-based 1099 role eligible for the free job boards — only Manatal can say that.');
process.exit(incomplete.length ? 2 : findings.length ? 1 : 0);
