// Where credentials come from, in priority order:
//
//   1. A real environment variable  (a one-off `MANATAL_API_KEY=… node …`)
//   2. The macOS Keychain           (the normal place on a Mac)
//   3. .env in the repo root        (fallback: Linux, CI, or no Keychain entry)
//
// The Keychain is preferred over .env because .env is a plaintext file sitting
// in a folder. Anything that can read your home directory can read it — a
// backup, a sync client, a stray `cat`, an npm postinstall script. Keychain
// items are encrypted at rest and unlocked by your login, and the secret never
// exists as readable bytes on disk.
//
// .env still works and is still git-ignored. It is the fallback so the kit runs
// unchanged on Linux and in cloud sessions, where there is no Keychain.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The real process environment, captured BEFORE .env is merged in, so an
 *  explicit `FOO=bar node script.mjs` can still be told apart from a .env line
 *  and keep its priority over the Keychain. */
const REAL_ENV = { ...process.env };

/** Values parsed out of .env, kept separately for the same reason. */
const DOT_ENV = new Map();

const envPath = path.join(ROOT, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    const value = m[2].trim().replace(/^["']|["']$/g, '');
    if (value) DOT_ENV.set(m[1], value);
  }
}

/** The Keychain service name every credential in this kit is filed under.
 *  One service, one item per variable name, so `credentials.mjs list` can find
 *  them all and nothing collides with another app's entries. */
export const KEYCHAIN_SERVICE = 'agency-ai-kit';

/** True on a Mac with the `security` CLI — i.e. the Keychain is usable. */
export function keychainAvailable() {
  if (process.platform !== 'darwin') return false;
  try {
    execFileSync('security', ['-h'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Read one secret from the login Keychain, or null.
 *
 *  Null covers every failure the same way on purpose — not a Mac, no such item,
 *  Keychain locked, user dismissed the unlock prompt. None of those should
 *  crash a script that has a .env to fall back on. */
export function keychainGet(name) {
  if (process.platform !== 'darwin') return null;
  try {
    const v = execFileSync(
      'security',
      ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-a', name, '-w'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    return v.trim() || null;
  } catch {
    return null;
  }
}

/** Where a resolved credential came from, for messages that need to say so. */
export function sourceOf(name) {
  if (REAL_ENV[name]) return 'environment variable';
  if (keychainGet(name)) return 'macOS Keychain';
  if (DOT_ENV.has(name)) return '.env';
  return null;
}

/** Resolve a credential by the priority order at the top of this file, or null.
 *
 *  Also writes the result into process.env, because some clients read it
 *  directly rather than being handed a value — `new Anthropic()` in
 *  generate-bulk.mjs is exactly that. Without this, a key that lives only in
 *  the Keychain would resolve here and still fail inside the SDK. */
export function getKey(name) {
  const v = REAL_ENV[name] || keychainGet(name) || DOT_ENV.get(name) || null;
  if (v) process.env[name] = v;
  return v;
}

/** Read a required credential, or exit with instructions instead of a stack trace. */
export function requireKey(name, how) {
  const v = getKey(name);
  if (v) return v;

  const mac = keychainAvailable();
  console.error(
    `${name} is not set.\n\n` +
      (mac
        ? `Store it in your Keychain (recommended — encrypted, not a file on disk):\n\n` +
          `  node scripts/credentials.mjs set ${name}\n\n` +
          `Or, if you would rather use a plaintext file, add this line to .env in the kit folder:\n\n` +
          `  ${name}=your_key_here\n\n`
        : `Add this line to the .env file in the kit folder:\n\n  ${name}=your_key_here\n\n`) +
      how,
  );
  process.exit(1);
}
