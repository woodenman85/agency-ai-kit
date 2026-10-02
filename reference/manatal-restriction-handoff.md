# Manatal free job board restriction — handoff

**Written 2026-10-02 ~15:45Z.** Everything below was verified against the
Manatal API, not inferred from a script's output. Timestamps are UTC.

## The situation in one paragraph

Manatal restricted free job board posting on **2026-09-29** (second time; the
first was 2026-09-01, restored 2026-09-17). The stated reason both times:
commission-only roles are not accepted by the job boards. Four rounds of
corrections have been made. The ATS is now clean and uniform. Manatal's support
team is still replying with the same finding, and the most recent reply is a
verbatim duplicate of the previous one sent 27 minutes after our email — which
means the next move is probably **not** another copy edit.

## Verified state of the account

Pulled as two `created_at` windows so every row the API reports was actually
returned (205 + 50 = 255 unique; see "pagination" below for why this matters).

| Check | Result | When |
|---|---|---|
| Jobs in account | 255, all `is_published: true` | 15:09Z |
| "commission" anywhere in any description | **0** | 15:09Z |
| "no salary" / "not a salaried" | **0** | 15:09Z |
| "Earnings depend on individual production" | **0** | 15:09Z |
| Distinct Compensation paragraphs | **1** — all 255 byte-identical | 15:09Z |
| Missing 18+/work-auth line | 0 | 15:09Z |
| Missing NPN 20251128 | 0 | 15:09Z |
| Missing equal-opportunity paragraph | 0 | 15:09Z |
| Pay figures in body | 0 | 15:09Z |
| `salary_min`/`salary_max` populated | 0 | 15:09Z |
| Organization profile clean | yes, fixed 15:08Z | 15:12Z |

The Compensation paragraph on all 255:

> This is a 1099 independent contractor position. Earnings are based on
> individual production.

Organization 8102481 profile now ends:

> Our agents are 1099 independent contractors whose earnings are based on
> individual production; no insurance experience is required to start, and we
> walk new agents through licensing.

**There is one organization in the account.** Verified — not an assumption.

## What Manatal actually said

Thread: `1a0f908e63677ed2`, subject "Request to restore free job board access —
The Wood Agency Life". Support agents seen: Serigne, Thanya, Justin.

Both the 2026-10-02 **04:39Z** and **15:38Z** messages say, identically:

> the job Remote Sales Consultant — First Responders Welcome still carries a
> commission-only structure language: "Compensation is commission-based. No
> salary or hourly pay is provided. Earnings depend on individual production".
> Please kindly ensure this kind of sentence is not mentioned anywhere in your
> jobs posted on the career page.

The 15:38Z message adds a greeting, an inline **screenshot**, and "let us know
once you have completed. We will inform our security team to further review."

That sentence does not exist in any of the 255 descriptions. It is the
*original* September wording, replaced on 2026-09-29.

## The three facts that should drive the next move

1. **The 15:38Z reply is a verbatim duplicate of the 04:39Z reply**, sent 27
   minutes after our 15:11Z email. Nobody re-reviewed 255 listings in 27
   minutes. This reads as a support agent re-sending the open Trust & Safety
   finding, not as a fresh result. Treat the "still carries" claim as **stale,
   not necessarily current**.
2. **There is an inline screenshot in the 15:38Z message that nobody has looked
   at.** It is not retrievable through the Gmail MCP tool (no attachment id —
   it is embedded). Open it in Gmail by eye. Whatever URL, page chrome, or
   board branding is visible in it tells you which surface they are reading.
   **Do this first. It likely ends the investigation.**
3. **The ATS is clean and the career page was never checked.** The career page
   is a separate rendering layer and could be cached. It was unreachable from
   the authoring session (see "environment" below).

## Hypotheses, most to least likely

1. **Support is recycling a stale finding.** Evidence above is strong. Test:
   ask for the date their team performed the review and a direct job URL; ask
   for escalation to Trust & Safety rather than another relay.
2. **The career page or board feed serves a cached copy.** Test: get a real
   career page URL and compare it to the ATS record — see "how to get the
   career page URL". If the public page shows the old text while the API shows
   the new, it is cache, and the fix is a republish, not a rewrite.
3. **A downstream board (Indeed, ZipRecruiter, etc.) still hosts the old copy**
   pushed by the feed in September, and that is what was screenshotted. Same
   test: the screenshot's URL settles it.
4. **The objection is substantive, not textual.** Their policy is about the
   compensation *model*, and these roles genuinely are 1099 production-based
   with no wage. If so, no wording will satisfy it and the answer is routing —
   `reference/job-board-eligibility.md` has the channel table. Test: ask
   plainly whether a disclosed 1099 production-based role is eligible at all.

## How to get the career page URL

The MCP `search_jobs`/`get_job` response does **not** include `hash` or
`career_page_url`. The Open API does — `reference/manatal-api.md` records that
the server returns `career_page_url` in the form
`https://www.careers-page.com/{slug}/job/{hash}`. So:

```
node -e 'import("./scripts/manatal.mjs").then(async ({client})=>{
  const api=client();
  const j=await (await api("jobs/4410630/")).json();
  console.log(j.career_page_url || Object.keys(j).join(", "));
})'
```

Job **4410630** is one of the 13 "First Responders Welcome" listings and is
confirmed clean. The org `website` field is `https://recruit.woodagencylife.com`,
which may be a custom-domain career page.

Then fetch that URL and compare to the ATS text. If they differ, it is cache.

## What has already been done — do not repeat

- `fix-compensation.mjs` — replaced the Compensation block on all 255 (09-29).
- `scrub-commission.mjs` — removed "commission" from the rest of the body;
  `--drop-no-salary` also rewrote the no-salary bullets (10-01).
- `add-eligibility-line.mjs` — "At least 18 years old and legally authorized to
  work in the United States" on all 255 (10-01).
- `add-npn-footer.mjs` — NPN footer on all 255 (10-01).
- `tidy-postings.mjs` — removed a duplicated agency sentence from 2 postings and
  normalized one "role" → "position" (10-02 15:09Z).
- `fix-org-description.mjs` — **the find that mattered.** The organization
  profile said agents are "compensated by commission" and no script had ever
  read `organizations/{id}/`. Fixed 10-02 15:08Z.
- Four emails sent to support@manatal.com. The last one (15:11Z) explains the
  org profile find and asks for a job URL.

**Re-running the posting scripts is wasted effort.** They are all no-ops now;
the account is verified clean. Re-running only churns `updated_at`.

## Hard constraints learned the hard way

- **Pagination is not stable.** The jobs listing returns overlapping and missing
  rows and is not ordered by any stable field. Six full passes returned the same
  253 of 255 every time. `allJobs()` in `scripts/manatal.mjs` now falls back to
  bisecting `created_at` into windows small enough to return in one page, and
  throws rather than proceeding on an incomplete set. **Never trust a single
  pass through `jobs/`.**
- **A 200 on a PATCH is not evidence the account changed.** Three separate runs
  reported success on a posting that never changed. Every write script now
  re-reads the record and checks the stored text.
- **An audit that only reads jobs will declare a dirty account clean.**
  `audit-jobs.mjs` reported "no issues found" while the org profile was dirty.
  It now has an ORGANIZATION PROFILE section. Check every public surface.
- **The Manatal MCP connector is read-only for jobs.** There is no
  `update_job`/`patch_job` tool, only `create_job`. Writes go through the Open
  API with the user's key.
- **Credentials live in the macOS Keychain on Ben's Mac**, not in the repo and
  not in a cloud session. `node scripts/credentials.mjs set NAME`. A cloud
  session cannot write to Manatal at all — it can only read via MCP.
- **Egress blocks in the cloud session:** `api.manatal.com`,
  `www.careers-page.com`, `recruit.woodagencylife.com`. A 403 from the proxy
  looks exactly like a rejected token; `scripts/manatal.mjs` classifies these
  so nobody rotates a working key again.

## Rules that still apply

From `CLAUDE.md` and `reference/job-board-eligibility.md`:

- Never remove or weaken a compensation disclosure to get past a board filter.
  Route the posting instead.
- Never tell Manatal the roles are no longer production-based. They are. Do not
  write anything that implies the business model changed — that is how a
  restriction becomes a termination, and Ben's NPN is on it.
- Never populate `salary_min`/`salary_max` on these roles.
- Never put an earnings figure in body copy.
- Sending or publishing anything needs explicit approval in the conversation.

## Suggested first three actions

1. **Look at the screenshot in the 15:38Z message.** Read any URL in it.
2. **Fetch the career page URL for job 4410630** and diff it against the ATS
   description. Confirms or kills the cache hypothesis in one step.
3. **Reply asking for three specific things**: the job URL their team is
   looking at, the date the review was performed, and a direct yes/no on
   whether a disclosed 1099 production-based contractor role is eligible for
   the free boards at all. Ask for Trust & Safety directly. Do not send another
   "we fixed it" email — that has been sent three times and the ATS has nothing
   left to fix.

If cache is confirmed: toggling `is_published` false→true regenerates a
listing's career page entry. **Try it on one job first**, not all 255, and
verify the public page changes before doing more.

## Unrelated open items

- `config/agency.json` needs `booking_url`:
  `node scripts/set-config.mjs booking_url "https://link.integrityfex.com/widget/bookings/whgiwefhwiph"`
- `sync-applicants.mjs` is not on a schedule. This is what cost the agency its
  strongest candidate: Rebecca Forsythe sat in "New Candidates" for days and
  accepted another offer on 2026-10-01, replying within 6 minutes of finally
  being contacted. 34 other applicants were emailed 2026-10-01 21:12–21:27Z.
- Warp Recruit: the work-authorization line needs wiring through per-agency
  settings, not the shared `ai.ts` prompt — that file serves 14 agencies.
- The Manatal API key was emailed in plaintext to a third party on 2026-08-28.
  Ben has declined to rotate it because other integrations use it. Still a
  live account-wide credential that can read every candidate record.
