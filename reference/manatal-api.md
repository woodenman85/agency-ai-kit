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
  "contract_details": "full_time",
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
- `contract_details` accepts `full_time`, `part_time`, `contract`, `temporary`, `internship`.
- Do not put the city in `position_name`. The `city`/`state` fields are what job
  boards read for location.

## Gotchas

- **Rate**: batch writes in groups of ~5 with a short pause. Bursts get throttled.
- **Pagination**: use `?page=N&page_size=50`. `offset`/`limit` are silently ignored and
  return page 1 again — trusting them makes it look like you created duplicates.
- **No outbound webhooks.** Every Manatal integration is pull/token based, so anything
  that syncs applicants to a CRM has to poll on a schedule.
- **Job caps on paid plans.** Trial has no cap; paid tiers do, and the lower tiers cap
  well under 100. Check the cap before subscribing or the excess postings go dark.
- **Duplicate postings** across many cities: job boards filter byte-identical text.
  Localize the opening and closing of each one.
