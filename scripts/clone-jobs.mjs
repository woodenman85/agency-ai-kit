#!/usr/bin/env node
// Clone the reviewed template postings to more cities, word for word. Dry run unless --live.
//
//   node scripts/clone-jobs.mjs --cities 50                    # dry run: show what would be created
//   node scripts/clone-jobs.mjs --cities 50 --live             # create them as unpublished drafts
//   node scripts/clone-jobs.mjs --cities 50 --live --publish   # create them and make them public
//   node scripts/clone-jobs.mjs --cities 50 --offset 50 --live --publish   # the next 50 cities
//   node scripts/clone-jobs.mjs --cities 50 --exclude-states "Hawaii,NY,AK"   # skip states you don't want
//   node scripts/clone-jobs.mjs --next 20 --cities-file scripts/cities-2.json --titles-file scripts/titles-2.json --live --publish
//                                                              # a regular wave: the next 20 cities with no posting yet
//
// --exclude-states takes full names or two-letter codes. States are removed from the list BEFORE
// --cities and --offset are counted, so you still get the number of postings you asked for. Use the
// same --exclude-states on every wave so --offset keeps lining up.
//
// --next N skips the bookkeeping: it takes the next N cities in the list that have no posting yet, so
// every wave is the identical command. It cannot be combined with --cities or --offset.
//
// --titles-file maps each template's current title to a new one ({"old title": "new title", ...}).
// The new title replaces only the title; the approved description is copied untouched. Every template
// must be mapped, so a typo can't quietly leave one behind.

// The templates are the jobs in your Manatal account that have NO city set (the ones Manatal
// reviewed). Each city gets one posting, rotating through the templates in id order. The
// description and title are copied exactly; only the city and state fields change, so nothing
// new has to be reviewed. A city's template is fixed by that city's place in the ORIGINAL list,
// so changing --exclude-states or --offset between waves never reassigns it, and a city that
// already has any posting is skipped (one posting per city). Cities come from scripts/cities.json (or --cities-file).
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './env.mjs';
import { api, fetchAll, pause } from './manatal.mjs';
import { parseStates } from './states.mjs';

const argv = process.argv.slice(2);
const has = (n) => argv.includes(n);
const value = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const LIVE = has('--live');
const PUBLISH = has('--publish');
const COUNT = Number(value('--cities') || 50);
const OFFSET = Number(value('--offset') || 0);
const citiesFile = value('--cities-file') || path.join(ROOT, 'scripts/cities.json');
const titlesFile = value('--titles-file');
const NEXT = value('--next') === undefined ? null : Number(value('--next'));
const sourceIds = (value('--source-ids') || '').split(',').map((s) => s.trim()).filter(Boolean).map(Number);

const usage = (msg) => { console.error(`${msg}\n\nUsage: node scripts/clone-jobs.mjs --cities N [--offset N] [--cities-file path] [--exclude-states "Hawaii,NY"] [--source-ids 1,2,3] [--titles-file path] [--live] [--publish]\n       node scripts/clone-jobs.mjs --next N [--cities-file path] [--titles-file path] [--exclude-states "..."] [--live] [--publish]`); process.exit(1); };
if (!Number.isInteger(COUNT) || COUNT < 1) usage('--cities must be a whole number of 1 or more.');
if (!Number.isInteger(OFFSET) || OFFSET < 0) usage('--offset must be 0 or more.');
if (PUBLISH && !LIVE) usage('--publish only applies with --live.');
if (NEXT !== null && (!Number.isInteger(NEXT) || NEXT < 1)) usage('--next must be a whole number of 1 or more.');
if (NEXT !== null && (value('--cities') !== undefined || value('--offset') !== undefined)) usage('--next picks its own cities, so it cannot be combined with --cities or --offset.');

const allCities = JSON.parse(fs.readFileSync(citiesFile, 'utf8'));
const excluded = parseStates(value('--exclude-states'));
const excludedLower = new Set(excluded.map((x) => x.toLowerCase()));
const unknown = excluded.filter((x) => !allCities.some((c) => c.state.toLowerCase() === x.toLowerCase()));
if (unknown.length) usage(`No cities in the list for: ${unknown.join(', ')}. Use full state names or two-letter codes.`);
const originalIndex = new Map(allCities.map((c, i) => [`${c.city}|${c.state}`.toLowerCase(), i]));
const cities = allCities.filter((c) => !excludedLower.has(c.state.toLowerCase()));
if (NEXT === null && !cities.slice(OFFSET, OFFSET + COUNT).length) usage(`No cities at offset ${OFFSET}; after exclusions the list has ${cities.length}.`);

// What Manatal's reviewers flagged. Never clone a template that contains it.
const FLAGS = [['commission', /commission/i], ['salary / hourly / wage wording', /\b(salary|salaried|hourly|wages?)\b/i], ['pay figure', /\$\s?\d|\b\d{2,3}\s?k\b|\b(six|seven)[- ]figures?\b/i]];

const { rows: all, count, complete } = await fetchAll('jobs/');
if (!complete) { console.error(`Manatal reports ${count} jobs but the list returned only ${all.length}, so the duplicate check can't be trusted. Refusing to create anything.`); process.exit(1); }

const templates = (sourceIds.length ? all.filter((j) => sourceIds.includes(j.id)) : all.filter((j) => !j.city && !j.state)).sort((a, b) => a.id - b.id);
if (!templates.length) usage('No template jobs found. Templates are the jobs with no city set (or pass --source-ids).');
for (const t of templates) {
  const text = `${t.position_name} ${(t.description || '').replace(/<[^>]+>/g, ' ')}`;
  for (const [kind, re] of FLAGS) if (re.test(text)) { console.error(`Template "${t.position_name}" (${t.id}) contains ${kind}. Fix it before cloning.`); process.exit(1); }
}

// New titles for the templates, if asked. Only the title changes; the approved description is cloned as is.
let newTitle = (t) => t.position_name;
if (titlesFile) {
  const map = JSON.parse(fs.readFileSync(titlesFile, 'utf8'));
  const old = new Set(templates.map((t) => t.position_name));
  const unmapped = [...old].filter((o) => !(o in map));
  const unknown = Object.keys(map).filter((o) => !old.has(o));
  if (unmapped.length || unknown.length) {
    if (unmapped.length) console.error(`No new title for the template(s): ${unmapped.map((x) => `"${x}"`).join(', ')}.`);
    if (unknown.length) console.error(`${titlesFile} lists title(s) that match no template: ${unknown.map((x) => `"${x}"`).join(', ')}.`);
    process.exit(1);
  }
  const news = Object.values(map);
  if (news.some((n) => typeof n !== 'string' || !n.trim()) || new Set(news.map((n) => n.toLowerCase())).size !== news.length) { console.error('Every new title must be non-empty and different from the others.'); process.exit(1); }
  for (const n of news) for (const [kind, re] of FLAGS) if (re.test(n)) { console.error(`New title "${n}" contains ${kind}.`); process.exit(1); }
  newTitle = (t) => map[t.position_name];
}

const placeKey = (city, state) => `${city || ''}|${state || ''}`.toLowerCase();
const hasPosting = new Set(all.filter((j) => j.city).map((j) => placeKey(j.city, j.state)));
const chosen = NEXT !== null ? cities.filter((c) => !hasPosting.has(placeKey(c.city, c.state))).slice(0, NEXT) : cities.slice(OFFSET, OFFSET + COUNT);
if (NEXT !== null && !chosen.length) { console.log(`Every city in ${path.basename(citiesFile)} already has a posting (${cities.length} cities). Add more with --cities-file.`); process.exit(0); }
const plan = [];
for (const c of chosen) {
  if (hasPosting.has(placeKey(c.city, c.state))) continue; // one posting per city, whatever its title
  const t = templates[originalIndex.get(placeKey(c.city, c.state)) % templates.length];
  if (new RegExp(`\\b${c.city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(newTitle(t))) { console.error(`Title "${newTitle(t)}" contains the city ${c.city}. The city belongs in the city field.`); process.exit(1); }
  plan.push({ t, c });
}

console.log(`${templates.length} template(s):`);
for (const t of templates) console.log(`  ${String(t.id).padEnd(9)} ${t.position_name}${newTitle(t) !== t.position_name ? `  ->  ${newTitle(t)}` : ''}`);
if (excluded.length) console.log(`\nExcluding ${excluded.join(', ')}: ${allCities.length - cities.length} cities removed from the list.`);
console.log(`\n${chosen.length} cit${chosen.length === 1 ? 'y' : 'ies'} (${NEXT !== null ? `the next ${NEXT} without a posting` : `list positions ${OFFSET + 1}-${OFFSET + chosen.length}`}); ${chosen.length - plan.length} already have a posting and will be skipped.`);
console.log(`${plan.length} to create${LIVE ? (PUBLISH ? ', PUBLIC immediately' : ' as unpublished drafts') : ''}\n`);
for (const { t, c } of plan.slice(0, 12)) console.log(`  ${(c.city + ', ' + c.state).padEnd(30)} ${newTitle(t)}`);
if (plan.length > 12) console.log(`  …and ${plan.length - 12} more`);
if (!LIVE) { console.log('\nDry run — nothing was created. Add --live to create drafts, --live --publish to go public.'); process.exit(0); }
if (!plan.length) process.exit(0);

const created = [];
for (let i = 0; i < plan.length; i += 5) {
  const results = await Promise.all(plan.slice(i, i + 5).map(async ({ t, c }) => {
    const res = await api('jobs/', {
      method: 'POST',
      body: JSON.stringify({
        organization: t.organization,
        position_name: newTitle(t),
        description: t.description,
        city: c.city,
        state: c.state,
        country: 'United States',
        is_remote: true,
        is_published: PUBLISH,
        contract_details: t.contract_details || 'contractor',
        headcount: 1,
      }),
    });
    if (!res.ok) return { error: `HTTP ${res.status} ${await res.text()}`, label: `${t.position_name} / ${c.city}, ${c.state}` };
    return await res.json();
  }));
  for (const r of results) {
    if (r.error) console.log(`  FAILED  ${r.label}: ${r.error}`);
    else { created.push(r); console.log(`  ok      ${r.position_name} — ${r.city}, ${r.state}`); }
  }
  if (i + 5 < plan.length) await pause(1200);
}
if (PUBLISH) {
  const stillDraft = created.filter((j) => !j.is_published);
  if (stillDraft.length) {
    console.log(`\nManatal created ${stillDraft.length} of them as drafts even though --publish was given; publishing those now…`);
    for (let i = 0; i < stillDraft.length; i += 5) {
      await Promise.all(stillDraft.slice(i, i + 5).map(async (j) => {
        const res = await api(`jobs/${j.id}/`, { method: 'PATCH', body: JSON.stringify({ is_published: true }) });
        if (res.ok) j.is_published = true; else console.log(`  FAILED to publish ${j.id}: HTTP ${res.status}`);
      }));
      if (i + 5 < stillDraft.length) await pause(1200);
    }
  }
}
const livecount = created.filter((j) => j.is_published).length;
console.log(`\n${created.length} of ${plan.length} created; ${livecount} live${livecount < created.length ? `, ${created.length - livecount} still drafts` : ''}.`);
if (created.length) fs.writeFileSync(path.join(ROOT, 'last-run.json'), JSON.stringify(created.map((j) => ({ id: j.id, title: j.position_name, city: j.city, state: j.state, url: j.career_page_url })), null, 2));
console.log('Next: node scripts/audit-manatal.mjs');
process.exit(created.length === plan.length ? 0 : 1);
