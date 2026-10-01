// Tests allJobs() against the pagination behaviour observed live on 2026-10-01:
// overlapping rows between pages, and a job missing from a full pass.
// Run: node scripts/manatal.test.mjs
import { allJobs, allJobsWindowed, ManatalError } from './manatal.mjs';

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

// The 2026-10-01 case: two jobs that NO paging pass ever returns, so re-running
// is useless, but which created_at windows do reach.
/** @param {{invisibleToPaging: number[], perSecond: Record<string, number[]>}} spec */
function windowedApi(spec) {
  const calls = { pages: 0, windows: 0 };
  // created_at for every job, so windows can be answered honestly.
  const createdAt = new Map();
  for (const [sec, ids] of Object.entries(spec.perSecond)) {
    for (const id of ids) createdAt.set(id, Date.parse(sec));
  }
  const api = async (path) => {
    const m = path.match(/created_at__gte=([^&]+)&created_at__lte=([^&]+)/);
    if (m) {
      calls.windows++;
      const lo = Date.parse(decodeURIComponent(m[1]));
      const hi = Date.parse(decodeURIComponent(m[2]));
      const size = Number(path.match(/page_size=(\d+)/)[1]);
      const page = Number(path.match(/page=(\d+)/)[1]);
      const inWindow = ALL.filter((j) => {
        const t = createdAt.get(j.id);
        return t != null && t >= lo && t <= hi;
      });
      const slice = inWindow.slice((page - 1) * size, page * size);
      return { json: async () => ({
        count: inWindow.length,
        next: page * size < inWindow.length ? 'x' : null,
        results: slice,
      }) };
    }
    // Plain paging: never returns the invisible ids, no matter how many passes.
    calls.pages++;
    const size = Number(path.match(/page_size=(\d+)/)[1]);
    const page = Number(path.match(/page=(\d+)/)[1]);
    const visible = ALL.filter((j) => !spec.invisibleToPaging.includes(j.id));
    const slice = visible.slice((page - 1) * size, page * size);
    return { json: async () => ({
      count: ALL.length,
      next: page * size < visible.length ? 'x' : null,
      results: slice,
    }) };
  };
  return { api, calls };
}

/** 255 jobs spread over three seconds, two of them invisible to paging. */
const SPEC = {
  invisibleToPaging: [4400007, 4400200],
  perSecond: {
    '2026-09-15T21:14:23Z': ALL.slice(0, 100).map((j) => j.id),
    '2026-09-25T23:43:45Z': ALL.slice(100, 205).map((j) => j.id),
    '2026-09-27T01:25:34Z': ALL.slice(205).map((j) => j.id),
  },
};

console.log('Falls back to created_at windows when paging never closes the gap');
{
  const { api, calls } = windowedApi(SPEC);
  const jobs = await allJobs(api, { maxPasses: 3 });
  check('returns all 255', jobs.length === 255);
  check('no duplicates', new Set(jobs.map((j) => j.id)).size === 255);
  check('includes a job paging never returned', jobs.some((j) => j.id === 4400007));
  check('includes the other one', jobs.some((j) => j.id === 4400200));
  check('it actually used windows', calls.windows > 0);
  check('it tried paging first', calls.pages > 0);
}

console.log('\nWindowed fetching alone reaches every job');
{
  const { api } = windowedApi(SPEC);
  const { jobs, shortfalls } = await allJobsWindowed(api, { now: Date.parse('2026-10-01T00:00:00Z') });
  check('returns all 255', jobs.length === 255);
  check('no window had to be paged', shortfalls.length === 0);
}

console.log('\nA window is split until one page covers it');
{
  // maxLeaf of 40 forces bisection down past the 105-job second.
  const { api, calls } = windowedApi(SPEC);
  const { jobs, shortfalls } = await allJobsWindowed(api, {
    maxLeaf: 40, pageSize: 40, now: Date.parse('2026-10-01T00:00:00Z'),
  });
  check('still returns all 255', jobs.length === 255);
  check('it had to split a good deal', calls.windows > 10);
  // Each of the three seconds holds more than 40 jobs and cannot be split
  // below one second, so each is reported as paged rather than silently taken.
  check('names every second it could not fit in a page', shortfalls.length === 3);
  check('the report says which second', shortfalls.some((s) => s.includes('2026-09-15T21:14:23Z')));
}

console.log('\nStill refuses when neither paging nor windows can close the gap');
{
  // Invisible to paging AND to windows — no created_at, so no window finds it.
  const { api } = windowedApi({
    invisibleToPaging: [4400007],
    perSecond: { '2026-09-15T21:14:23Z': ALL.filter((j) => j.id !== 4400007).map((j) => j.id) },
  });
  let threw = null;
  try { await allJobs(api, { maxPasses: 2 }); } catch (e) { threw = e; }
  check('throws rather than returning a short list', threw instanceof ManatalError);
  check('says how many it got vs how many exist', threw && /254 of 255/.test(threw.message));
  check('explains why continuing would be wrong', threw && /silently skips\s+postings/.test(threw.message));
  check('says windowing was tried too, so re-running is not the advice',
    threw && /created_at windowing/.test(threw.message));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall passed');
process.exit(failures ? 1 : 0);
