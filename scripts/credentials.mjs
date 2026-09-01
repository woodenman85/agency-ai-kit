#!/usr/bin/env node
// Manage the kit's credentials in the macOS Keychain.
//
//   node scripts/credentials.mjs set MANATAL_API_KEY   # prompts, never echoes
//   node scripts/credentials.mjs list                  # what is set, and from where
//   node scripts/credentials.mjs rm MANATAL_API_KEY    # delete from the Keychain
//   node scripts/credentials.mjs import                # move .env into the Keychain
//
// Why this exists: .env is a plaintext file. Anything that can read your home
// directory can read your API keys out of it — Time Machine, a sync client, an
// npm postinstall script, a screen share. Keychain items are encrypted at rest
// and unlocked by your login.
//
// This is macOS only. On Linux and in cloud sessions the kit falls back to
// .env, which still works and is still git-ignored.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, KEYCHAIN_SERVICE, keychainAvailable, keychainGet, sourceOf } from './env.mjs';

// Every credential the kit knows how to use. `list` walks this so it can report
// what is missing, not only what happens to be set.
const KNOWN = [
  ['MANATAL_API_KEY', 'Manatal ATS — Settings -> Integrations -> Open API'],
  ['GHL_API_KEY', 'GoHighLevel — Settings -> Private Integrations (starts with pit-)'],
  ['FTP_HOST', 'Website FTP host'],
  ['FTP_USER', 'Website FTP user'],
  ['FTP_PASSWORD', 'Website FTP password'],
  ['ANTHROPIC_API_KEY', 'Optional — only for 100+ city bulk generation'],
];

const [cmd, arg] = process.argv.slice(2);

function requireMac() {
  if (keychainAvailable()) return;
  console.error(
    'The Keychain is only available on macOS.\n\n' +
      'On this system, put credentials in the .env file in the kit folder instead.\n' +
      'It is git-ignored, so it will not be committed.',
  );
  process.exit(1);
}

/** Store a secret. The value is NOT passed on the command line — `security`
 *  prompts for it and reads without echo, so it never appears in `ps` output
 *  or in your shell history. -U updates an existing item instead of failing. */
function keychainSet(name) {
  execFileSync('security', ['add-generic-password', '-U', '-s', KEYCHAIN_SERVICE, '-a', name], {
    stdio: 'inherit',
  });
}

/** Same, but with the value supplied. Only used by `import`, where the secret
 *  is already sitting in a plaintext file anyway. It is briefly visible in the
 *  process list, which is why interactive `set` does not do this. */
function keychainSetValue(name, value) {
  execFileSync(
    'security',
    ['add-generic-password', '-U', '-s', KEYCHAIN_SERVICE, '-a', name, '-w', value],
    { stdio: ['ignore', 'ignore', 'inherit'] },
  );
}

function keychainDelete(name) {
  execFileSync('security', ['delete-generic-password', '-s', KEYCHAIN_SERVICE, '-a', name], {
    stdio: ['ignore', 'ignore', 'ignore'],
  });
}

/** Enough of a secret to recognize it, not enough to use it. */
const mask = (v) => (v.length <= 8 ? '•'.repeat(v.length) : `${v.slice(0, 4)}${'•'.repeat(12)}${v.slice(-4)}`);

switch (cmd) {
  case 'set': {
    requireMac();
    if (!arg) {
      console.error('Which credential? e.g.\n\n  node scripts/credentials.mjs set MANATAL_API_KEY');
      process.exit(1);
    }
    console.log(`Storing ${arg} in your Keychain (service: ${KEYCHAIN_SERVICE}).`);
    console.log('Paste the value at the prompt — it will not be shown as you type.\n');
    try {
      keychainSet(arg);
    } catch {
      console.error(`\nCould not store ${arg}. Nothing was changed.`);
      process.exit(1);
    }
    // Read it back rather than trusting the exit code: an empty or mistyped
    // entry fails the same way a missing one does, and silently.
    const stored = keychainGet(arg);
    if (!stored) {
      console.error(`\n${arg} did not save. Try again.`);
      process.exit(1);
    }
    console.log(`\n${arg} saved: ${mask(stored)}`);
    console.log('The kit will now find it automatically. You can delete .env if nothing else needs it.');
    break;
  }

  case 'rm': {
    requireMac();
    if (!arg) {
      console.error('Which credential? e.g.\n\n  node scripts/credentials.mjs rm MANATAL_API_KEY');
      process.exit(1);
    }
    if (!keychainGet(arg)) {
      console.log(`${arg} is not in the Keychain. Nothing to remove.`);
      break;
    }
    keychainDelete(arg);
    console.log(`${arg} removed from the Keychain.`);
    break;
  }

  case 'list': {
    const width = Math.max(...KNOWN.map(([n]) => n.length));
    console.log('');
    for (const [name, note] of KNOWN) {
      const src = sourceOf(name);
      const status = src ? `set  (${src})` : 'not set';
      console.log(`  ${name.padEnd(width)}  ${status}`);
      if (!src) console.log(`  ${' '.repeat(width)}  ${note}`);
    }
    console.log('');
    if (!keychainAvailable()) {
      console.log('Keychain unavailable on this system — the kit is reading .env instead.');
    } else if (fs.existsSync(path.join(ROOT, '.env'))) {
      console.log('A .env file exists. Run `node scripts/credentials.mjs import` to move it into');
      console.log('the Keychain, then delete it.');
    }
    break;
  }

  case 'import': {
    requireMac();
    const envPath = path.join(ROOT, '.env');
    if (!fs.existsSync(envPath)) {
      console.log('No .env file to import.');
      break;
    }
    const found = [];
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (!m) continue;
      const value = m[2].trim().replace(/^["']|["']$/g, '');
      if (value) found.push([m[1], value]);
    }
    if (!found.length) {
      console.log('.env has no values in it.');
      break;
    }
    for (const [name, value] of found) {
      keychainSetValue(name, value);
      const ok = keychainGet(name);
      console.log(`  ${ok ? 'moved  ' : 'FAILED '} ${name}  ${ok ? mask(ok) : ''}`);
    }
    console.log(`\n${found.length} credential(s) now in your Keychain.`);
    console.log('\n.env was NOT deleted — check the list above first, then remove it:');
    console.log(`  rm ${envPath}`);
    break;
  }

  default:
    console.log(`Manage the kit's credentials in the macOS Keychain.

  node scripts/credentials.mjs list                 what is set, and from where
  node scripts/credentials.mjs set  MANATAL_API_KEY store one (prompts, no echo)
  node scripts/credentials.mjs rm   MANATAL_API_KEY delete one
  node scripts/credentials.mjs import               move an existing .env in

Credentials resolve in this order: environment variable, then Keychain, then
.env. On Linux and in cloud sessions there is no Keychain and .env is used.`);
}
