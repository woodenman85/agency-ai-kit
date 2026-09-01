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

/** Every job in the account, following pagination. */
export async function allJobs(api) {
  const out = [];
  for (let page = 1; ; page++) {
    const j = await (await api(`jobs/?page=${page}&page_size=50`)).json();
    out.push(...j.results);
    if (!j.next) return out;
  }
}
