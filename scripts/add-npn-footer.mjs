#!/usr/bin/env node
// Add the agency's NPN attribution paragraph to postings that are missing it.
//
//   node scripts/add-npn-footer.mjs          # dry run
//   node scripts/add-npn-footer.mjs --live   # apply
//
// reference/compliance.md requires the footer on every description. On
// 2026-09-29 only 30 of 255 live postings carried it. That is producer
// identification on regulated advertising, so it matters more for the licence
// on the copy than for any job board's filter.
//
// THE FOOTER IS NOT WRITTEN HERE. It is read from the postings that already
// have one, and copied verbatim to the ones that do not. An NPN, an agency name
// and a phone number are agency facts, and CLAUDE.md is explicit that those are
// never invented — deriving them from the account's own live copy means this
// script cannot fabricate one, and it works for any agency without being edited.
//
// Note what is deliberately NOT used: the footer template written out in
// compliance.md. That template says "compensated by commission; this position
// does not offer a salary, hourly wage, or guaranteed income", and appending it
// would put back the exact wording removed from all 255 postings on 2026-09-29
// to satisfy Manatal's Trust & Safety review. The live footer carries the
// identification without the compensation language.
import { client, die, allJobs } from './manatal.mjs';

const args = process.argv.slice(2);
const LIVE = args.includes('--live');

/** The paragraph carrying an NPN, as it already appears in the account. */
const NPN_PARAGRAPH = /<p>[^<]*\bNPN\b[^<]*<\/p>/i;

/** Where it belongs: immediately before the equal-opportunity paragraph, which
 *  is the last thing in every description. */
const EEO_PARAGRAPH = /<p>[^<]*equal opportunity[^<]*<\/p>/i;

/** Pick the footer to copy. Requires the account to agree with itself: if
 *  postings carry more than one variant there is no single right answer and a
 *  script should not choose one. */
export function resolveFooter(descriptions) {
  const found = new Map();
  for (const d of descriptions) {
    const m = (d || '').match(NPN_PARAGRAPH);
    if (m) found.set(m[0], (found.get(m[0]) ?? 0) + 1);
  }
  if (found.size === 0) return { ok: false, reason: 'no posting in the account has an NPN paragraph to copy' };
  if (found.size > 1) {
    return {
      ok: false,
      reason: `postings use ${found.size} different NPN paragraphs; pick one by hand rather than letting this guess:\n` +
        [...found.entries()].map(([t, n]) => `      ${n}x  ${t}`).join('\n'),
    };
  }
  const [[footer, count]] = [...found.entries()];
  return { ok: true, footer, count };
}

export function addFooter(html, footer) {
  if (!html) return { ok: false, reason: 'empty description' };
  if (NPN_PARAGRAPH.test(html)) return { ok: false, reason: 'already has an NPN paragraph' };
  if (!EEO_PARAGRAPH.test(html)) return { ok: false, reason: 'no equal-opportunity paragraph to anchor to' };
  return { ok: true, html: html.replace(EEO_PARAGRAPH, (eeo) => `${footer}${eeo}`) };
}

export function verify(before, after, footer) {
  const problems = [];
  if (!after.includes(footer)) problems.push('the footer is not present');
  if ((after.match(/\bNPN\b/gi) || []).length !== 1) problems.push('NPN appears more than once');
  if (after.length !== before.length + footer.length) problems.push('something other than the footer changed');
  if (!EEO_PARAGRAPH.test(after)) problems.push('lost the equal-opportunity paragraph');
  // The whole account was scrubbed of this word; a footer must not reintroduce it.
  if (/commission/i.test(after)) problems.push('reintroduced the word "commission"');
  if (!/\b1099\b/.test(after.replace(/<[^>]+>/g, ' '))) problems.push('lost the 1099 disclosure');
  return problems;
}

const RUN_DIRECTLY = process.argv[1] && process.argv[1].endsWith('add-npn-footer.mjs');
if (RUN_DIRECTLY) {
  const api = client();
  const jobs = await allJobs(api).catch(die);

  const resolved = resolveFooter(jobs.map((j) => j.description));
  if (!resolved.ok) {
    console.error(`\nCannot determine the footer to use.\n\n  ${resolved.reason}\n`);
    process.exit(1);
  }
  console.log(`\n${jobs.length} jobs`);
  console.log(`${resolved.count} already carry this footer, and it is the only variant in the account:`);
  console.log(`  ${resolved.footer}\n`);

  const planned = [];
  const skipped = new Map();
  for (const j of jobs) {
    const r = addFooter(j.description || '', resolved.footer);
    if (!r.ok) { skipped.set(r.reason, (skipped.get(r.reason) ?? 0) + 1); continue; }
    const problems = verify(j.description, r.html, resolved.footer);
    if (problems.length) { skipped.set(problems.join('; '), (skipped.get(problems.join('; ')) ?? 0) + 1); continue; }
    planned.push({ job: j, html: r.html });
  }

  console.log(`${planned.length} to update, ${[...skipped.values()].reduce((a, b) => a + b, 0)} skipped`);
  for (const [reason, n] of skipped) console.log(`  ${String(n).padStart(4)}  ${reason}`);
  console.log('');

  if (!planned.length) { console.log('Nothing to do.'); process.exit(0); }

  if (!LIVE) {
    const { job, html } = planned[0];
    const at = html.search(NPN_PARAGRAPH);
    console.log(`Example — job ${job.id} "${job.position_name}"\n`);
    console.log(`  …${html.slice(at, at + 330)}\n`);
    console.log(`Dry run — nothing was sent. Add --live to apply to ${planned.length} posting(s).`);
    process.exit(0);
  }

  let ok = 0;
  const failed = [];
  for (let i = 0; i < planned.length; i++) {
    const { job, html } = planned[i];
    try {
      await api(`jobs/${job.id}/`, { method: 'PATCH', body: JSON.stringify({ description: html }) });
      ok++;
      if (ok % 25 === 0 || ok === planned.length) console.log(`  ${ok}/${planned.length}`);
    } catch (err) {
      failed.push(`${job.id} ${job.position_name}: ${err.message.split('\n')[0]}`);
    }
    if (i + 1 < planned.length) await new Promise((r) => setTimeout(r, 400));
  }

  console.log(`\n${ok} updated${failed.length ? `, ${failed.length} failed` : ''}.`);
  for (const f of failed) console.log(`  FAILED  ${f}`);
  console.log('\nRe-run the dry run afterwards; it should report 0 to update.');
  if (failed.length) process.exitCode = 1;
}
