#!/usr/bin/env node
// Set one key in config/agency.json.
//
//   node scripts/set-config.mjs booking_url "https://link.example.com/widget/bookings/abc"
//   node scripts/set-config.mjs --show
//
// Exists so a config change is one command instead of "open this JSON file and
// add a line next to the other one, minding the comma". A missed comma produces
// a parse error in every script at once, which is a bad trade for saving a file.
//
// NEVER put a credential here. config/agency.json holds the facts the kit is
// allowed to claim on the agency's behalf; keys go in the Keychain via
// credentials.mjs. This refuses anything that looks like one.
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(new URL(import.meta.url).pathname), '..');
const PATH = join(ROOT, 'config', 'agency.json');

/** Key names that must never hold a value in this file. */
const CREDENTIAL_ISH = /(^|_)(api_?key|token|secret|password|passwd|pwd|private_?key|webhook_?url)$/i;

export function looksLikeCredential(key, value) {
  if (CREDENTIAL_ISH.test(key)) return `"${key}" looks like a credential`;
  if (/^pit-/.test(value)) return 'that value is a GoHighLevel private integration token';
  if (/^(sk|pk)-[A-Za-z0-9]/.test(value)) return 'that value looks like an API key';
  return null;
}

export function setKey(json, key, value) {
  const parsed = JSON.parse(json);
  const existed = Object.prototype.hasOwnProperty.call(parsed, key);
  const before = parsed[key];
  parsed[key] = value;
  return { text: JSON.stringify(parsed, null, 2) + '\n', existed, before };
}

const RUN_DIRECTLY = process.argv[1] && process.argv[1].endsWith('set-config.mjs');
if (RUN_DIRECTLY) {
  const args = process.argv.slice(2);

  if (!existsSync(PATH)) {
    console.error(`\nNo config/agency.json yet. Run the agency-setup skill first — it writes this file.\n`);
    process.exit(1);
  }

  let raw;
  try {
    raw = readFileSync(PATH, 'utf8');
    JSON.parse(raw);
  } catch (err) {
    console.error(`\nconfig/agency.json is not valid JSON, so nothing was changed:\n  ${err.message}\n`);
    process.exit(1);
  }

  if (args[0] === '--show' || args.length === 0) {
    const parsed = JSON.parse(raw);
    console.log('');
    for (const [k, v] of Object.entries(parsed)) {
      if (k.startsWith('_')) continue;
      console.log(`  ${k.padEnd(26)} ${typeof v === 'string' ? v : JSON.stringify(v)}`);
    }
    console.log(`\nUsage: node scripts/set-config.mjs <key> "<value>"\n`);
    process.exit(0);
  }

  const [key, value] = args;
  if (!key || value === undefined) {
    console.error('\nUsage: node scripts/set-config.mjs <key> "<value>"\n');
    process.exit(2);
  }

  const bad = looksLikeCredential(key, value);
  if (bad) {
    console.error(`\nREFUSING: ${bad}.\n\nconfig/agency.json is committed-adjacent and read by every skill. ` +
      `Credentials go in the Keychain:\n  node scripts/credentials.mjs set ${key.toUpperCase()}\n`);
    process.exit(1);
  }

  const { text, existed, before } = setKey(raw, key, value);
  copyFileSync(PATH, PATH + '.bak');
  writeFileSync(PATH, text);

  console.log('');
  if (existed) console.log(`  ${key}\n    was: ${JSON.stringify(before)}\n    now: ${JSON.stringify(value)}`);
  else console.log(`  ${key} added: ${JSON.stringify(value)}`);
  console.log(`\nPrevious version saved as config/agency.json.bak\n`);
}
