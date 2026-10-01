#!/usr/bin/env node
// Emit the applicants at a pipeline stage as JSON, for render-outreach.mjs.
//
//   node scripts/list-applicants.mjs > applicants.json
//   node scripts/list-applicants.mjs --stage "Shortlisted" > shortlist.json
//   node scripts/list-applicants.mjs --exclude someone@example.com
//   node scripts/list-applicants.mjs --stage-id 2088185      # skip the name lookup
//
// Read-only. Writes JSON to stdout and everything else to stderr, so it can be
// redirected straight into a file.
//
// Dropped and inactive matches are excluded. On 2026-10-01 the New Candidates
// stage held 39 matches, three of which had been dispositioned as not qualified
// — emailing those three an invitation to book a call would have been the kind
// of mistake that is only visible after it has already happened.
import { client, die } from './manatal.mjs';

const args = process.argv.slice(2);
const valueOf = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const allOf = (f) => args.reduce((acc, a, i) => (a === f && args[i + 1] ? [...acc, args[i + 1]] : acc), []);

const STAGE = valueOf('--stage') || 'New Candidates';
/** Bypass the stage-name lookup. The lookup hits match-stages/, and that path
 *  was written without being able to reach the API from the authoring
 *  environment — if it 404s, this flag is the way round it rather than editing
 *  the script. For this account on 2026-10-01: New Candidates = 2088185,
 *  Shortlisted = 2088186, Submitted = 2088187. */
const STAGE_ID = valueOf('--stage-id');
const EXCLUDE = new Set(allOf('--exclude').map((e) => e.toLowerCase()));

const api = client();

async function collect(pathname, params = {}, cap = 2000) {
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

/** Resolve the stage name to its id rather than hardcoding one. Stage ids are
 *  per-account, so a literal would work here and silently return nothing in any
 *  other agency's account. */
async function stageId(name) {
  let stages;
  try {
    stages = await collect('match-stages/');
  } catch (err) {
    throw new Error(
      `Could not list pipeline stages (${err.message.split('\n')[0]}).\n\n` +
      'If that is a 404 the endpoint path is wrong. Pass the stage id directly instead:\n' +
      '  node scripts/list-applicants.mjs --stage-id 2088185\n' +
      '(2088185 is "New Candidates" in this account.)');
  }
  const hit = stages.find((s) => (s.name || '').toLowerCase() === name.toLowerCase());
  if (!hit) {
    throw new Error(`No pipeline stage named "${name}". Stages in this account: ` +
      stages.map((s) => `"${s.name}"`).join(', '));
  }
  return hit.id;
}

let out;
try {
  const id = STAGE_ID || (await stageId(STAGE));
  const matches = await collect('matches/', { job_pipeline_stage__match_stage__in: String(id) });

  const live = matches.filter((m) => m.is_active && m.dropped_at == null);
  const dropped = matches.length - live.length;

  out = live
    .map((m) => {
      const c = m.candidate || {};
      return {
        cid: m.candidate_id ?? c.id,
        job: m.job_id,
        name: c.full_name || [c.first_name, c.last_name].filter(Boolean).join(' '),
        email: c.email || '',
        phone: c.phone_number || '',
        city: c.city || '',
        state: c.state || '',
        country: c.country || '',
        consent: c.consent === true,
        applied: m.created_at,
      };
    })
    .filter((p) => {
      if (!p.email) { console.error(`  no email on file, excluded: ${p.name}`); return false; }
      if (EXCLUDE.has(p.email.toLowerCase())) { console.error(`  excluded by --exclude: ${p.email}`); return false; }
      return true;
    });

  console.error(`\nStage ${STAGE_ID ? `id ${STAGE_ID}` : `"${STAGE}"`}: ${matches.length} match(es), ` +
    `${dropped} dropped/inactive, ${out.length} to contact`);
  const noConsent = out.filter((p) => !p.consent);
  if (noConsent.length) {
    console.error(`WARNING: ${noConsent.length} have consent=false on their record. ` +
      'Check how they applied before emailing them:');
    for (const p of noConsent) console.error(`  ${p.name} <${p.email}>`);
  }
} catch (err) {
  die(err);
}

process.stdout.write(JSON.stringify(out, null, 2) + '\n');
