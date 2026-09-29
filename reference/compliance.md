# Compliance

An insurance recruiting post is regulated advertising. The person whose NPN is on it
carries the risk, not the tool that wrote it. When in doubt, leave it out.

## Never, under any phrasing

- **Income claims.** No typical earnings, average commission per family, first-year
  income, income ranges, "six figures", or any number a candidate could read as
  expected pay. This includes indirect versions: "your income is tied to your effort",
  "no ceiling", "you don't get paid what you're worth", "escape the pay band".
- **Guarantees.** No guaranteed income, guaranteed leads, guaranteed appointments,
  guaranteed placement, or guaranteed approval.
- **Employment language.** These are 1099 independent contractors. Never "salary",
  "hourly", "benefits package", "W-2", "employee", "paid training" unless the agency
  genuinely pays for something and it is listed in `config/agency.json`.
- **Production benchmarks** (families helped per week, appointments, close rates)
  unless they are supplied as verified facts. If supplied: attribute them accurately
  to established agents, say individual results vary, and never use them to imply
  earnings.
- **Free leads** unless the agency actually supplies leads at no cost. "Warm leads",
  "no cold calling", and "leads provided" are all factual claims about the business
  model and must be true.
- **Protected-class filters.** No age, sex, religion, national origin, disability,
  marital, or family-status preferences — including soft versions like "young
  go-getters" or "recent grads".

  **Work authorization is not one of these, and the distinction matters.** Every
  posting carries, as the first bullet of its requirements list:

  > Legally authorized to work in the United States

  That is lawful and belongs there. It describes **eligibility to do the job** —
  the role requires a state insurance producer licence, which requires US work
  authorization — and it applies identically to every applicant. It says nothing
  about where anyone is from.

  What would cross the line is filtering on the things that merely *correlate*
  with origin: a foreign phone number, a name, an accent, a degree from abroad,
  a country on a résumé. Those are proxies for national origin, and using them is
  the violation this rule exists to prevent, whatever the intent behind it.

  So the test is the stated criterion, not the outcome. "Not authorized to work
  in the US" is a reason. "Has a +254 number" is not — it is a guess about
  someone's status, and the way to resolve it is to ask them.

  The same holds when dispositioning applicants, not only when writing ads. A
  candidate removed for this reason gets it recorded plainly as the licensing and
  work-authorization requirement. Never "cultural fit" — on a candidate whose
  only distinguishing feature in the file is being foreign, that label is the
  accusation, written down in your own system.
- **Carrier or product claims.** Do not name specific policy features, rates, or
  "tax-free" anything in a recruiting post. It is a job posting, not a sales piece.

## Always

- State the 1099 independent-contractor structure explicitly in the body. The
  literal string `1099` must appear — job-board validators match that token.

  **This rule used to require an explicit commission word, and no longer does.**
  Manatal restricted this account twice (2026-09-01 and 2026-09-29) because
  commission-only roles are non-compliant with their Job Posting Trust & Safety
  Policy, and the first attempt to satisfy it — swapping "commission-only" for
  "commission-based" — was flagged anyway. On 2026-09-29 the compensation line
  across all 255 Manatal postings became:

  > This is a 1099 independent contractor position. Earnings are based on
  > individual production.

  Both sentences are true. Note what it no longer does: state that the role pays
  no salary. Someone who knows "1099 independent contractor" means no wage will
  infer it; a career changer may not. That was the agency owner's call, made
  explicitly. If a candidate is ever surprised to learn there is no base pay,
  this line is why, and it should be revisited.
- State that a state life insurance license is required before selling, and that
  licensing timelines vary by state.
- Include the work-authorization requirement as the first bullet of the
  requirements list: **"Legally authorized to work in the United States."** See
  the protected-class note above for why this is an eligibility requirement and
  not a national-origin filter.
- State that the role is 100% remote if it is. Google for Jobs requires the
  disclosure to index it as remote.
- Append the footer below to every description, including edits and refreshes.

## Required footer

Two paragraphs, built from `config/agency.json`, as the last thing in the
description HTML — the attribution, then equal opportunity:

```html
<p>{agency_name} is an independent insurance agency. {owner_name}, NPN {npn}.
Questions: {candidate_phone}.</p>
<p>{agency_name} provides equal opportunity to all applicants without regard to
race, color, religion, sex, national origin, age, disability, veteran status, or
any other status protected by law.</p>
```

The attribution paragraph is producer identification on regulated advertising, so
it matters more for the licence on the copy than for any job board. It is also the
one most often missing: on 2026-09-29 only 30 of 255 live postings carried it,
while all 255 had the equal-opportunity paragraph.

**This footer used to carry a compensation sentence** — "Agents are independent
contractors compensated by commission; this position does not offer a salary,
hourly wage, or guaranteed income" — and it was removed on 2026-09-29. Appending
it now would put back the exact wording scrubbed from all 255 postings to satisfy
Manatal's Trust & Safety review, and would undo that work one description at a
time. Compensation belongs in the Compensation section and nowhere else.

`scripts/add-npn-footer.mjs` deliberately does not build the attribution from this
template. It copies the paragraph already live in the account and refuses to run
if postings disagree about what it says, because an NPN and an agency name are
facts that a script must never compose.

If the agency is captive or operates under an upline's name, the footer must reflect
whatever the carrier or IMO requires. Ask before assuming the wording above is
approved for that agency.

## Board eligibility is a separate question

Everything above is about what you may *say*. Job boards also restrict what you
may *post at all* — notably, they reject commission-only roles as a compensation
model, regardless of wording. That is not a compliance problem and it is never
fixed by editing the copy. See `job-board-eligibility.md`.

The two rulebooks collide on exactly one point: this file requires the
commission-only disclosure, and the boards reject the model it discloses. The
disclosure always wins. Route the posting elsewhere instead.

### The one narrow exception on numbers

A **substantiated commission estimate** in a structured, explicitly-labeled
field — Warp Recruit's `commission_estimate`, which renders "Est. … (commission,
not guaranteed)" and never reaches Google's `baseSalary` — is a different object
from a dollar figure in prose, and is permitted where the system can express the
qualifier.

It requires a written basis: a real commission schedule or real producer
earnings records, with the production assumptions stated. An expectation is not
a basis. And it must be the same figure on every posting — a range that varies
per posting is not derived from data, and the variation is what makes it
indefensible.

This exception never extends to body copy. A number in the description of a
commission-only role is an income claim, and `post-jobs.mjs` blocks it with no
override.

## Before publishing

Run this check on every posting:

1. Any number that could be read as pay? → remove it.
2. Any promise about what the candidate will get? → make it conditional or remove it.
3. Every provision in "What we provide" traceable to `config/agency.json`? → if not, cut it.
4. `1099` present, commission word present, remote stated, footer attached? → if not, fix.
