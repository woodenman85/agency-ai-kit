# Manatal open API v3

Base: `https://api.manatal.com/open/v3/`
Auth header on every request: `Authorization: Token <MANATAL_API_KEY>`

Get the key in Manatal: **Settings → Integrations → Open API** (or "API"), generate a
key, copy it once. It is account-wide — treat it like a password.

Verified working 2026-08-26: `GET`, `POST`, `PATCH`, and `DELETE` on `/jobs/`.

## Endpoints used here

| Call | Purpose |
|---|---|
| `GET /organizations/` | find your `organization` id — required on every job |
| `GET /jobs/?page_size=50&page=N` | list jobs |
| `POST /jobs/` | create a job |
| `PATCH /jobs/{id}/` | edit a job, publish or unpublish it |
| `DELETE /jobs/{id}/` | permanently delete — no undo |
| `GET /candidates/?job={id}` | applicants for a job |

## Job object

Fields that matter when creating:

```json
{
  "organization": 1234567,
  "position_name": "Final Expense Life Insurance Agent - Remote",
  "description": "<p>…</p>",
  "city": "Portland",
  "state": "Oregon",
  "country": "United States",
  "is_remote": true,
  "is_published": false,
  "contract_details": "contractor",
  "currency": "USD",
  "headcount": 3
}
```

Returned by the server: `id`, `hash`, `career_page_url`
(`https://www.careers-page.com/{slug}/job/{hash}`), `status`, `created_at`.

- `is_published` controls whether it appears on the public careers page. Create with
  `false`, review, then PATCH to `true`.
- Leave `salary_min` / `salary_max` null. A commission-only 1099 role has no salary,
  and populating them creates a compensation claim.
- `contract_details`: use `contractor` for a 1099 role — it is what the live account
  returns, and boards display this field. `full_time` on a 1099 role mislabels it as
  employment. Other values seen in the API docs: `full_time`, `part_time`, `temporary`,
  `internship`.
- Do not put the city in `position_name`. The `city`/`state` fields are what job
  boards read for location.

## Free job-board restriction (Manatal Trust & Safety)

Manatal can distribute published jobs to free job boards. This account's access to that
feed was restricted on 2026-09-01, restored 2026-09-17, and restricted again
2026-09-28. What Manatal support has said, in writing:

- **2026-09-14:** "commission-only roles are not permitted by the free job boards,
  regardless of whether the compensation structure is clearly disclosed… these
  commission-only positions should not be submitted through Manatal's Free Job Boards.
  You can still publish them on your Manatal Career Page."
- **2026-09-28 / 10-02:** flagged "Remote Sales Consultant — First Responders Welcome"
  and quoted the sentence "Compensation is commission-based. No salary or hourly pay is
  provided. Earnings depend on individual production." Support has twice posted a
  screenshot of it showing on the listing. All 13 "First Responders" job records read
  "This is a 1099 independent contractor position. Earnings are based on individual
  production." (checked through the API 2026-10-02), so the screenshot is of something
  the job record does not show — a stale copy, the company profile before it was
  fixed, or somewhere not yet found. Run the audit with `--public` to see the page
  the way a reviewer does.
- Still **unanswered** after three rounds: whether a disclosed 1099, production-based
  role is eligible for the free feed *at all*. The 09-14 reply says the compensation
  *model* is the problem, which means rewording does not fix it.

What follows for this kit:

- Treat editing wording as hygiene, not as the fix. Zero hits on the audit means the
  quoted language is gone; it does not make the role eligible.
- Until Manatal answers yes, these roles belong on the Career Page, Job Board Connect,
  and directly on boards that accept them — the three routes Manatal itself named.
  Do not opt them into the free feed, and never obscure the 1099 / production-based
  structure to get past it.
- Run `node scripts/audit-manatal.mjs` after any batch. It scans every job and the
  **company profile** (shown beside every listing, and the field that was missed for
  three rounds), and refuses to call the scan clean if it fetched fewer jobs than
  Manatal reports.
- Fix text with `node scripts/edit-jobs.mjs` (find and replace in descriptions; reads
  each record back to confirm the edit landed).
- Escalate gently: `node scripts/prune-jobs.mjs --unpublish`, then `--republish` (forces
  a re-render from the current record), and `--delete` only as a last resort. Delete
  backs up the full records first; Manatal has no undo.

## Gotchas

- **The company profile is part of every listing.** `GET /organizations/` →
  `description` renders beside each job on the careers page. A compliance fix that only
  edits jobs leaves it untouched.
- **A list pass can silently skip jobs.** Manatal gives no stable order between pages: a
  255-job account came back as 253 unique jobs, and the two skipped listings went
  unedited through three rounds with support. Always compare what you fetched to `count`.
  `scripts/manatal.mjs` `fetchAll()` re-reads with other page sizes, then falls back to
  reading jobs in `created_at` windows small enough to fit one page (which can't skip
  rows), and says so if it still can't match the count; every script here uses it. A job the list won't return
  can still be read, edited or deleted directly by id (`GET/PATCH/DELETE /jobs/{id}/`).
- **Rate**: batch writes in groups of ~5 with a short pause. Bursts get throttled.
- **Pagination**: use `?page=N&page_size=50`. `offset`/`limit` are silently ignored and
  return page 1 again — trusting them makes it look like you created duplicates. Even
  with `page`, one pass is not guaranteed complete — see the first gotcha above.
- **No outbound webhooks.** Every Manatal integration is pull/token based, so anything
  that syncs applicants to a CRM has to poll on a schedule.
- **Job caps on paid plans.** Trial has no cap; paid tiers do, and the lower tiers cap
  well under 100. Check the cap before subscribing or the excess postings go dark.
- **Duplicate postings** across many cities: job boards filter byte-identical text.
  Localize the opening and closing of each one.
