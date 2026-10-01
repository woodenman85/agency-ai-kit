// Run: node scripts/render-outreach.test.mjs
import { readFileSync } from 'node:fs';
import { firstName, render, plainText, complianceProblems } from './render-outreach.mjs';
import { loadSent, saveSent, upsertContact, sendEmail, SUBJECT, FROM } from './send-outreach.mjs';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TEMPLATE = readFileSync(new URL('../templates/applicant-outreach.html', import.meta.url), 'utf8');
const URL_ = 'https://link.integrityfex.com/widget/bookings/whgiwefhwiph';

let failures = 0;
const check = (label, cond) => {
  console.log(`  ${cond ? 'pass' : 'FAIL'}  ${label}`);
  if (!cond) failures++;
};

// Every one of these is a real name from the 2026-10-01 applicant list.
console.log('Greetings from the names actually in the ATS');
for (const [input, want] of [
  ['Rebecca Forsythe', 'Rebecca'],
  ['JOY GODPOWER', 'Joy'],          // all-caps must not be shouted back
  ['charles Efunnuga', 'Charles'],  // all-lower gets capitalized
  ['Latoya Williams Williams', 'Latoya'],
  ['Frett Alan kelvin Jr', 'Frett'],
  ['Arusha P Mathew', 'Arusha'],
  ['OiShilpa sen', 'OiShilpa'],     // mixed case is left alone, never "guessed"
]) check(`"${input}" -> "${want}"`, firstName(input) === want);

console.log('\nNames that cannot produce a greeting fall back rather than guess');
for (const input of ['', '   ', 'X', '42', '!!!', null, undefined]) {
  check(`${JSON.stringify(input)} -> null`, firstName(input) === null);
}
check('a null first name renders "Hi there,"',
  render(TEMPLATE, { firstName: null, bookingUrl: URL_ }).includes('Hi there,'));

console.log('\nRendering');
{
  const html = render(TEMPLATE, { firstName: 'Rebecca', bookingUrl: URL_ });
  check('greets by name', html.includes('Hi Rebecca,'));
  check('no template token survives', !/\{\{|\}\}/.test(html));
  check('the booking link is in the button href', html.includes(`href="${URL_}"`));
  check('the booking link appears nowhere as a placeholder', !html.includes('your-calendar'));
  check('requires a booking url rather than sending an empty button', (() => {
    try { render(TEMPLATE, { firstName: 'A' }); return false; } catch { return true; }
  })());
}

console.log('\nThe plain-text alternative');
{
  const txt = plainText({ firstName: 'Rebecca', bookingUrl: URL_ });
  check('carries the booking link as a bare url', txt.includes(URL_));
  check('has no HTML tags', !/<[a-z/]/i.test(txt));
  check('carries the 1099 disclosure', /\b1099\b/.test(txt));
  check('carries the NPN', /NPN 20251128/.test(txt));
  check('carries the EEO paragraph', /equal opportunity/i.test(txt));
  check('tells people how to stop', /stop/i.test(txt));
}

console.log('\nThe compliance gate catches what compliance.md bans');
{
  const good = render(TEMPLATE, { firstName: 'Rebecca', bookingUrl: URL_ });
  check('the real template passes', complianceProblems(good).length === 0);

  const cases = [
    ['a dollar figure', good.replace('individual production.', 'individual production, typically $90,000.'), /pay figure/],
    ['a k-suffixed figure', good.replace('individual production.', 'individual production, often 90k.'), /pay figure/],
    ['employment language', good.replace('1099 independent contractor role', 'salaried position'), /employment language/],
    ['a guarantee', good.replace('Looking forward to it.', 'Income is guaranteed.'), /guarantee/],
    ['free leads', good.replace('Looking forward to it.', 'We give you free leads.'), /free leads/],
    ['a missing NPN', good.replace('NPN 20251128', 'NPN'), /NPN/],
    ['a dropped EEO paragraph', good.replace(/provides equal opportunity/, 'is great'), /equal-opportunity/],
    ['an unreplaced token', good.replace('Hi Rebecca,', 'Hi {{FIRST_NAME}},'), /token/],
  ];
  for (const [label, bad, want] of cases) {
    check(`rejects ${label}`, complianceProblems(bad).some((p) => want.test(p)));
  }
}

console.log('\nThe send log prevents double-sending');
{
  const dir = mkdtempSync(join(tmpdir(), 'outreach-'));
  const p = join(dir, '.sent.json');
  check('an absent log reads as empty', loadSent(p).size === 0);
  const s = new Set([111, 222]);
  saveSent(p, s);
  check('round-trips', loadSent(p).size === 2 && loadSent(p).has(111));
  // A half-written log after a crash must not take the next run down with it.
  writeFileSync(p, '{"sent":[1,2');
  check('a truncated log reads as empty rather than throwing', loadSent(p).size === 0);
}

console.log('\nGHL calls are shaped the way the API expects');
{
  const calls = [];
  const http = async (path, opts) => {
    calls.push({ path, ...opts });
    if (path === '/contacts/upsert') return { contact: { id: 'c_123' } };
    return { ok: true };
  };
  const id = await upsertContact(http, 'loc_1', { name: 'Rebecca Forsythe', email: 'r@example.com' });
  check('upsert returns the contact id', id === 'c_123');
  check('upsert splits the name', calls[0].body.firstName === 'Rebecca' && calls[0].body.lastName === 'Forsythe');
  check('upsert carries the location', calls[0].body.locationId === 'loc_1');
  check('upsert uses the contacts API version', calls[0].version === '2021-07-28');

  await sendEmail(http, { contactId: id, html: '<p>x</p>', text: 'x' });
  const send = calls[1];
  check('sends to /conversations/messages', send.path === '/conversations/messages');
  check('uses the conversations API version', send.version === '2021-04-15');
  check('type is Email', send.body.type === 'Email');
  check('from is hiring@', /hiring@/.test(send.body.emailFrom) && send.body.emailFrom === FROM);
  check('carries the subject', send.body.subject === SUBJECT);
  check('carries both html and plain text', send.body.html === '<p>x</p>' && send.body.message === 'x');

  check('upsert fails loudly when no id comes back', await (async () => {
    try { await upsertContact(async () => ({}), 'loc', { name: 'A B', email: 'a@b.c' }); return false; }
    catch (e) { return /no contact id/.test(e.message); }
  })());
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall passed');
process.exit(failures ? 1 : 0);
