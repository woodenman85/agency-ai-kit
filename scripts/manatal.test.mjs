// Tests allJobs() against the pagination behaviour observed live on 2026-10-01:
// overlapping rows between pages, and a job missing from a full pass.
// Run: node scripts/manatal.test.mjs
import { allJobs, ManatalError } from './manatal.mjs';

let failures = 0;
const check = (label, cond) => {
  console.log(`  ${cond ? 'pass' : 'FAIL'}  ${label}`);
  if (!cond) failures++;
};

const ALL = Array.from({ length: 255 }, (_, i) => ({ id: 4400000 + i }));

/** A fake API whose pages overlap and drop rows differently on each pass —
 *  the real behaviour, not a tidy version of it. */
function flakyApi({ dropPerPass = [1], pageSize = 50 }) {
  let pass = -1;
  let page = 0;
  const calls = { pages: 0 };
  return {
    calls,
    api: async (path) => {
      const n = Number(path.match(/page=(\d+)/)[1]);
      if (n === 1) { pass++; page = 0; }
      page = n;
      calls.pages++;
      // Each pass hides a different job and duplicates another.
      const hide = dropPerPass[Math.min(pass, dropPerPass.length - 1)];
      const visible = ALL.filter((j) => j.id !== 4400000 + hide);
      const start = (n - 1) * pageSize;
      const slice = visible.slice(start, start + pageSize);
      // Duplicate the first row of each page onto the previous one's tail,
      // which is what produced 255 rows for 254 distinct ids.
      if (slice.length && start > 0) slice.unshift(visible[start - 1]);
      const hasNext = start + pageSize < visible.length;
      return { json: async () => ({ count: ALL.length, next: hasNext ? 'x' : null, results: slice }) };
    },
  };
}

console.log('Recovers jobs that a single pass misses');
{
  // Pass 1 hides job #1, pass 2 hides #2 — so the union is complete.
  const { api, calls } = flakyApi({ dropPerPass: [1, 2] });
  const jobs = await allJobs(api);
  check('returns every job', jobs.length === 255);
  check('returns no duplicates', new Set(jobs.map((j) => j.id)).size === 255);
  check('includes the job missing from pass 1', jobs.some((j) => j.id === 4400001));
  check('took more than one pass', calls.pages > 6);
}

console.log('Stops as soon as the set is complete');
{
  const { api, calls } = flakyApi({ dropPerPass: [] });
  const jobs = await allJobs(api);
  check('returns every job', jobs.length === 255);
  const onePass = Math.ceil(255 / 50);
  check('does not keep re-paging once complete', calls.pages <= onePass + 1);
}

console.log('Refuses to return an incomplete set');
{
  // The same job is missing on every pass, so the gap never closes.
  const { api } = flakyApi({ dropPerPass: [7] });
  let threw = null;
  try { await allJobs(api, { maxPasses: 2 }); } catch (e) { threw = e; }
  check('throws rather than returning a short list', threw instanceof ManatalError);
  check('says how many it got vs how many exist', threw && /254 of 255/.test(threw.message));
  check('explains why continuing would be wrong', threw && /silently skips postings/.test(threw.message));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall passed');
process.exit(failures ? 1 : 0);
