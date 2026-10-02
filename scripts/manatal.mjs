// Shared Manatal API helpers for the scripts in this folder.
import { requireKey } from './env.mjs';

export const key = requireKey('MANATAL_API_KEY', 'Get the key in Manatal: Settings -> Integrations -> Open API. It is account-wide, so treat it like a password.');
const BASE = process.env.MANATAL_API_BASE || 'https://api.manatal.com/open/v3/';

export const api = (p, init = {}) => fetch(`${BASE}${p}`, {
  ...init,
  headers: { Authorization: `Token ${key}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
});

export const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Every row of a list endpoint, merged by id.
 *
 * Manatal does not promise a stable order between pages, so a single pass can skip rows and
 * repeat others — an account of 255 jobs came back as 253 unique ones, which is how listings
 * went unedited through three rounds with Manatal support. When a pass comes up short we go
 * again with a different page size and merge, until we hold as many rows as Manatal says exist.
 *
 * `complete` is false if we never got there. Do not treat an incomplete list as the whole account.
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
    }
    if (count == null || byId.size >= count) break;
  }
  const rows = [...byId.values()];
  return { rows, count: count ?? rows.length, complete: count == null || rows.length >= count };
}
