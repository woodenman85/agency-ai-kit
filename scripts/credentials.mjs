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

/** Read a secret from the terminal without echoing it.
 *
 *  This is here because `security add-generic-password` does NOT prompt when
 *  -w is omitted, contrary to what the flag's description suggests. It creates
 *  the item with an empty password and exits 0 — so the first version of this
 *  script appeared to hang-then-fail, and would have left a broken empty
 *  Keychain entry behind if `set` were not verifying the value afterward.
 *
 *  Raw mode delivers a paste as one chunk, so iterate characters rather than
 *  treating each data event as a single keystroke. */
function promptSecret(label) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      reject(new Error('Not an interactive terminal — run this directly in Terminal.'));
      return;
    }
    process.stdout.write(label);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    let buf = '';
    const done = (fn) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      process.stdout.write('\n');
      fn();
    };
    const onData = (chunk) => {
      for (const ch of chunk) {
        // Enter (CR/LF) or ctrl-D ends the entry.
        if (ch === '\r' || ch === '\n' || ch === '\u0004') return done(() => resolve(buf));
        if (ch === '\u0003') return done(() => process.exit(130)); // ctrl-C
        if (ch === '\u007f' || ch === '\b') buf = buf.slice(0, -1); // backspace
        else if (ch >= ' ') buf += ch; // ignore other control chars
      }
    };
    stdin.on('data', onData);
  });
}

/** Write a secret into the login Keychain.
 *
 *  The value goes through argv, which is briefly visible to `ps` for other
 *  processes running as you. `security` offers no way to read it from stdin,
 *  so the alternative is not a safer write but no Keychain support at all —
 *  and the thing it replaces is a plaintext file that sits there permanently.
 *  -U updates an existing item instead of failing on a duplicate. */
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

    let value;
    try {
      value = (await promptSecret(`Paste ${arg} (nothing will appear as you type), then press return: `)).trim();
    } catch (err) {
      console.error(`\n${err.message}`);
      process.exit(1);
    }
    if (!value) {
      console.error('Nothing entered. Nothing was changed.');
      process.exit(1);
    }

    try {
      keychainSetValue(arg, value);
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
    if (stored !== value) {
      console.error(`\n${arg} saved, but reads back different from what was entered. Check for a stray space.`);
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
