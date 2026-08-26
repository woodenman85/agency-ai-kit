#!/usr/bin/env node
// Verifies the Manatal token and prints what the account looks like.
//
//   node scripts/check-manatal.mjs
import { requireKey } from './env.mjs';
const key = requireKey('MANATAL_API_KEY', 'Get the key in Manatal: Settings -> Integrations -> Open API. It is account-wide, so treat it like a password.');

const api = (p) => fetch(`https://api.manatal.com/open/v3/${p}`, { headers: { Authorization: `Token ${key}` } });

const orgRes = await api('organizations/?page_size=20');
if (orgRes.status === 401 || orgRes.status === 403) {
  console.error(`Token rejected (HTTP ${orgRes.status}). Regenerate the key in Manatal and export it again.`);
  process.exit(1);
}
if (!orgRes.ok) { console.error(`Manatal returned HTTP ${orgRes.status}`); process.exit(1); }
const orgs = await orgRes.json();

console.log('Token works.\n');
console.log('Organizations (put the right id in config/agency.json as manatal_organization_id):');
for (const o of orgs.results) console.log(`  ${o.id}  ${o.name}`);

const jobs = await (await api('jobs/?page_size=1')).json();
console.log(`\nJobs in this account: ${jobs.count}`);
if (jobs.results[0]) {
  const slug = (jobs.results[0].career_page_url || '').split('/job/')[0];
  if (slug) console.log(`Careers page: ${slug}`);
}
