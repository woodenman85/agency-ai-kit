#!/usr/bin/env node
// Render the candidate outreach email for each applicant.
//
//   node scripts/render-outreach.mjs applicants.json out/
//
// Produces out/<candidate-id>.html and out/<candidate-id>.txt plus out/index.json
// listing who gets what. Rendering is separated from sending on purpose: the
// send goes out through whichever channel the agency is using that day (GHL,
// Gmail, the ATS), and a template that can only be seen by sending it is a
// template nobody checks.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

const TEMPLATE = join(dirname(new URL(import.meta.url).pathname), '..', 'templates', 'applicant-outreach.html');

/** A first name we are willing to put at the top of an email.
 *
 *  The ATS has "OiShilpa sen", "Frett Alan kelvin Jr", "JOY GODPOWER" and
 *  "Latoya Williams Williams" in it. Whatever is done here, some of these will
 *  read slightly wrong — but "Hi JOY," shouting at someone is worse than a
 *  missed capital, and an empty or mangled greeting is worse than both. So:
 *  take the first token, and fix obvious all-caps. Anything that does not
 *  survive that becomes a neutral greeting rather than a guess. */
export function firstName(fullName) {
  const token = String(fullName || '').trim().split(/\s+/)[0] || '';
  const letters = token.replace(/[^A-Za-z'\-]/g, '');
  if (letters.length < 2) return null;
  // All-caps or all-lowercase both get title-cased; mixed case is left alone,
  // because "McKenna" and "DeShawn" are correct as given.
  if (letters === letters.toUpperCase() || letters === letters.toLowerCase()) {
    return letters[0].toUpperCase() + letters.slice(1).toLowerCase();
  }
  return letters;
}

export function render(template, { firstName: first, bookingUrl }) {
  if (!bookingUrl) throw new Error('bookingUrl is required');
  return template
    .split('{{FIRST_NAME}}').join(first || 'there')
    .split('{{BOOKING_URL}}').join(bookingUrl);
}

/** Plain-text alternative. Every HTML email needs one — without it spam filters
 *  score the message worse and text-only clients show nothing. */
export function plainText({ firstName: first, bookingUrl }) {
  return `Hi ${first || 'there'},

Thank you for applying to The Wood Agency Life. Your application came through
to me, and I'd like to talk with you about the role.

The next step is a short conversation - about 15 to 20 minutes. I'll walk you
through how the agency works and what the day actually looks like, and you can
ask me whatever you want. Nothing to prepare.

Pick a time that works for you:
${bookingUrl}

If none of the times fit, just reply to this email and we'll find one.

A FEW THINGS WORTH KNOWING BEFORE WE TALK

This is a 1099 independent contractor role. Earnings are based on individual
production.

A state life insurance license is required before any sales activity. If you
aren't licensed yet, that's fine - plenty of our agents weren't, and we'll walk
you through it.

The work is 100% remote.

Looking forward to it.

Ben Wood
The Wood Agency Life
(928) 889-6338

--
The Wood Agency Life is an independent insurance agency. Ben Wood, NPN 20251128.
Questions: (928) 889-6338.

The Wood Agency Life provides equal opportunity to all applicants without regard
to race, color, religion, sex, national origin, age, disability, veteran status,
or any other status protected by law.

You're receiving this because you applied to a role at The Wood Agency Life.
Reply with "stop" and we won't contact you again.
`;
}

/** Nothing in a candidate-facing email may claim earnings or a wage.
 *  reference/compliance.md bans income claims outright; this is the same check
 *  the posting scripts run, applied to email copy. */
export function complianceProblems(html) {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const problems = [];
  if (/\$\s?\d|\b\d{2,3}\s?k\b/i.test(text)) problems.push('contains something resembling a pay figure');
  if (/\b(salary|salaried|hourly|wage|W-2|benefits package|paid training)\b/i.test(text)) {
    problems.push('uses employment language that does not apply to a 1099 contractor');
  }
  if (/\bguarantee/i.test(text)) problems.push('contains a guarantee');
  if (/free leads|leads provided at no cost/i.test(text)) problems.push('claims free leads');
  if (!/\b1099\b/.test(text)) problems.push('missing the 1099 disclosure');
  if (!/NPN\s*20251128/.test(text)) problems.push('missing the NPN attribution');
  if (!/equal opportunity/i.test(text)) problems.push('missing the equal-opportunity paragraph');
  if (!/licen[sc]e/i.test(text)) problems.push('does not mention the licensing requirement');
  if (/\{\{|\}\}/.test(html)) problems.push('an unreplaced template token is still present');
  return problems;
}

const RUN_DIRECTLY = process.argv[1] && process.argv[1].endsWith('render-outreach.mjs');
if (RUN_DIRECTLY) {
  const [listPath, outDir] = process.argv.slice(2);
  const bookingUrl = process.env.BOOKING_URL;
  if (!listPath || !outDir) {
    console.error('Usage: BOOKING_URL=https://… node scripts/render-outreach.mjs <applicants.json> <out-dir>');
    process.exit(2);
  }
  if (!bookingUrl) {
    console.error('Set BOOKING_URL to the agency booking link (agency.json booking_url).');
    process.exit(2);
  }

  const template = readFileSync(TEMPLATE, 'utf8');
  const people = JSON.parse(readFileSync(listPath, 'utf8'));
  mkdirSync(outDir, { recursive: true });

  const index = [];
  let problems = 0;
  for (const p of people) {
    if (!p.email) { console.log(`  SKIP  ${p.name} — no email on file`); continue; }
    const first = firstName(p.name);
    const html = render(template, { firstName: first, bookingUrl });
    const txt = plainText({ firstName: first, bookingUrl });
    const found = complianceProblems(html);
    if (found.length) { problems++; console.log(`  PROBLEM  ${p.name}: ${found.join('; ')}`); }
    writeFileSync(join(outDir, `${p.cid}.html`), html);
    writeFileSync(join(outDir, `${p.cid}.txt`), txt);
    index.push({ cid: p.cid, name: p.name, greeting: first || 'there', email: p.email });
  }
  writeFileSync(join(outDir, 'index.json'), JSON.stringify(index, null, 2));

  console.log(`\n${index.length} rendered into ${outDir}`);
  const odd = index.filter((r) => r.greeting === 'there');
  if (odd.length) {
    console.log(`${odd.length} will be greeted "Hi there," because no usable first name was on file:`);
    for (const r of odd) console.log(`  ${r.name}`);
  }
  if (problems) { console.log(`\n${problems} message(s) failed the compliance check — nothing should be sent.`); process.exitCode = 1; }
  else console.log('Compliance check passed on every message.');
}
