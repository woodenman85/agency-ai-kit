# Job board eligibility

`compliance.md` covers what the law and the carrier will not let you say.
This covers something different and easy to confuse with it: **what the job
boards will not let you post at all**, no matter how it is worded.

A posting can be fully compliant and still be rejected here. The two documents
pull in opposite directions on exactly one point, and that tension is the whole
reason this file exists.

## What happened, so nobody re-derives it

On **2026-09-01** Manatal Trust & Safety restricted this account's **free job
board posting**. One listing was flagged — *"Flexible Schedule Life Insurance
Agent - Remote"* — and the stated reason was one line:

> Commission-only roles are not allowed by the job boards.

What stayed working: the Career Page, all ATS functionality, third-party
integrations, and the API token. Only the free board feed was pulled.

## The conflict, stated plainly

- `compliance.md` **requires** every posting to disclose the 1099
  commission-only structure. The literal string `1099` and a commission word
  are mandatory, and `post-jobs.mjs` refuses to transmit a posting without them.
- The boards **reject the commission-only model itself.**

Both are correct. They cannot both be satisfied on the same channel.

**The resolution is routing, never rewording.** The disclosure is not the
problem and must never be removed, softened, or buried to get past a filter:

1. It is required by `compliance.md` because a recruiting ad that hides the
   compensation model is a misrepresentation on the poster's license.
2. Removing it does not even work. The role is still commission-only. The board
   is rejecting the job, not the sentence, and a listing that conceals it is the
   kind that gets an account terminated rather than restricted.

If a posting cannot go on a channel honestly, it does not go on that channel.

## Where a commission-only 1099 role can go

| Channel | Commission-only? | Notes |
|---|---|---|
| Manatal **free job board** feed | **No** | The restricted one. Do not publish here while the restriction stands. |
| Manatal **Career Page** | Yes | Your own page. Still works under restriction. |
| **Job Board Connect** | Yes | Named in Manatal's email as the supported workaround — post on a board directly, receive applications back into the ATS. |
| Boards posted **directly** | Usually, with disclosure | Most major boards accept commission-only when the pay structure is disclosed plainly. What they reject is a *vague or misleading* one. Confirm per board; policies change. |
| Warp Recruit | Yes | Purpose-built for 1099 commission-only. See its `src/lib/salary.ts`. |

## Earnings figures: the one narrow legitimate path

The instinct when a board wants pay information is to put a range in the ad.
Do not do this in the description body. Ever. `compliance.md` bans income
claims outright, and `post-jobs.mjs` blocks them with no override.

A **substantiated commission estimate** in a *structured, labeled* field is a
different object from a dollar figure in prose, and only some systems can
express it:

- **Warp Recruit can.** `resolveSalary()` carries a `kind` discriminator.
  `commission_estimate` renders as *"Est. $X/year (commission, not
  guaranteed)"* and is deliberately excluded from Google's `baseSalary`, which
  Google defines as *"the actual base salary for the job … not an estimate"*.
- **Manatal cannot.** Its job object has bare `salary_min` / `salary_max` and no
  way to mark them as an estimate. A number there asserts a salary. For a
  commission-only role that is a false compensation claim, so these stay null —
  see `manatal-api.md`.

Two conditions before any estimate is published anywhere:

1. **A written basis.** An actual commission schedule, or actual earnings
   records for real producers, with the production assumptions stated. "What we
   expect" is not a basis; it is the claim restated.
2. **One number, everywhere.** The same substantiated figure on every posting.
   A range that varies per posting is self-evidently not derived from data, and
   the variation is what makes it indefensible.

A floor ("$50,000+") that you can actually support is worth more than a range
whose top you cannot.

## The appeal

Manatal's email asks for four things. Do them in this order:

1. **Review** — `node scripts/post-jobs.mjs --list`, and read every live body,
   not just the flagged one. Appealing while other ineligible listings are live
   gets the appeal rejected and the review reopened.
2. **Correct** — unpublish the flagged listing:
   `PATCH /jobs/{id}/ {"is_published": false}`. Reversible. Never `DELETE` —
   the appeal asks for a job link, and you need the record.
3. **Reply** to the Trust & Safety email describing the corrective action and
   including the updated job link. Say what you actually changed. Do not claim
   the roles are no longer commission-only if they still are.
4. **Wait** for their compliance review before republishing anything to the free
   board.

## Rules

- Never remove or weaken a compensation disclosure to pass a board filter.
- Never populate Manatal `salary_min`/`salary_max` on a commission-only role.
- Never put an earnings figure in description body copy.
- A working API token is not evidence that publishing is allowed. Free job board
  access is a separate account permission and is what gets pulled.
- When a channel and the compliance rules conflict, the channel loses.
