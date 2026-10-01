#!/usr/bin/env node
// Send the rendered candidate outreach through GoHighLevel, from hiring@.
//
//   node scripts/send-outreach.mjs <out-dir>                      # dry run
//   node scripts/send-outreach.mjs <out-dir> --live --confirm 35   # send
//
// Needs GHL_API_KEY (a private integration token, starts with pit-) and
// GHL_LOCATION_ID. Put them in the Keychain:
//   node scripts/credentials.mjs set GHL_API_KEY
//   node scripts/credentials.mjs set GHL_LOCATION_ID
//
// WHY GHL AND NOT GMAIL. The Gmail API sends as the authenticated mailbox, so it
// cannot send as hiring@ unless that address is the account's own send-as. GHL
// sends from whatever address the location has verified, keeps the thread on the
// contact record, and handles the unsubscribe. The trade is that the sending
// domain must be verified in GHL first (Settings -> Email Services) or messages
// land in spam or bounce outright.
//
// --confirm IS NOT DECORATION. The crm skill requires bulk sends to name the
// count out loud, so the number passed must match the number of messages found.
// A mismatch aborts. This exists because the failure mode here is not a wrong
// number in a config file, it is 35 real people receiving the wrong email, and
// that cannot be taken back.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { requireKey } from './env.mjs';

const BASE = 'https://services.leadconnectorhq.com';

export const SUBJECT = 'Next step for your application — The Wood Agency Life';

/** The address the email comes from. The local part is the agency's choice; the
 *  domain has to be one GHL has verified for this location. */
export const FROM = 'Ben Wood <hiring@woodagencylife.com>';

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const valueOf = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };

/** Already-sent log, so a re-run after a partial failure does not email anyone
 *  twice. Keyed by candidate id. */
export function loadSent(path) {
  if (!existsSync(path)) return new Set();
  try { return new Set(JSON.parse(readFileSync(path, 'utf8')).sent || []); }
  catch { return new Set(); }
}

export function saveSent(path, set) {
  writeFileSync(path, JSON.stringify({ sent: [...set], updated_at: new Date().toISOString() }, null, 2));
}

/** Upsert the applicant as a GHL contact and return its id. Upsert rather than
 *  create so re-running does not produce duplicates, and so an applicant the
 *  sync already brought in is matched instead of cloned. */
export async function upsertContact(http, locationId, person) {
  const [firstName, ...rest] = String(person.name || '').trim().split(/\s+/);
  const res = await http('/contacts/upsert', {
    method: 'POST',
    version: '2021-07-28',
    body: {
      locationId,
      email: person.email,
      firstName: firstName || undefined,
      lastName: rest.join(' ') || undefined,
      source: 'Manatal applicant outreach',
    },
  });
  const id = res?.contact?.id || res?.id;
  if (!id) throw new Error(`upsert returned no contact id: ${JSON.stringify(res).slice(0, 200)}`);
  return id;
}

export async function sendEmail(http, { contactId, html, text }) {
  return http('/conversations/messages', {
    method: 'POST',
    // Conversations uses a different API version header than contacts. If this
    // comes back 4xx complaining about the version, that is the thing to change
    // — do not start rewriting the payload.
    version: '2021-04-15',
    body: { type: 'Email', contactId, subject: SUBJECT, emailFrom: FROM, html, message: text },
  });
}

function httpClient(key) {
  return async function http(path, { method = 'GET', version = '2021-07-28', body } = {}) {
    let res;
    try {
      res = await fetch(BASE + path, {
        method,
        headers: {
          Authorization: `Bearer ${key}`,
          Version: version,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (cause) {
      throw new Error(`Could not reach ${BASE} (${cause?.cause?.code || cause?.message}). ` +
        'Network or proxy problem, not the token — do not regenerate anything.');
    }
    const raw = await res.text().catch(() => '');
    if (!res.ok) {
      const hint = res.status === 401
        ? ' The token is wrong, expired, or is a session JWT rather than a pit- private integration token.'
        : res.status === 403
          ? ' The token authenticated but lacks the scope for this endpoint. Add it in Settings -> Private Integrations.'
          : '';
      throw new Error(`GHL ${method} ${path} -> HTTP ${res.status}.${hint}\n${raw.slice(0, 300)}`);
    }
    try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
  };
}

const RUN_DIRECTLY = process.argv[1] && process.argv[1].endsWith('send-outreach.mjs');
if (RUN_DIRECTLY) {
  const outDir = args.find((a) => !a.startsWith('--') && a !== valueOf('--confirm'));
  if (!outDir) {
    console.error('Usage: node scripts/send-outreach.mjs <out-dir> [--live --confirm N]');
    process.exit(2);
  }

  const index = JSON.parse(readFileSync(join(outDir, 'index.json'), 'utf8'));
  const sentPath = join(outDir, '.sent.json');
  const sent = loadSent(sentPath);
  const todo = index.filter((r) => !sent.has(r.cid));

  console.log(`\n${index.length} rendered message(s) in ${outDir}`);
  if (sent.size) console.log(`${sent.size} already sent on a previous run and will be skipped`);
  console.log(`${todo.length} to send`);
  console.log(`From:    ${FROM}`);
  console.log(`Subject: ${SUBJECT}\n`);

  for (const r of todo.slice(0, 5)) console.log(`  ${r.email.padEnd(34)} "Hi ${r.greeting},"`);
  if (todo.length > 5) console.log(`  …and ${todo.length - 5} more`);
  console.log('');

  if (!has('--live')) {
    console.log(`Dry run — nothing was sent.`);
    console.log(`To send: node scripts/send-outreach.mjs ${outDir} --live --confirm ${todo.length}`);
    process.exit(0);
  }

  const confirmed = Number(valueOf('--confirm'));
  if (confirmed !== todo.length) {
    console.error(`\nREFUSING TO SEND. --confirm says ${valueOf('--confirm') ?? '(missing)'} but ${todo.length} ` +
      `message(s) are queued.\nRe-run with --confirm ${todo.length} once that is the number you meant.\n`);
    process.exit(1);
  }

  const key = requireKey('GHL_API_KEY',
    'Create one in GoHighLevel: Settings -> Private Integrations. It must start with pit-.');
  const locationId = requireKey('GHL_LOCATION_ID',
    'GoHighLevel: Settings -> Business Profile, or the /location/<id>/ part of the URL.');
  const http = httpClient(key);

  let ok = 0;
  const failed = [];
  for (let i = 0; i < todo.length; i++) {
    const r = todo[i];
    try {
      const html = readFileSync(join(outDir, `${r.cid}.html`), 'utf8');
      const text = readFileSync(join(outDir, `${r.cid}.txt`), 'utf8');
      const contactId = await upsertContact(http, locationId, r);
      await sendEmail(http, { contactId, html, text });
      sent.add(r.cid);
      saveSent(sentPath, sent); // after each one, so a crash cannot double-send
      ok++;
      console.log(`  ${String(ok).padStart(3)}/${todo.length}  ${r.email}`);
    } catch (err) {
      failed.push(`${r.email}: ${err.message.split('\n')[0]}`);
      console.log(`  FAILED   ${r.email}`);
    }
    if (i + 1 < todo.length) await new Promise((res) => setTimeout(res, 600));
  }

  console.log(`\n${ok} sent${failed.length ? `, ${failed.length} failed` : ''}.`);
  for (const f of failed) console.log(`  ${f}`);
  if (failed.length) {
    console.log('\nRe-running skips everyone who already received it — only the failures go again.');
    process.exitCode = 1;
  }
}
