// Run: node scripts/set-config.test.mjs
import { setKey, looksLikeCredential } from './set-config.mjs';

let failures = 0;
const check = (label, cond) => {
  console.log(`  ${cond ? 'pass' : 'FAIL'}  ${label}`);
  if (!cond) failures++;
};

const BASE = JSON.stringify({ agency_name: 'The Wood Agency Life', apply_url: 'https://x/apply' }, null, 2);

console.log('Setting a key');
{
  const r = setKey(BASE, 'booking_url', 'https://link.integrityfex.com/widget/bookings/whgiwefhwiph');
  const parsed = JSON.parse(r.text);
  check('adds the key', parsed.booking_url === 'https://link.integrityfex.com/widget/bookings/whgiwefhwiph');
  check('reports it as new', r.existed === false);
  check('leaves the other keys alone',
    parsed.agency_name === 'The Wood Agency Life' && parsed.apply_url === 'https://x/apply');
  check('output is valid JSON ending in a newline', r.text.endsWith('}\n'));
}

console.log('\nOverwriting a key reports what it replaced');
{
  const r = setKey(BASE, 'apply_url', 'https://y/apply');
  check('reports it existed', r.existed === true);
  check('reports the old value', r.before === 'https://x/apply');
  check('new value is in place', JSON.parse(r.text).apply_url === 'https://y/apply');
}

console.log('\nCredentials are refused, by key name and by value shape');
for (const [k, v] of [
  ['ghl_api_key', 'anything'],
  ['manatal_token', 'anything'],
  ['ftp_password', 'hunter2'],
  ['client_secret', 'x'],
  ['ghl_applicant_webhook_url', 'https://hooks/x'],
  ['booking_url', 'pit-abc123'],
  ['booking_url', 'sk-abc123'],
]) check(`refuses ${k} = ${v}`, looksLikeCredential(k, v) !== null);

console.log('\nOrdinary agency facts are allowed');
for (const [k, v] of [
  ['booking_url', 'https://link.integrityfex.com/widget/bookings/whgiwefhwiph'],
  ['apply_url', 'https://woodagencylife.com/apply'],
  ['npn', '20251128'],
  ['candidate_phone', '(928) 889-6338'],
  ['website_domain', 'woodagencylife.com'],
]) check(`allows ${k}`, looksLikeCredential(k, v) === null);

console.log('\nInvalid JSON in means an exception, not a mangled file');
check('throws rather than guessing', (() => {
  try { setKey('{"a":1', 'b', 'c'); return false; } catch { return true; }
})());

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall passed');
process.exit(failures ? 1 : 0);
