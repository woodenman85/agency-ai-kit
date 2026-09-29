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

// ── delivery mode ────────────────────────────────────────────────────
// GoHighLevel's Inbound Webhook is a PREMIUM trigger: $0.01 per execution,
// with 100 free executions per sub-account, ever. At the observed rate of ~39
// applicants a day that allowance is gone in under three days and the steady
// cost is roughly $12/month — for moving a contact the API moves for nothing.
//
// The Contacts API has no per-execution charge. Writing the contact directly
// and tagging it lets a "Contact Tag" workflow trigger — a STANDARD trigger,
// not billed — start the recruiting sequence. Same result, same speed, no
// meter. So that is the default, and the webhook stays available because it
// needs no API key and is easier to stand up in a hurry.
const MODE = (valueOf('--via') || 'api').toLowerCase();
if (!['api', 'webhook'].includes(MODE)) {
  console.error(`Unknown --via ${MODE}. Use "api" (default, free) or "webhook" (premium, $0.01 each).`);
  process.exit(1);
}

const GHL_API = 'https://services.leadconnectorhq.com';
const TAG = 'manatal-applicant';

let webhook = null;
let ghlToken = null;
let ghlLocation = null;

if (LIVE && MODE === 'webhook') {
  webhook = getKey('GHL_APPLICANT_WEBHOOK_URL');
  if (!webhook) {
    console.error(
      'GHL_APPLICANT_WEBHOOK_URL is not set.\n\n' +
        'In GoHighLevel: Automation -> Workflows -> create a workflow -> add the\n' +
        '"Inbound Webhook" trigger -> copy the URL it gives you. Then:\n\n' +
        '  node scripts/credentials.mjs set GHL_APPLICANT_WEBHOOK_URL\n\n' +
        'Note: that trigger bills $0.01 per applicant. --via api costs nothing.',
    );
    process.exit(1);
  }
}

if (LIVE && MODE === 'api') {
  ghlToken = getKey('GHL_API_KEY');
  ghlLocation = getKey('GHL_LOCATION_ID');
  if (!ghlToken || !ghlLocation) {
    console.error(
      `${!ghlToken ? 'GHL_API_KEY' : 'GHL_LOCATION_ID'} is not set.\n\n` +
        'In GoHighLevel: Settings -> Private Integrations -> create one with the\n' +
        'contacts.write and contacts.readonly scopes. The token starts with "pit-".\n' +
        'The Location ID is in Settings -> Business Profile (also in the browser URL).\n\n' +
        '  node scripts/credentials.mjs set GHL_API_KEY\n' +
        '  node scripts/credentials.mjs set GHL_LOCATION_ID\n',
    );
    process.exit(1);
  }
}

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

/** A tag GoHighLevel can trigger a workflow on. Slugged because GHL tags are
 *  lowercased and matched literally — "Work-From-Home Client Advisor" and
 *  "work-from-home client advisor" are two different tags to a trigger. */
const slug = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

/** The Contacts API body. `upsert` rather than `create` so re-running cannot
 *  produce duplicates — GHL matches on email/phone within the location. */
const contactFor = (c) => {
  const job = jobTitleByCandidate.get(c.id) || '';
  const [city, stateName] = (c.candidate_location || '').split(',').map((x) => x && x.trim());
  return {
    locationId: ghlLocation,
    firstName: (c.full_name || '').split(' ')[0] || '',
    lastName: (c.full_name || '').split(' ').slice(1).join(' '),
    name: c.full_name || '',
    ...(c.email ? { email: c.email } : {}),
    ...(c.phone_number ? { phone: c.phone_number } : {}),
    ...(city ? { city } : {}),
    ...(stateName ? { state: stateName } : {}),
    ...(c.zipcode ? { postalCode: c.zipcode } : {}),
    source: job ? `Manatal — ${job}` : 'Manatal',
    tags: [TAG, ...(job ? [`job-${slug(job)}`] : [])],
  };
};

async function sendViaApi(c) {
  const res = await fetch(`${GHL_API}/contacts/upsert`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ghlToken}`,
      Version: '2021-07-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(contactFor(c)),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

async function sendViaWebhook(c) {
  const res = await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payloadFor(c)),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return null;
}

if (!LIVE) {
  console.log(`Mode: ${MODE}${MODE === 'api' ? '  (Contacts API — no per-contact charge)' : `  (Inbound Webhook — $0.01 x ${fresh.length} = $${(fresh.length * 0.01).toFixed(2)})`}\n`);
  for (const c of fresh.slice(0, 5)) {
    console.log(JSON.stringify(MODE === 'api' ? contactFor(c) : payloadFor(c), null, 2));
    console.log('');
  }
  if (fresh.length > 5) console.log(`…and ${fresh.length - 5} more\n`);
  console.log('Dry run — nothing was sent. Add --live to send.');
  process.exit(0);
}

// ── send ─────────────────────────────────────────────────────────────
console.log(`Mode: ${MODE}\n`);
let ok = 0;
const failed = [];
for (const c of fresh) {
  try {
    await (MODE === 'api' ? sendViaApi(c) : sendViaWebhook(c));
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
