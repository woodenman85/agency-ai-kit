// Loads .env from the repo root into process.env so scripts "just work"
// after setup, with no export needed in every new terminal.
// Values already in the environment win, so a one-off export still overrides .env.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const envPath = path.join(ROOT, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    const value = m[2].trim().replace(/^["']|["']$/g, '');
    if (value && !process.env[m[1]]) process.env[m[1]] = value;
  }
}

/** Read a required key, or exit with instructions instead of a stack trace. */
export function requireKey(name, how) {
  const v = process.env[name];
  if (v) return v;
  console.error(`${name} is not set.\n\nAdd this line to the .env file in the kit folder:\n\n  ${name}=your_key_here\n\n${how}`);
  process.exit(1);
}
