#!/usr/bin/env node
// Replace a piece of text in the Manatal company profile (the organization "description"
// shown beside your listings). Dry run unless --live.
//
//   node scripts/edit-organization.mjs --find "old text" --replace "new text"
//   node scripts/edit-organization.mjs --find "old text" --replace "new text" --live
//
// The match is literal text, not a regex. After the write the profile is read back from
// Manatal and checked. If the account has more than one organization, add --id.
import { api, fetchAll } from './manatal.mjs';

const argv = process.argv.slice(2);
const has = (n) => argv.includes(n);
const value = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const LIVE = has('--live');
const find = value('--find');
const replace = value('--replace');
const id = value('--id') ? Number(value('--id')) : null;

const usage = (msg) => { console.error(`${msg}\n\nUsage: node scripts/edit-organization.mjs --find "old text" --replace "new text" [--id 123] [--live]`); process.exit(1); };
if (!find || find.length < 4) usage('--find is required and must be at least 4 characters.');
if (!has('--replace') || replace === undefined) usage('--replace is required (use --replace "" to delete the text).');

const { rows: orgs } = await fetchAll('organizations/');
const pool = id ? orgs.filter((o) => o.id === id) : orgs;
if (!pool.length) usage(id ? `No organization with id ${id}.` : 'No organizations returned.');
if (pool.length > 1) usage(`This account has ${pool.length} organizations (${pool.map((o) => `${o.id} ${o.name}`).join('; ')}). Add --id to pick one.`);
const org = pool[0];

const current = org.description || '';
console.log(`Organization: ${org.id}  ${org.name}\n`);
if (!current.includes(find)) {
  console.log('That text is not in the profile, so nothing would change. The profile currently reads:\n');
  console.log(current || '(empty)');
  const applied = replace.length >= 4 && current.includes(replace);
  console.log(applied ? '\nThe new text is already there, so this looks done.' : '\nCheck the wording of --find against the text above.');
  process.exit(applied ? 0 : 1);
}

const next = current.split(find).join(replace);
console.log(`BEFORE:\n${current}\n\nAFTER:\n${next}\n`);
if (!LIVE) { console.log('Dry run — nothing was changed. Add --live to do it.'); process.exit(0); }

const res = await api(`organizations/${org.id}/`, { method: 'PATCH', body: JSON.stringify({ description: next }) });
if (!res.ok) { console.error(`PATCH failed: HTTP ${res.status} ${await res.text()}`); process.exit(1); }
const back = await api(`organizations/${org.id}/`);
if (!back.ok) { console.error(`Saved, but could not read it back: HTTP ${back.status}`); process.exit(1); }
const now = await back.json();
if (now.description !== next) { console.error('Manatal accepted the edit but the profile does not show it.'); process.exit(1); }
console.log('Done. The profile was updated and read back from Manatal to confirm.');
