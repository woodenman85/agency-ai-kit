#!/usr/bin/env node
// Verifies the Manatal token and prints what the account looks like.
//
//   node scripts/check-manatal.mjs
import { client, die, allJobs } from './manatal.mjs';

const api = client();

try {
  const orgs = await (await api('organizations/?page_size=20')).json();

  console.log('Token works.\n');
  console.log('Organizations (put the right id in config/agency.json as manatal_organization_id):');
  for (const o of orgs.results) console.log(`  ${o.id}  ${o.name}`);

  const jobs = await (await api('jobs/?page_size=1')).json();
  console.log(`\nJobs in this account: ${jobs.count}`);
  if (jobs.results[0]) {
    const slug = (jobs.results[0].career_page_url || '').split('/job/')[0];
    if (slug) console.log(`Careers page: ${slug}`);
  }

  // A working token says nothing about whether the free job board will accept
  // a posting — that is a separate, per-account permission that Trust & Safety
  // can pull without affecting the API at all. Say so, so a green check here is
  // never mistaken for "publishing is fine".
  console.log('\nNote: this only proves the API token works. It does not prove the free job');
  console.log('board will accept a posting — that is a separate account permission.');
  console.log('See reference/job-board-eligibility.md before publishing.');
} catch (err) {
  die(err);
}
