#!/usr/bin/env node
// Clone the reviewed template postings to more cities, word for word. Dry run unless --live.
//
//   node scripts/clone-jobs.mjs --cities 50                    # dry run: show what would be created
//   node scripts/clone-jobs.mjs --cities 50 --live             # create them as unpublished drafts
//   node scripts/clone-jobs.mjs --cities 50 --live --publish   # create them and make them public
//   node scripts/clone-jobs.mjs --cities 50 --offset 50 --live --publish   # the next 50 cities
//   node scripts/clone-jobs.mjs --cities 50 --exclude-states "Hawaii,NY,AK"   # skip states you don't want
//
// --exclude-states takes full names or two-letter codes. States are removed from the list BEFORE
// --cities and --offset are counted, so you still get the number of postings you asked for. Use the
// same --exclude-states on every wave so --offset keeps lining up.

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

const argv = process.argv.slice(2);
const has = (n) => argv.includes(n);
const value = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const LIVE = has('--live');
const PUBLISH = has('--publish');
const COUNT = Number(value('--cities') || 50);
const OFFSET = Number(value('--offset') || 0);
const citiesFile = value('--cities-file') || path.join(ROOT, 'scripts/cities.json');
const excludeRaw = (value('--exclude-states') || '').split(',').map((x) => x.trim()).filter(Boolean);
const sourceIds = (value('--source-ids') || '').split(',').map((s) => s.trim()).filter(Boolean).map(Number);

const usage = (msg) => { console.error(`${msg}\n\nUsage: node scripts/clone-jobs.mjs --cities N [--offset N] [--cities-file path] [--exclude-states "Hawaii,NY"] [--source-ids 1,2,3] [--live] [--publish]`); process.exit(1); };
if (!Number.isInteger(COUNT) || COUNT < 1) usage('--cities must be a whole number of 1 or more.');
if (!Number.isInteger(OFFSET) || OFFSET < 0) usage('--offset must be 0 or more.');
if (PUBLISH && !LIVE) usage('--publish only applies with --live.');

const ABBR = { AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming' };
const allCities = JSON.parse(fs.readFileSync(citiesFile, 'utf8'));
const excluded = excludeRaw.map((x) => ABBR[x.toUpperCase()] || x);
const excludedLower = new Set(excluded.map((x) => x.toLowerCase()));
const unknown = excluded.filter((x) => !allCities.some((c) => c.state.toLowerCase() === x.toLowerCase()));
if (unknown.length) usage(`No cities in the list for: ${unknown.join(', ')}. Use full state names or two-letter codes.`);
const originalIndex = new Map(allCities.map((c, i) => [`${c.city}|${c.state}`.toLowerCase(), i]));
const cities = allCities.filter((c) => !excludedLower.has(c.state.toLowerCase()));
const chosen = cities.slice(OFFSET, OFFSET + COUNT);
if (!chosen.length) usage(`No cities at offset ${OFFSET}; after exclusions the list has ${cities.length}.`);

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

const placeKey = (city, state) => `${city || ''}|${state || ''}`.toLowerCase();
const hasPosting = new Set(all.filter((j) => j.city).map((j) => placeKey(j.city, j.state)));
const plan = [];
for (const c of chosen) {
  if (hasPosting.has(placeKey(c.city, c.state))) continue; // one posting per city, whatever its title
  plan.push({ t: templates[originalIndex.get(placeKey(c.city, c.state)) % templates.length], c });
}

console.log(`${templates.length} template(s):`);
for (const t of templates) console.log(`  ${String(t.id).padEnd(9)} ${t.position_name}`);
if (excluded.length) console.log(`\nExcluding ${excluded.join(', ')}: ${allCities.length - cities.length} cities removed from the list.`);
console.log(`\n${chosen.length} cit${chosen.length === 1 ? 'y' : 'ies'} (list positions ${OFFSET + 1}-${OFFSET + chosen.length}); ${chosen.length - plan.length} already have a posting and will be skipped.`);
console.log(`${plan.length} to create${LIVE ? (PUBLISH ? ', PUBLIC immediately' : ' as unpublished drafts') : ''}\n`);
for (const { t, c } of plan.slice(0, 12)) console.log(`  ${(c.city + ', ' + c.state).padEnd(30)} ${t.position_name}`);
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
        position_name: t.position_name,
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
