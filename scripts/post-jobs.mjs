#!/usr/bin/env node
// Push posts.json to Manatal. Dry run unless --live. Never publishes unless --publish.
//
//   node scripts/post-jobs.mjs                    # dry run: show what would happen
//   node scripts/post-jobs.mjs --live             # create as unpublished drafts
//   node scripts/post-jobs.mjs --live --publish   # create and make public
//   node scripts/post-jobs.mjs --list             # list what's already in the account
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './env.mjs';
import { client, die, allJobs } from './manatal.mjs';

const api = client();

const args = new Set(process.argv.slice(2));
const LIVE = args.has('--live');
const PUBLISH = args.has('--publish');

if (args.has('--list')) {
  const jobs = await allJobs(api).catch(die);
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
  if (/\$\s?\d|\d{2,3}\s?k\b/i.test(d.replace(/<[^>]+>/g, ''))) problems.push(`${where}: contains what looks like a pay figure in the body copy. An earnings number in the description of a commission-only 1099 role is an income claim on the poster's license — read reference/compliance.md. There is no --force for this.`);
});
if (problems.length) {
  console.error('Refusing to send. Fix these first:\n');
  for (const p of problems) console.error('  - ' + p);
  process.exit(1);
}

// ── dedupe against what already exists ───────────────────────────────
const existing = await allJobs(api).catch(die);
const seen = new Set(existing.map((j) => `${j.position_name}|${j.city || ''}`.toLowerCase()));
const fresh = posts.filter((p) => !seen.has(`${p.title}|${p.city || ''}`.toLowerCase()));
const skipped = posts.length - fresh.length;

console.log(`${posts.length} posting(s) in posts.json`);
if (skipped) console.log(`${skipped} already exist in Manatal — skipping those`);
console.log(`${fresh.length} to create${LIVE ? (PUBLISH ? ' and PUBLISH publicly' : ' as unpublished drafts') : ''}\n`);

// ── board eligibility ────────────────────────────────────────────────
// 2026-09-01: Manatal Trust & Safety restricted this account's FREE JOB BOARD
// posting over one listing, for one reason — "Commission-only roles are not
// allowed by the job boards." The API token kept working; only the free board
// feed was pulled.
//
// That is a COMPENSATION MODEL rejection, not a wording rejection. No rewrite
// of the description fixes it, and dressing a commission-only role up as
// something else is both a misrepresentation and the fastest way to escalate a
// temporary restriction into a closed account. So this gate does not try to
// detect "bad words" — it makes the operator confirm they know where the
// posting is going. See reference/job-board-eligibility.md.
if (LIVE && PUBLISH && !args.has('--free-board-ok')) {
  console.error(`Refusing to publish ${fresh.length} commission-only posting(s) to the free job board.

Manatal restricted this account's free job board posting on 2026-09-01 because
commission-only roles are not accepted by the boards it syndicates to. Publishing
into that feed again while the restriction stands will not work, and re-tripping
Trust & Safety puts the whole account at risk.

What actually works while restricted (from Manatal's own email):
  - the Manatal Career Page
  - Job Board Connect, to receive applications back into the ATS
  - posting directly on boards that accept commission-only with disclosure

Create them as unpublished drafts instead:
    node scripts/post-jobs.mjs --live

If the restriction has been lifted and you have confirmed these are eligible,
re-run with --free-board-ok.`);
  process.exit(1);
}

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
