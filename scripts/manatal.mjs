// Shared Manatal API client.
//
// Exists because the scripts used to read any 401/403 as "your token is bad".
// That is wrong often enough to be harmful: on 2026-09-01 a corporate egress
// proxy answered 403 to the CONNECT, check-manatal.mjs printed "Token rejected.
// Regenerate the key", and the honest next step would have been to rotate a
// perfectly good account-wide key and still not be able to reach the API.
//
// A 403 from Manatal is also NOT the same thing as a 401. Manatal restricts
// individual features — free job board posting is the one that gets pulled for
// Trust & Safety reasons — while leaving the token valid for everything else.
// Telling someone in that state to regenerate their key sends them to fix the
// one thing that isn't broken.
//
// So: classify, never guess. Each failure mode gets the action that actually
// resolves it.
import { requireKey } from './env.mjs';

const BASE = 'https://api.manatal.com/open/v3/';

export function client() {
  const key = requireKey(
    'MANATAL_API_KEY',
    'Get the key in Manatal: Settings -> Integrations -> Open API. It is account-wide — it can read every candidate in the ATS and create jobs — so treat it like a password and never paste it into an email or a support ticket.',
  );

  return async function api(path, init = {}) {
    let res;
    try {
      res = await fetch(BASE + path, {
        ...init,
        headers: { Authorization: `Token ${key}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
      });
    } catch (cause) {
      // Never reached Manatal at all: no DNS, no route, TLS refused, or a
      // proxy that rejected the CONNECT. Nothing about the key is implicated.
      throw new ManatalError('unreachable', 0,
        `Could not reach api.manatal.com at all (${cause?.cause?.code || cause?.message || 'network error'}).\n` +
        'This is a network problem, NOT a bad key — do not regenerate anything.\n' +
        'Check for a VPN, firewall, or corporate/agent egress proxy blocking api.manatal.com.', cause);
    }
    if (res.ok) return res;

    const body = await res.text().catch(() => '');
    throw ManatalError.fromResponse(res.status, body);
  };
}

export class ManatalError extends Error {
  constructor(kind, status, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'ManatalError';
    this.kind = kind;
    this.status = status;
  }

  static fromResponse(status, body) {
    const snippet = (body || '').trim().slice(0, 300);
    const detail = snippet ? `\n\nManatal said: ${snippet}` : '';

    if (status === 401) {
      return new ManatalError('unauthorized', status,
        'Manatal rejected the token (HTTP 401). This one really is the key: it is wrong, revoked, or ' +
        'was regenerated. Get a fresh one in Settings -> Integrations -> Open API and put it in .env.' + detail);
    }
    if (status === 403) {
      // The interesting case. The token authenticated; the ACCOUNT or the
      // feature said no. Free-job-board restrictions land here.
      return new ManatalError('forbidden', status,
        'Manatal authenticated the token but refused the request (HTTP 403).\n' +
        'This is usually NOT a bad key — regenerating it will not help. Common causes:\n' +
        '  - the account has a feature restriction (e.g. free job board posting suspended\n' +
        '    for a Trust & Safety review — see reference/job-board-eligibility.md)\n' +
        '  - the token lacks permission for this endpoint\n' +
        '  - an egress proxy answered 403 before the request left the network\n' +
        'Check the account status in the Manatal UI before touching the key.' + detail);
    }
    if (status === 429) {
      return new ManatalError('rate_limited', status,
        'Rate limited by Manatal (HTTP 429). Wait and re-run; do not retry in a tight loop.' + detail);
    }
    if (status >= 500) {
      return new ManatalError('server_error', status,
        `Manatal server error (HTTP ${status}). This is on their end — re-run later.` + detail);
    }
    return new ManatalError('http_error', status, `Manatal returned HTTP ${status}.` + detail);
  }
}

/** Print a ManatalError the way a human needs to read it, then exit non-zero. */
export function die(err) {
  if (err instanceof ManatalError) {
    console.error(`\n${err.message}\n`);
    process.exit(1);
  }
  throw err;
}

/** One second, in milliseconds. Manatal's date filters take second precision
 *  (YYYY-MM-DDTHH:MM:SSZ), so that is the finest a window can be sliced. */
const SECOND = 1000;

const isoSecond = (ms) => new Date(Math.floor(ms / SECOND) * SECOND).toISOString().replace(/\.\d{3}Z$/, 'Z');

/** One created_at window, requested as a single page. */
async function fetchWindow(api, loMs, hiMs, pageSize, page = 1) {
  const qs =
    `created_at__gte=${encodeURIComponent(isoSecond(loMs))}` +
    `&created_at__lte=${encodeURIComponent(isoSecond(hiMs))}` +
    `&page=${page}&page_size=${pageSize}`;
  const j = await (await api(`jobs/?${qs}`)).json();
  return {
    count: typeof j.count === 'number' ? j.count : null,
    results: j.results ?? [],
    next: j.next ?? null,
  };
}

/** Every job, fetched in created_at windows instead of by paging the whole set.
 *
 *  Paging is where rows get lost: the listing is not ordered by any stable
 *  field, so a page boundary lands somewhere different on each request and rows
 *  near it are duplicated or skipped. Verified 2026-10-01 — six full passes of
 *  fifty returned the same 253 of 255 every time, so it is not transient and
 *  re-running does not help.
 *
 *  A window narrow enough to come back in ONE page has no boundary to lose rows
 *  at. So: bisect on created_at until a window's reported count fits in a single
 *  page, then require that the page actually return every row it says exist.
 *  That equality check per window is the guarantee — a short page splits further
 *  rather than being accepted.
 *
 *  The same date filters confirmed the account really does hold 255 jobs
 *  (205 created on or before 2026-09-26 plus 50 after), so the gap was the
 *  listing losing rows, not a count that disagreed with reality. */
export async function allJobsWindowed(api, { pageSize = 250, maxLeaf = 200, now = Date.now() } = {}) {
  const byId = new Map();
  const shortfalls = [];
  let calls = 0;

  async function walk(lo, hi, depth) {
    const w = await fetchWindow(api, lo, hi, pageSize);
    calls++;
    if (w.count === 0) return;

    const splittable = hi - lo > SECOND && depth < 64;

    // A window we can take whole: it must hand back everything it claims.
    if (w.count != null && w.count <= maxLeaf && w.results.length >= w.count) {
      for (const job of w.results) byId.set(job.id, job);
      return;
    }

    if (splittable) {
      const mid = lo + Math.floor((hi - lo) / 2 / SECOND) * SECOND;
      await walk(lo, mid, depth + 1);
      await walk(mid + SECOND, hi, depth + 1);
      return;
    }

    // A single second holding more rows than one page can carry. Page through
    // it — the only case where boundaries are unavoidable — and say so.
    for (const job of w.results) byId.set(job.id, job);
    let page = 1;
    let next = w.next;
    while (next) {
      const more = await fetchWindow(api, lo, hi, pageSize, ++page);
      calls++;
      for (const job of more.results) byId.set(job.id, job);
      next = more.next;
      if (page > 50) break;
    }
    if (w.count != null) {
      shortfalls.push(`${isoSecond(lo)} holds ${w.count} jobs — more than one page, so this second was paged`);
    }
  }

  await walk(Date.UTC(2000, 0, 1), now + 86_400_000, 0);
  return { jobs: [...byId.values()], shortfalls, calls };
}

/** Every job in the account.
 *
 *  Manatal's job listing is not stably ordered, so a page boundary lands
 *  somewhere different on every request and rows near it get duplicated or
 *  dropped. Verified 2026-10-01: three pages of 100 returned 255 rows for a
 *  reported count of 255 but only 254 distinct ids.
 *
 *  This was behind every "straggler" in the 2026-09-29 posting rewrites. Each
 *  run reported more jobs changed than the account later showed as changed, and
 *  it looked like writes silently failing. They were not. The jobs were never
 *  fetched, so they were never sent. A script that trusts one pass through this
 *  endpoint quietly edits a subset and reports success.
 *
 *  Re-paging was the first fix, on the assumption that fresh arbitrary slices
 *  would fill the gaps in. Usually they do. They are not guaranteed to: later
 *  the same day, six passes returned the same 253 of 255 every single time, so
 *  two postings were simply never in any slice and "re-run in a minute" was
 *  useless advice. Hence the second stage — allJobsWindowed(), which asks for
 *  created_at ranges small enough to come back in one page and so has no
 *  boundary to lose rows at.
 *
 *  Throwing when both stages come up short is deliberate: a caller about to
 *  rewrite every posting in the account must not proceed on a set it knows is
 *  incomplete. */
export async function allJobs(api, { maxPasses = 6, pageSize = 50 } = {}) {
  const byId = new Map();
  let reported = null;

  for (let pass = 1; pass <= maxPasses; pass++) {
    for (let page = 1; ; page++) {
      const j = await (await api(`jobs/?page=${page}&page_size=${pageSize}`)).json();
      if (typeof j.count === 'number') reported = j.count;
      for (const job of j.results ?? []) byId.set(job.id, job);
      if (!j.next) break;
    }
    if (reported == null || byId.size >= reported) break;
  }

  if (reported == null || byId.size >= reported) return [...byId.values()];

  // Paging could not close the gap, and on 2026-10-01 it never did: six passes
  // returned the same 253 of 255 every time. Window fetching has no page
  // boundaries to lose rows at, so fall back to it rather than telling the
  // caller to re-run something that is deterministic.
  const windowed = await allJobsWindowed(api);
  for (const job of windowed.jobs) byId.set(job.id, job);

  if (byId.size >= reported) return [...byId.values()];

  throw new ManatalError(
    'incomplete_listing',
    0,
    `Could only retrieve ${byId.size} of ${reported} jobs.\n\n` +
      `Tried ${maxPasses} full paging passes and then created_at windowing, which does not\n` +
      'depend on page boundaries. Both came up short, so this is not the usual\n' +
      'pagination flakiness.\n\n' +
      'Refusing to continue: a bulk edit run on an incomplete list silently skips\n' +
      'postings and reports success.\n\n' +
      (windowed.shortfalls.length
        ? `Windows that had to be paged:\n${windowed.shortfalls.map((s) => `  ${s}`).join('\n')}\n\n`
        : '') +
      'Run `node scripts/audit-jobs.mjs` to see what was reachable, and tell Claude\n' +
      'the numbers — the gap needs naming before anything is written.',
  );
}
