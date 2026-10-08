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
feed was restricted on 2026-09-01, restored 2026-09-17, restricted again
2026-09-28, and restored again 2026-10-05 with no conditions and no answer to the
eligibility question below. What Manatal support has said, in writing:

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
- Access is back, but nothing says it is permanent, so it can be pulled again. Post only
  the reviewed templates' wording (bodies unchanged; titles may vary, see
  `scripts/titles-2.json`), never obscure the 1099 structure to get past review, and if
  access is restricted again, stop posting new waves until Manatal says why.
- `is_published` only puts a job on the Career Page. Per Manatal's help pages (read as search
  excerpts on 2026-10-08, not the pages themselves), free boards are a separate switch: an Admin
  enables each board under Administration → Job Boards → View Free Job Boards, then each job is
  sent from its Sourcing → Job Boards tab (Indeed is the exception: all-in or all-out for every
  career-page job). Listings can take up to 48 hours, and a board may decline a job that
  qualifies. None of this is done by these scripts. The API does not expose it: the job object
  (checked with `status-manatal.mjs` on 2026-10-08) has no board or distribution field, and the
  developer docs list no job-board endpoint, so free-board status is only visible in Manatal's
  web app. Free boards rarely report back to the ATS, so applicants are the only signal. When a
  board is enabled, Manatal offers to send all current career-page jobs to it; later jobs are
  sent one at a time from Sourcing → Job Boards (no bulk option documented for an enabled board).
- UNVERIFIED, check before cloning more city postings: one search excerpt of Manatal's Trust &
  Safety policy says a remote role cannot be listed under a city, and that "always hiring" and
  multi-position posts are barred; a second search could not find that rule. Read the policy page
  itself (support.manatal.com/docs/manatal-trust-safety-policy).
- Run `node scripts/audit-manatal.mjs` after any batch. It scans every job and the
  **company profile** (shown beside every listing, and the field that was missed for
  three rounds), and refuses to call the scan clean if it fetched fewer jobs than
  Manatal reports.
- Roll the reviewed templates out to more cities with `node scripts/clone-jobs.mjs` (word for
  word; only the city and state fields change, so nothing new needs review). Dry run first.
  One posting per city; `--exclude-states` skips states. For a regular wave, use `--next N`
  (the next N cities in the list that have no posting yet), `--cities-file scripts/cities-2.json`
  (100 more cities, in random order, none in HI/AK/NY) and `--titles-file scripts/titles-2.json`
  (new titles on the same approved bodies). Manatal can create a job as a draft
  even when `is_published: true` is sent, so clone-jobs publishes those in a second step.
  Clean up with `prune-jobs --duplicate-cities`, `--in-states`, `--clone-drafts`, `--publish`.
- Fix text with `node scripts/edit-jobs.mjs` (find and replace in descriptions; reads
  each record back to confirm the edit landed). The company profile has its own tool,
  `node scripts/edit-organization.mjs`, same dry-run-first behaviour.
- Escalate gently: `node scripts/prune-jobs.mjs --unpublish`, then `--republish` (forces
  a re-render from the current record), and `--delete` only as a last resort. Delete
  backs up the full records first (Manatal has no undo) and refuses jobs that have
  applicants. As of 2026-10-04 there are 39 applicants (all via ZipRecruiter on the free
  feed, all at "New Candidates") attached to 23 jobs.

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
