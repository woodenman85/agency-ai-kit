#!/usr/bin/env node
// Repair specific postings by id, bypassing the job listing entirely.
//
//   node scripts/fix-job-by-id.mjs 4438466              # dry run
//   node scripts/fix-job-by-id.mjs 4438466 --live       # apply
//   node scripts/fix-job-by-id.mjs 4438466 --live --drop-no-salary
//
// WHY THIS EXISTS. scrub-commission.mjs finds its work through allJobs(), and
// allJobs() has to fight Manatal's pagination to build a complete set. When a
// single posting will not change, there are three places the run can lose it
// before any rule is applied: a page that never returned the row, a --only
// filter that did not match the position name, or a clone that predates the
// rule. None of them produce an error — the run reports success and the posting
// stays broken, which is exactly what happened to job 4438466 across three runs.
//
// GET /jobs/{id}/ has no pages and no filter. If a posting is named explicitly
// it is fetched, scrubbed, written, and then RE-READ from the API so the result
// is proven against the account rather than inferred from a 200.
import { client, die } from './manatal.mjs';
import { scrub, verify } from './scrub-commission.mjs';

const args = process.argv.slice(2);
const LIVE = args.includes('--live');
const DROP_NO_SALARY = args.includes('--drop-no-salary');
const ids = args.filter((a) => /^\d+$/.test(a)).map(Number);

if (!ids.length && process.argv[1] && process.argv[1].endsWith('fix-job-by-id.mjs')) {
  console.error('Usage: node scripts/fix-job-by-id.mjs <job-id> [more ids…] [--live] [--drop-no-salary]');
  process.exit(2);
}

/** The sentences that must not survive anywhere in a posting. Checked against
 *  what the API returns after the write, not against what we sent. */
const BANNED = [
  [/commission/i, 'the word "commission"'],
  [/No salary or hourly pay is provided/i, '"No salary or hourly pay is provided"'],
];

const text = (s) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

/** Sentence-level diff — enough to see what a rule did without printing 3kb of HTML. */
function changedSentences(before, after) {
  const split = (s) => text(s).split(/(?<=\.)\s+/);
  const b = split(before);
  const a = split(after);
  const removed = b.filter((s) => !a.includes(s));
  const added = a.filter((s) => !b.includes(s));
  return { removed, added };
}

/** Fetch one posting, scrub it, optionally write it, and re-read to prove the
 *  result. Returns what happened so the caller decides how loudly to say it.
 *  Takes the api so a test can drive it without a key or a network. */
export async function fixJob(api, id, { live = false, dropNoSalary = false, log = console.log } = {}) {
  const job = await (await api(`jobs/${id}/`)).json();
  log(`"${job.position_name}" — ${job.city || '?'}, ${job.state || '?'}`);
  log(`last updated ${job.updated_at}`);

  const before = job.description || '';
  const banned = BANNED.filter(([re]) => re.test(before)).map(([, label]) => label);
  if (banned.length) log(`DEFECTIVE — still carries ${banned.join(' and ')}`);
  else log('already clean on both banned phrases');

  const r = scrub(before, { dropNoSalary });
  if (!r.ok) {
    log(`scrub() has nothing to do: ${r.reason}`);
    // Defective with no rule to match it is the one case that must not pass
    // quietly — it means the corpus has a shape the rules do not cover.
    return { defective: banned.length > 0, written: false,
      unresolved: banned.length ? 'defective but no rule matches — needs a new rule' : null };
  }

  const problems = verify(before, r.html, { dropNoSalary });
  const { removed, added } = changedSentences(before, r.html);
  for (const line of removed) log(`  - ${line}`);
  for (const line of added) log(`  + ${line}`);

  if (problems.length) {
    log(`REFUSING to write — verify() objected: ${problems.join('; ')}`);
    return { defective: banned.length > 0, written: false, unresolved: problems.join('; ') };
  }

  if (!live) {
    log('dry run — add --live to apply');
    return { defective: banned.length > 0, written: false, unresolved: null };
  }

  await api(`jobs/${id}/`, { method: 'PATCH', body: JSON.stringify({ description: r.html }) });

  // Prove it against the account. A 200 on the PATCH is not proof that the
  // stored description is what we sent — three runs already reported success
  // on a posting that never changed.
  const after = await (await api(`jobs/${id}/`)).json();
  const stored = after.description || '';
  const stillWrong = BANNED.filter(([re]) => re.test(stored)).map(([, label]) => label);
  const comp = stored.match(/<h3>Compensation<\/h3>\s*<p>(.*?)<\/p>/is);
  log(`  re-read: updated ${after.updated_at}`);
  log(`  live Compensation now: ${comp ? comp[1] : '(no Compensation block)'}`);
  if (stillWrong.length) {
    log(`  WRITE DID NOT STICK — the API still returns ${stillWrong.join(' and ')}`);
    return { defective: banned.length > 0, written: false, unresolved: 'write did not stick' };
  }
  log('  VERIFIED CLEAN against the API');
  return { defective: banned.length > 0, written: true, unresolved: null };
}

const RUN_DIRECTLY = process.argv[1] && process.argv[1].endsWith('fix-job-by-id.mjs');
if (RUN_DIRECTLY) {
  const api = client();
  let defective = 0;
  let written = 0;
  const unresolved = [];

  for (const id of ids) {
    console.log(`\n=== job ${id} ===`);
    let r;
    try {
      r = await fixJob(api, id, { live: LIVE, dropNoSalary: DROP_NO_SALARY });
    } catch (err) {
      die(err);
    }
    if (r.defective) defective++;
    if (r.written) written++;
    if (r.unresolved) unresolved.push(`${id}: ${r.unresolved}`);
  }

  console.log(`\n${ids.length} job(s) checked, ${defective} defective, ${written} written and verified.`);
  if (unresolved.length) {
    console.log('\nSTILL UNRESOLVED:');
    for (const u of unresolved) console.log(`  ${u}`);
    process.exitCode = 1;
  } else if (LIVE) {
    console.log('Nothing left outstanding on the ids given.');
  }
}
