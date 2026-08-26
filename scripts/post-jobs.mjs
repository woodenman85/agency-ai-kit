#!/usr/bin/env node
// Push posts.json to Manatal. Dry run unless --live. Never publishes unless --publish.
//
//   node scripts/post-jobs.mjs                    # dry run: show what would happen
//   node scripts/post-jobs.mjs --live             # create as unpublished drafts
//   node scripts/post-jobs.mjs --live --publish   # create and make public
//   node scripts/post-jobs.mjs --list             # list what's already in the account
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, requireKey } from './env.mjs';

const key = requireKey('MANATAL_API_KEY', 'Get the key in Manatal: Settings -> Integrations -> Open API. It is account-wide, so treat it like a password.');

const args = new Set(process.argv.slice(2));
const LIVE = args.has('--live');
const PUBLISH = args.has('--publish');

const api = (p, init = {}) => fetch(`https://api.manatal.com/open/v3/${p}`, {
  ...init,
  headers: { Authorization: `Token ${key}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
});

async function allJobs() {
  const out = [];
  for (let page = 1; ; page++) {
    const res = await api(`jobs/?page=${page}&page_size=50`);
    if (!res.ok) throw new Error(`list jobs failed: HTTP ${res.status}`);
    const j = await res.json();
    out.push(...j.results);
    if (!j.next) return out;
  }
}

if (args.has('--list')) {
  const jobs = await allJobs();
  console.log(`${jobs.count ?? jobs.length} jobs\n`);
  for (const j of jobs) {
    console.log(`${String(j.id).padEnd(9)} ${j.is_published ? 'LIVE ' : 'draft'} ${(j.city || '-') + ', ' + (j.state || '-')}`.padEnd(45) + j.position_name);
    console.log(`          ${j.career_page_url}`);
  }
  process.exit(0);
}

// ── config + posts ───────────────────────────────────────────────────
const cfgPath = path.join(ROOT, 'config/agency.json');
if (!fs.existsSync(cfgPath)) { console.error('config/agency.json is missing. Copy config/agency.example.json and fill it in.'); process.exit(1); }
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
const orgId = cfg.manatal_organization_id || cfg.organization_id;
if (!orgId) { console.error('manatal_organization_id is not set in config/agency.json. Run: node scripts/check-manatal.mjs to look it up.'); process.exit(1); }

const postsPath = path.join(ROOT, 'posts.json');
if (!fs.existsSync(postsPath)) { console.error('posts.json is missing. Write the postings first.'); process.exit(1); }
const posts = JSON.parse(fs.readFileSync(postsPath, 'utf8'));

// ── guard rails: refuse to send a posting that fails the basics ──────
const problems = [];
posts.forEach((p, i) => {
  const where = `posts.json[${i}] "${p.title || '(no title)'}"`;
  if (!p.title || !p.description) problems.push(`${where}: needs both title and description`);
  if (!p.description) return;
  const d = p.description;
  if (!d.includes('1099')) problems.push(`${where}: description never says 1099`);
  if (!/commission/i.test(d)) problems.push(`${where}: no commission word — a board validator will reject it`);
  if (!/NPN/i.test(d)) problems.push(`${where}: compliance footer is missing`);
  if (!d.includes('<h3>')) problems.push(`${where}: no <h3> sections — see reference/writing-standard.md`);
  if (p.city && new RegExp(p.city, 'i').test(p.title)) problems.push(`${where}: city belongs in the city field, not the title`);
  if (/\$\s?\d|\d{2,3}\s?k\b/i.test(d.replace(/<[^>]+>/g, ''))) problems.push(`${where}: contains what looks like a pay figure — read reference/compliance.md`);
});
if (problems.length) {
  console.error('Refusing to send. Fix these first:\n');
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}

// ── dedupe against what already exists ───────────────────────────────
const existing = await allJobs();
const seen = new Set(existing.map((j) => `${j.position_name}|${j.city || ''}`.toLowerCase()));
const fresh = posts.filter((p) => !seen.has(`${p.title}|${p.city || ''}`.toLowerCase()));
const skipped = posts.length - fresh.length;

console.log(`${posts.length} posting(s) in posts.json`);
if (skipped) console.log(`${skipped} already exist in Manatal — skipping those`);
console.log(`${fresh.length} to create${LIVE ? (PUBLISH ? ' and PUBLISH publicly' : ' as unpublished drafts') : ''}\n`);

if (!LIVE) {
  for (const p of fresh) console.log(`  would create: ${p.title}  (${p.city || 'no city'}, ${p.state || '-'})`);
  console.log('\nDry run — nothing was sent. Add --live to create drafts, --live --publish to go public.');
  process.exit(0);
}

// ── send, in small batches ───────────────────────────────────────────
const created = [];
for (let i = 0; i < fresh.length; i += 5) {
  const batch = fresh.slice(i, i + 5);
  const results = await Promise.all(batch.map(async (p) => {
    const res = await api('jobs/', {
      method: 'POST',
      body: JSON.stringify({
        organization: orgId,
        position_name: p.title,
        description: p.description,
        city: p.city || '',
        state: p.state || '',
        country: p.country || 'United States',
        is_remote: p.is_remote !== false,
        is_published: PUBLISH,
        contract_details: p.contract_details || 'full_time',
        currency: 'USD',
        headcount: p.headcount || 1,
      }),
    });
    if (!res.ok) return { error: `HTTP ${res.status} ${await res.text()}`, title: p.title };
    return await res.json();
  }));
  for (const r of results) {
    if (r.error) console.log(`  FAILED  ${r.title}: ${r.error}`);
    else { created.push(r); console.log(`  ok      ${r.position_name} -> ${r.career_page_url}`); }
  }
  if (i + 5 < fresh.length) await new Promise((r) => setTimeout(r, 1200));
}

console.log(`\n${created.length} created${PUBLISH ? ' and live' : ' as drafts (publish them in Manatal or re-run with --publish)'}.`);
if (created.length) fs.writeFileSync(path.join(ROOT, 'last-run.json'), JSON.stringify(created.map((j) => ({ id: j.id, title: j.position_name, url: j.career_page_url })), null, 2));
