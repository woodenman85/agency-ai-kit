// Shared Manatal API helpers for the scripts in this folder.
import { requireKey } from './env.mjs';

export const key = requireKey('MANATAL_API_KEY', 'Get the key in Manatal: Settings -> Integrations -> Open API. It is account-wide, so treat it like a password.');
const BASE = process.env.MANATAL_API_BASE || 'https://api.manatal.com/open/v3/';

export const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * fetch against the Manatal API. Manatal throttles bursts with HTTP 429 ("Expected available in
 * 1 second"); a 429 means the request was not processed, so it is always safe to wait and retry.
 */
export async function api(p, init = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${BASE}${p}`, {
      ...init,
      headers: { Authorization: `Token ${key}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
    });
    if (res.status !== 429 || attempt >= 8) return res;
    const body = await res.clone().text();
    const secs = Number(res.headers.get('retry-after')) || Number((body.match(/available in (\d+)/i) || [])[1]) || 1;
    await pause((secs + 0.5) * 1000);
  }
}

/**
 * Every row of a list endpoint, merged by id.
 *
 * Manatal does not promise a stable order between pages, so a multi-page read can skip rows and
 * repeat others — an account of 255 jobs came back as 253, then 254, unique ones, which is how
 * listings went unedited through three rounds with Manatal support. So:
 *   1. read the list at a few page sizes and merge;
 *   2. if still short, read jobs in created_at windows, splitting each window until it fits on a
 *      single page. A one-page response has no page boundary to skip across, so it is complete
 *      whatever order Manatal returns it in.
 *
 * `complete` is false if we still hold fewer rows than Manatal says exist. Do not treat an
 * incomplete list as the whole account.
 */
export async function fetchAll(endpoint) {
  const byId = new Map();
  let count = null;
  for (const size of [50, 20, 100, 10]) {
    for (let page = 1; ; page++) {
      const res = await api(`${endpoint}?page=${page}&page_size=${size}`);
      if (!res.ok) {
        if (page === 1 && size !== 50) break; // this page size isn't accepted; try the next one
        throw new Error(`GET ${endpoint} page ${page}: HTTP ${res.status}`);
      }
      const j = await res.json();
      count = j.count ?? count;
      for (const r of j.results) byId.set(r.id, r);
      if (!j.next) break;
      await pause(150);
    }
    if (count == null || byId.size >= count) break;
  }
  if (count != null && byId.size < count && endpoint === 'jobs/') await readByWindows(endpoint, 'created_at', byId);
  const rows = [...byId.values()];
  return { rows, count: count ?? rows.length, complete: count == null || rows.length >= count };
}

const PAGE = 50;

/** Merge every row of `endpoint` into `byId` by bisecting `field` (a datetime filter) into single-page windows. */
async function readByWindows(endpoint, field, byId) {
  let budget = 150; // requests; stops a filter Manatal ignores from recursing forever
  const iso = (ms) => new Date(ms).toISOString();
  const query = (lo, hi, page) => `${endpoint}?${field}__gte=${encodeURIComponent(iso(lo))}&${field}__lte=${encodeURIComponent(iso(hi))}&page=${page}&page_size=${PAGE}`;

  async function window(lo, hi) {
    if (budget-- <= 0) return;
    const res = await api(query(lo, hi, 1));
    if (!res.ok) return;
    const j = await res.json();
    if (!j.count) return;
    if (j.count <= j.results.length) { for (const r of j.results) byId.set(r.id, r); return; }
    if (hi - lo < 2) { // can't split further: page through what is there
      for (const r of j.results) byId.set(r.id, r);
      for (let page = 2, more = j.next; more && budget-- > 0; page++) {
        const next = await (await api(query(lo, hi, page))).json();
        for (const r of next.results) byId.set(r.id, r);
        more = next.next;
      }
      return;
    }
    // Split where the rows actually are: the median of this page's sample, else the midpoint.
    const sample = j.results.map((r) => Date.parse(r[field])).filter(Number.isFinite).sort((a, b) => a - b);
    let mid = sample.length ? sample[Math.floor(sample.length / 2)] : Math.floor((lo + hi) / 2);
    if (mid <= lo || mid >= hi) mid = Math.floor((lo + hi) / 2);
    await pause(100);
    await window(lo, mid);
    await window(mid, hi); // inclusive on both sides: a job exactly at mid is seen twice, never missed
  }

  await window(Date.UTC(2020, 0, 1), Date.now() + 86400000);
}
