#!/usr/bin/env node
// Push new Manatal applicants into a GoHighLevel inbound webhook.
//
//   node scripts/sync-applicants.mjs                  # dry run — show what would send
//   node scripts/sync-applicants.mjs --live           # actually send
//   node scripts/sync-applicants.mjs --since 2026-09-28 --live   # backfill from a date
//   node scripts/sync-applicants.mjs --all --live     # backfill everything (first run)
//   node scripts/sync-applicants.mjs --reset          # forget what was sent
//
// Manatal has NO outbound webhooks (reference/manatal-api.md) and no GoHighLevel
// integration — their support confirmed that on 2026-08-28. So nothing can push
// to us and this has to pull. It asks Manatal for candidates created since the
// last successful run, which their API supports directly via created_at__gte, so
// a run is cheap no matter how many candidates exist in total.
//
// The candidate record does NOT carry the job it applied to. That link lives on
// a separate "match" object (candidate_id + job_id), which is why a job title
// needs a second lookup. Confirmed against live data 2026-09-28.
//
// WHAT THIS DOES NOT DO: send anything to a candidate. It hands GoHighLevel a
// contact and lets the workflow there decide. Keeping the messaging decision in
// GHL — where the agency can see and edit it — rather than burying it in a
// script is deliberate.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, getKey } from './env.mjs';
import { client, die } from './manatal.mjs';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const valueOf = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };

const LIVE = has('--live');
const ALL = has('--all');
const SINCE = valueOf('--since');

const STATE_PATH = path.join(ROOT, '.applicant-sync-state.json');
const readState = () => {
  try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); } catch { return { sentIds: [] }; }
};
const writeState = (s) => fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 2));

if (has('--reset')) {
  fs.rmSync(STATE_PATH, { force: true });
  console.log('Sync state cleared. The next --live run will re-send everything it finds.');
  process.exit(0);
}

const state = readState();

// The webhook URL is a credential: anyone holding it can inject contacts into
// the CRM, so it belongs with the keys, not in a committed file.
const webhook = LIVE
  ? getKey('GHL_APPLICANT_WEBHOOK_URL') ||
    (console.error(
      'GHL_APPLICANT_WEBHOOK_URL is not set.\n\n' +
        'In GoHighLevel: Automation -> Workflows -> create a workflow -> add the\n' +
        '"Inbound Webhook" trigger -> copy the URL it gives you. Then:\n\n' +
        '  node scripts/credentials.mjs set GHL_APPLICANT_WEBHOOK_URL\n',
    ), process.exit(1))
  : null;

const api = client();

/** Walk a paginated Manatal collection. */
async function collect(pathname, params = {}, cap = 1000) {
  const out = [];
  for (let page = 1; out.length < cap; page++) {
    const qs = new URLSearchParams({ ...params, page: String(page), page_size: '50' });
    const j = await (await api(`${pathname}?${qs}`)).json();
    if (!Array.isArray(j.results)) break;
    out.push(...j.results);
    if (!j.next) break;
  }
  return out;
}

// ── window ───────────────────────────────────────────────────────────
// A dry run deliberately ignores the saved cursor: the point of a dry run is to
// see what a send WOULD do, and silently showing nothing because the last live
// run already advanced the cursor is the opposite of informative.
const since = ALL ? null : (SINCE || (LIVE ? state.lastCreatedAt : null) || null);
const filter = since ? { created_at__gte: since } : {};

console.log(since ? `Looking for candidates created since ${since}` : 'Looking at ALL candidates');

let candidates;
try {
  candidates = await collect('candidates/', filter);
} catch (err) {
  die(err);
}

// ── job titles come from the match object, not the candidate ─────────
const jobTitleByCandidate = new Map();
try {
  const matches = await collect('matches/', filter);
  const jobs = await collect('jobs/', {});
  const titleById = new Map(jobs.map((j) => [j.id, j.position_name]));
  for (const m of matches) {
    const cid = m.candidate_id ?? m.candidate?.id;
    if (cid != null && m.job_id != null) jobTitleByCandidate.set(cid, titleById.get(m.job_id) ?? `job ${m.job_id}`);
  }
} catch {
  // Not fatal. An applicant with no job title attached is still an applicant,
  // and losing the whole sync over a missing label would be the wrong trade.
  console.log('(could not read matches — sending without job titles)');
}

const sent = new Set(state.sentIds ?? []);
const fresh = candidates.filter((c) => !sent.has(c.id));
const skipped = candidates.length - fresh.length;

console.log(`${candidates.length} candidate(s) found${skipped ? `, ${skipped} already sent` : ''}`);
console.log(`${fresh.length} to send\n`);

if (!fresh.length) {
  console.log('Nothing new.');
  process.exit(0);
}

/** What GoHighLevel receives. Flat, because GHL's workflow field mapper reads
 *  top-level keys far more comfortably than nested ones. */
const payloadFor = (c) => ({
  first_name: (c.full_name || '').split(' ')[0] || '',
  last_name: (c.full_name || '').split(' ').slice(1).join(' '),
  full_name: c.full_name || '',
  email: c.email || '',
  phone: c.phone_number || '',
  city_state: c.candidate_location || c.address || '',
  postal_code: c.zipcode || '',
  job_applied_for: jobTitleByCandidate.get(c.id) || '',
  current_position: c.current_position || '',
  current_company: c.current_company || '',
  source: 'Manatal',
  source_channel: c.source_details?.channel || '',
  source_portal: c.source_details?.portal?.display_name || '',
  applied_at: c.created_at || '',
  consent: c.consent === true,
  consent_date: c.consent_date || '',
  // Signed and time-limited by Manatal — pull it down promptly rather than
  // storing the link and expecting it to work next month.
  resume_url: c.resume || '',
  manatal_candidate_id: c.id,
});

if (!LIVE) {
  for (const c of fresh.slice(0, 5)) {
    console.log(JSON.stringify(payloadFor(c), null, 2));
    console.log('');
  }
  if (fresh.length > 5) console.log(`…and ${fresh.length - 5} more\n`);
  console.log('Dry run — nothing was sent. Add --live to send.');
  process.exit(0);
}

// ── send ─────────────────────────────────────────────────────────────
let ok = 0;
const failed = [];
for (const c of fresh) {
  try {
    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payloadFor(c)),
    });
    if (!res.ok) { failed.push(`${c.full_name}: HTTP ${res.status}`); continue; }
    ok++;
    sent.add(c.id);
    console.log(`  sent  ${c.full_name}${jobTitleByCandidate.get(c.id) ? `  (${jobTitleByCandidate.get(c.id)})` : ''}`);
  } catch (err) {
    failed.push(`${c.full_name}: ${err.message}`);
  }
  // GoHighLevel rate-limits inbound webhooks; a backfill of a few hundred
  // should not look like an attack.
  await new Promise((r) => setTimeout(r, 350));
}

// Advance the cursor only over candidates that actually made it. A partial
// failure must not skip anyone on the next run, so the cursor moves to the
// newest SENT record, not the newest record seen.
const newestSent = fresh.filter((c) => sent.has(c.id)).map((c) => c.created_at).filter(Boolean).sort().pop();
writeState({
  lastRun: new Date().toISOString(),
  lastCreatedAt: newestSent || state.lastCreatedAt || null,
  sentIds: [...sent].slice(-5000),
});

console.log(`\n${ok} sent${failed.length ? `, ${failed.length} failed` : ''}.`);
for (const f of failed) console.log(`  FAILED  ${f}`);
if (failed.length) process.exitCode = 1;
