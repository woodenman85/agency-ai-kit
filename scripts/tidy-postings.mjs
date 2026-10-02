#!/usr/bin/env node
// Remove the leftovers of the September rewrites.
//
//   node scripts/tidy-postings.mjs              # dry run
//   node scripts/tidy-postings.mjs --live       # apply
//
// Neither of these is a compliance breach — a full scan of all 255 postings on
// 2026-10-02 found no "commission", no "no salary", no pay figure, and an NPN
// footer on every one. They are inconsistencies left behind by successive
// passes, and they matter only because a Trust & Safety reviewer spot-checking
// three listings should find three that read identically.
//
// 1. AN ORPHANED OLD FOOTER. Two postings still carry
//      "<agency> is an independent insurance agency. Agents are independent
//       contractors."
//    as its own paragraph, immediately before the current NPN footer, which
//    opens with the same clause. add-npn-footer.mjs inserted the NPN paragraph
//    ahead of the equal-opportunity paragraph and had no reason to know an
//    older footer was already sitting there, so those two now say "is an
//    independent insurance agency" twice.
//
// 2. ONE ODD WORD. 254 postings say "1099 independent contractor position";
//    one says "role".
import { client, die, allJobs } from './manatal.mjs';

const args = process.argv.slice(2);
const LIVE = args.includes('--live');

/** The superseded footer, as its own paragraph. Matched by shape so it works for
 *  any agency name rather than only this one. */
export const ORPHAN_FOOTER =
  /<p>[^<]*is an independent insurance agency\.\s*Agents are independent contractors\.\s*<\/p>/i;

/** The current footer is identified by carrying an NPN. */
const NPN_PARAGRAPH = /<p>[^<]*\bNPN\b[^<]*<\/p>/i;

const ROLE_PHRASE = '1099 independent contractor role.';
const POSITION_PHRASE = '1099 independent contractor position.';

export function tidy(html) {
  if (!html) return { ok: false, reason: 'empty description' };
  let out = html;
  const did = [];

  // Only drop the old footer when the current one is present to replace it —
  // otherwise this would strip the agency identification entirely.
  if (ORPHAN_FOOTER.test(out) && NPN_PARAGRAPH.test(out)) {
    out = out.replace(ORPHAN_FOOTER, '');
    did.push('removed the superseded footer paragraph');
  }

  if (out.includes(ROLE_PHRASE)) {
    out = out.split(ROLE_PHRASE).join(POSITION_PHRASE);
    did.push('"role" -> "position" in the compensation line');
  }

  if (out === html) return { ok: false, reason: 'nothing to tidy' };
  return { ok: true, html: out, did };
}

/** Everything that must still be true afterwards. */
export function verify(before, after) {
  const text = (s) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const problems = [];
  const t = text(after);

  if (/commission/i.test(t)) problems.push('introduced the word "commission"');
  if (/no salary|not a salaried/i.test(t)) problems.push('introduced a no-salary phrase');
  if (!/\b1099\b/.test(t)) problems.push('lost the 1099 disclosure');
  if (!/NPN\s*\d/.test(t)) problems.push('lost the NPN attribution');
  if (!/equal opportunity/i.test(t)) problems.push('lost the equal-opportunity paragraph');
  if (!/at least 18 years old/i.test(t)) problems.push('lost the age minimum');
  if (!/authorized to work/i.test(t)) problems.push('lost the work-authorization line');
  if (/\$\s?\d|\b\d{2,3}\s?k\b/i.test(t)) problems.push('introduced something resembling a pay figure');

  // The whole point: the agency is identified exactly once.
  const identCount = (t.match(/is an independent insurance agency/gi) || []).length;
  if (identCount !== 1) problems.push(`"is an independent insurance agency" appears ${identCount} times, expected 1`);

  // Exactly how much the length should move, given the two edits this pass makes.
  // Stricter than "it must not grow" — that version rejected the rename, since
  // "position" is four characters longer than "role", and it would have let an
  // unrelated deletion through unnoticed.
  const renames = (before.split(ROLE_PHRASE).length - 1);
  const orphan = before.match(ORPHAN_FOOTER);
  const removed = orphan && NPN_PARAGRAPH.test(before) ? orphan[0].length : 0;
  const expected = before.length + renames * (POSITION_PHRASE.length - ROLE_PHRASE.length) - removed;
  if (after.length !== expected) {
    problems.push(`length is ${after.length}, expected ${expected} — something other than the intended edits changed`);
  }
  return problems;
}

const RUN_DIRECTLY = process.argv[1] && process.argv[1].endsWith('tidy-postings.mjs');
if (RUN_DIRECTLY) {
  const api = client();
  const jobs = await allJobs(api).catch(die);
  console.log(`\n${jobs.length} jobs fetched`);

  const planned = [];
  const skipped = new Map();
  for (const j of jobs) {
    const r = tidy(j.description || '');
    if (!r.ok) { skipped.set(r.reason, (skipped.get(r.reason) ?? 0) + 1); continue; }
    const problems = verify(j.description, r.html);
    if (problems.length) { skipped.set(problems.join('; '), (skipped.get(problems.join('; ')) ?? 0) + 1); continue; }
    planned.push({ job: j, html: r.html, did: r.did });
  }

  console.log(`${planned.length} to tidy, ${[...skipped.values()].reduce((a, b) => a + b, 0)} already fine/skipped`);
  for (const [reason, n] of skipped) console.log(`  ${String(n).padStart(4)}  ${reason}`);
  console.log('');
  for (const { job, did } of planned) {
    console.log(`  ${job.id}  ${job.position_name} — ${job.city}, ${job.state}`);
    for (const d of did) console.log(`          ${d}`);
  }
  console.log('');

  if (!planned.length) { console.log('Nothing to do.'); process.exit(0); }
  if (!LIVE) {
    console.log(`Dry run — nothing was sent. Add --live to apply to ${planned.length} posting(s).`);
    process.exit(0);
  }

  let ok = 0;
  const failed = [];
  for (const { job, html } of planned) {
    try {
      await api(`jobs/${job.id}/`, { method: 'PATCH', body: JSON.stringify({ description: html }) });
      // A 200 on the PATCH is not evidence the account changed. Read it back.
      const after = await (await api(`jobs/${job.id}/`)).json();
      const stored = after.description || '';
      const n = (stored.replace(/<[^>]+>/g, ' ').match(/is an independent insurance agency/gi) || []).length;
      if (n !== 1 || /1099 independent contractor role\./.test(stored)) {
        failed.push(`${job.id}: write did not stick`);
        console.log(`  FAILED   ${job.id}`);
      } else {
        ok++;
        console.log(`  VERIFIED ${job.id}  ${after.updated_at}`);
      }
    } catch (err) {
      failed.push(`${job.id}: ${err.message.split('\n')[0]}`);
      console.log(`  FAILED   ${job.id}`);
    }
    await new Promise((r) => setTimeout(r, 400));
  }

  console.log(`\n${ok} tidied and verified${failed.length ? `, ${failed.length} failed` : ''}.`);
  for (const f of failed) console.log(`  ${f}`);
  if (failed.length) process.exitCode = 1;
}
