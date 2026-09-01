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
- **Carrier or product claims.** Do not name specific policy features, rates, or
  "tax-free" anything in a recruiting post. It is a job posting, not a sales piece.

## Always

- State the 1099 independent-contractor, commission-only structure explicitly in the
  body. The literal string `1099` and an explicit commission word must appear —
  job-board validators match those tokens.
- State that a state life insurance license is required before selling, and that
  licensing timelines vary by state.
- State that the role is 100% remote if it is. Google for Jobs requires the
  disclosure to index it as remote.
- Append the footer below to every description, including edits and refreshes.

## Required footer

Build it from `config/agency.json` and append it verbatim as the last thing in the
description HTML:

```html
<p>------------------------------------------------------------------</p>
<p>{agency_name}. {owner_name}, NPN {npn}. Independent insurance agency. Agents are
independent contractors compensated by commission; this position does not offer a
salary, hourly wage, or guaranteed income. A state life insurance license is required
before soliciting or selling business, and licensing timelines vary by state.
Individual results depend on individual effort and are not guaranteed. Equal
opportunity — we consider every applicant regardless of race, color, religion, sex,
sexual orientation, gender identity, national origin, age, disability, or veteran
status.</p>
```

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
