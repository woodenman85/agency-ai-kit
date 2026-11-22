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
// --rotate (with --next N) lets a city come back once it has no LIVE posting. Never-posted cities go
// first, then the cities whose last posting is oldest; each wave is spread across states, shuffled
// with a seed (today's date, or --seed X, so a preview and the live run match), and a reused city gets
// a different title than its last posting. At most one live posting per city, always:
//   node scripts/clone-jobs.mjs --rotate --next 100 --cities-file scripts/cities-all.json --titles-file scripts/titles-2.json --live --publish
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
const ROTATE = has('--rotate');
const SEED = value('--seed') || new Date().toISOString().slice(0, 10);
const sourceIds = (value('--source-ids') || '').split(',').map((s) => s.trim()).filter(Boolean).map(Number);

const usage = (msg) => { console.error(`${msg}\n\nUsage: node scripts/clone-jobs.mjs --cities N [--offset N] [--cities-file path] [--exclude-states "Hawaii,NY"] [--source-ids 1,2,3] [--titles-file path] [--live] [--publish]\n       node scripts/clone-jobs.mjs --next N [--cities-file path] [--titles-file path] [--exclude-states "..."] [--rotate] [--seed text] [--live] [--publish]`); process.exit(1); };
if (!Number.isInteger(COUNT) || COUNT < 1) usage('--cities must be a whole number of 1 or more.');
if (!Number.isInteger(OFFSET) || OFFSET < 0) usage('--offset must be 0 or more.');
if (PUBLISH && !LIVE) usage('--publish only applies with --live.');
if (NEXT !== null && (!Number.isInteger(NEXT) || NEXT < 1)) usage('--next must be a whole number of 1 or more.');
if (ROTATE && NEXT === null) usage('--rotate needs --next N.');
if (NEXT !== null && (value('--cities') !== undefined || value('--offset') !== undefined)) usage('--next picks its own cities, so it cannot be combined with --cities or --offset.');

// Manatal sometimes stores a city under a different name than we sent it (it stored "South Burlington" as
// "Burlington"). Known renames are in scripts/city-aliases.json; any this script notices after creating a job
// are saved to city-aliases.local.json. Each maps "asked city|state" to "stored city|state", so a renamed city
// is recognised as the place it really is and is never posted twice.
const ALIASES = new Map();
for (const f of [path.join(ROOT, 'scripts/city-aliases.json'), path.join(ROOT, 'city-aliases.local.json')]) {
  if (fs.existsSync(f)) for (const [a, b] of Object.entries(JSON.parse(fs.readFileSync(f, 'utf8')))) ALIASES.set(a.toLowerCase(), b.toLowerCase());
}
const canon = (k) => ALIASES.get(k) || k;

const allCities = JSON.parse(fs.readFileSync(citiesFile, 'utf8'));
const excluded = parseStates(value('--exclude-states'));
const excludedLower = new Set(excluded.map((x) => x.toLowerCase()));
const unknown = excluded.filter((x) => !allCities.some((c) => c.state.toLowerCase() === x.toLowerCase()));
if (unknown.length) usage(`No cities in the list for: ${unknown.join(', ')}. Use full state names or two-letter codes.`);
// A city listed twice in the file is used once (its first place), so one run can never post it twice.
const placeId = (c) => canon(`${c.city}|${c.state}`.toLowerCase());
const originalIndex = new Map();
allCities.forEach((c, i) => { if (!originalIndex.has(placeId(c))) originalIndex.set(placeId(c), i); });
const listedTwice = allCities.length - originalIndex.size;
const removedByState = allCities.filter((c) => excludedLower.has(c.state.toLowerCase())).length;
const cities = allCities.filter((c, i) => !excludedLower.has(c.state.toLowerCase()) && originalIndex.get(placeId(c)) === i);
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

const placeKey = (city, state) => canon(`${city || ''}|${state || ''}`.toLowerCase());
const hasPosting = new Set(all.filter((j) => j.city).map((j) => placeKey(j.city, j.state)));

// What each city has had before: is anything live now, when was it last posted, and under what title.
const history = new Map();
for (const j of all) if (j.city) {
  const k = placeKey(j.city, j.state), h = history.get(k) || { live: false, last: 0, lastTitle: '' };
  if (j.is_published) h.live = true;
  const t = Date.parse(j.created_at) || 0;
  if (t >= h.last) { h.last = t; h.lastTitle = j.position_name; }
  history.set(k, h);
}

// Seeded shuffle: the same seed always gives the same order, so a preview matches the live run.
const makeRand = (str) => { let h = 1779033703 ^ str.length; for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); } return () => { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; }; };
const rand = makeRand(SEED);
const shuffle = (a) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
// One city per state per round, states in random order, each state's cities in the order given.
const spread = (list, n) => {
  const byState = new Map();
  for (const c of list) { const k = c.state.toLowerCase(); byState.set(k, [...(byState.get(k) || []), c]); }
  const states = shuffle([...byState.keys()]), out = [];
  while (out.length < n && states.some((k) => byState.get(k).length)) for (const k of states) { if (out.length >= n) break; const q = byState.get(k); if (q.length) out.push(q.shift()); }
  return out;
};

let chosen, rotation = null;
if (ROTATE) {
  const eligible = cities.filter((c) => !history.get(placeKey(c.city, c.state))?.live);
  const never = shuffle(eligible.filter((c) => !history.has(placeKey(c.city, c.state))));
  const before = eligible.filter((c) => history.has(placeKey(c.city, c.state)));
  chosen = spread(never, NEXT);
  const fresh = chosen.length;
  // Reuse the oldest batch first (cities whose last posting went up on the same day are one batch), spread across states.
  const batches = new Map();
  for (const c of before) { const d = Math.floor(history.get(placeKey(c.city, c.state)).last / 86400000); batches.set(d, [...(batches.get(d) || []), c]); }
  for (const d of [...batches.keys()].sort((a, b) => a - b)) {
    if (chosen.length >= NEXT) break;
    chosen.push(...spread(shuffle(batches.get(d)), NEXT - chosen.length));
  }
  rotation = { total: cities.length, live: cities.length - eligible.length, never: never.length, before: before.length, fresh, reused: chosen.length - fresh };
  if (!chosen.length) { console.log(`Every city in ${path.basename(citiesFile)} has a live posting right now (${cities.length} cities). Unpublish some, or add cities with --cities-file.`); process.exit(0); }
} else {
  chosen = NEXT !== null ? cities.filter((c) => !hasPosting.has(placeKey(c.city, c.state))).slice(0, NEXT) : cities.slice(OFFSET, OFFSET + COUNT);
  if (NEXT !== null && !chosen.length) { console.log(`Every city in ${path.basename(citiesFile)} already has a posting (${cities.length} cities). Add more with --cities-file, or use --rotate to reuse cities that are no longer live.`); process.exit(0); }
}

const plan = [];
let ti = Math.floor(rand() * templates.length);
for (const c of chosen) {
  const k = placeKey(c.city, c.state);
  let t;
  if (ROTATE) {
    // next template in turn, but never the title this city last used
    const prev = history.get(k)?.lastTitle || '';
    for (let n = 0; n < templates.length && !t; n++) {
      const cand = templates[(ti + n) % templates.length];
      if (cand.position_name !== prev && newTitle(cand) !== prev) { t = cand; ti += n + 1; }
    }
    if (!t) { t = templates[ti % templates.length]; ti++; }
  } else {
    if (hasPosting.has(k)) continue; // one posting per city, whatever its title
    t = templates[originalIndex.get(k) % templates.length];
  }
  if (new RegExp(`\\b${c.city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(newTitle(t))) { console.error(`Title "${newTitle(t)}" contains the city ${c.city}. The city belongs in the city field.`); process.exit(1); }
  plan.push({ t, c, again: ROTATE && history.has(k) ? history.get(k).last : 0 });
}

console.log(`${templates.length} template(s):`);
for (const t of templates) console.log(`  ${String(t.id).padEnd(9)} ${t.position_name}${newTitle(t) !== t.position_name ? `  ->  ${newTitle(t)}` : ''}`);
if (excluded.length) console.log(`\nExcluding ${excluded.join(', ')}: ${removedByState} cities removed from the list.`);
if (listedTwice) console.log(`\nNote: ${path.basename(citiesFile)} lists ${listedTwice} city entr${listedTwice === 1 ? 'y' : 'ies'} more than once; each city is used once.`);
if (ROTATE) {
  console.log(`\nRotation (seed ${SEED}), ${path.basename(citiesFile)}: ${rotation.live} of ${rotation.total} cities have a live posting now and are skipped; ${rotation.never} never posted; ${rotation.before} posted before but not live.`);
  console.log(`This wave: ${rotation.fresh} first-time cities and ${rotation.reused} reused (oldest-posted first), spread over ${new Set(chosen.map((c) => c.state)).size} states.`);
} else {
  if (NEXT !== null) { const open = cities.filter((c) => !hasPosting.has(placeKey(c.city, c.state))).length; console.log(`\n${cities.length - open} of the ${cities.length} cities in ${path.basename(citiesFile)} already have a posting; ${open} are still open.`); }
  console.log(`\n${chosen.length} cit${chosen.length === 1 ? 'y' : 'ies'} (${NEXT !== null ? `the next ${NEXT} without a posting` : `list positions ${OFFSET + 1}-${OFFSET + chosen.length}`}); ${chosen.length - plan.length} already have a posting and will be skipped.`);
}
console.log(`${plan.length} to create${LIVE ? (PUBLISH ? ', PUBLIC immediately' : ' as unpublished drafts') : ''}\n`);
for (const { t, c, again } of plan.slice(0, 12)) console.log(`  ${(c.city + ', ' + c.state).padEnd(30)} ${newTitle(t)}${again ? `   (reused; last posted ${new Date(again).toISOString().slice(5, 10)})` : ''}`);
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
    const made = await res.json();
    made._asked = { city: c.city, state: c.state };
    return made;
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
// Did Manatal store each city the way we asked? A rename (South Burlington -> Burlington) would hide the city
// from the duplicate check next time, so remember it.
if (created.length) {
  try {
    const after = await fetchAll('jobs/');
    if (after.complete) {
      const byId = new Map(after.rows.map((j) => [j.id, j]));
      const renamed = created.filter((j) => { const stored = byId.get(j.id); return stored && `${stored.city}|${stored.state}`.toLowerCase() !== `${j._asked.city}|${j._asked.state}`.toLowerCase(); });
      if (renamed.length) {
        const file = path.join(ROOT, 'city-aliases.local.json');
        const known = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
        console.log(`\nManatal stored ${renamed.length} cit${renamed.length === 1 ? 'y' : 'ies'} under a different name than we sent (remembered in city-aliases.local.json so they are not posted twice):`);
        for (const j of renamed) {
          const stored = byId.get(j.id);
          console.log(`  ${j._asked.city}, ${j._asked.state}  ->  ${stored.city}, ${stored.state}`);
          known[`${j._asked.city}|${j._asked.state}`.toLowerCase()] = `${stored.city}|${stored.state}`.toLowerCase();
        }
        fs.writeFileSync(file, JSON.stringify(known, null, 2));
      }
    }
  } catch (e) { console.log(`\nCould not check the stored city names (${e.message}).`); }
}
const livecount = created.filter((j) => j.is_published).length;
console.log(`\n${created.length} of ${plan.length} created; ${livecount} live${livecount < created.length ? `, ${created.length - livecount} still drafts` : ''}.`);
if (created.length) fs.writeFileSync(path.join(ROOT, 'last-run.json'), JSON.stringify(created.map((j) => ({ id: j.id, title: j.position_name, city: j.city, state: j.state, url: j.career_page_url })), null, 2));
console.log('Next: node scripts/audit-manatal.mjs');
process.exit(created.length === plan.length ? 0 : 1);
