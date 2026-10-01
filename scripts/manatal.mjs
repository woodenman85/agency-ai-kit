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

/** Every job in the account.
 *
 *  Manatal's pagination is not stable. Verified 2026-10-01: three pages of 100
 *  returned 255 rows for a reported count of 255, but only 254 DISTINCT ids —
 *  one job appeared on two pages and one was never returned at all. The rows
 *  are not ordered by updated_at, created_at or id, so a page boundary can
 *  land anywhere between calls.
 *
 *  This was behind every "straggler" in the 2026-09-29 posting rewrites. Each
 *  run reported more jobs changed than the account later showed as changed, and
 *  it looked like writes silently failing. They were not. The jobs were never
 *  fetched, so they were never sent. A script that trusts one pass through this
 *  endpoint quietly edits a subset and reports success.
 *
 *  So: collect by id, and keep re-paging until the number of distinct jobs
 *  matches the count the API itself reports. Repeated passes see different
 *  arbitrary slices, so the gaps fill in quickly. Throwing when they do not is
 *  deliberate — a caller that is about to rewrite every posting in the account
 *  must not proceed on a set it knows is incomplete. */
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

  if (reported != null && byId.size < reported) {
    throw new ManatalError(
      'incomplete_listing',
      0,
      `Could only retrieve ${byId.size} of ${reported} jobs after ${maxPasses} passes.\n\n` +
        "Manatal's job pagination returns overlapping and missing rows, and this many\n" +
        'passes should normally close the gap. Refusing to continue: a bulk edit run on\n' +
        'an incomplete list silently skips postings and reports success.\n\n' +
        'Re-run in a minute. If it keeps happening, something changed on their side.',
    );
  }

  return [...byId.values()];
}
