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

- State the 1099 independent-contractor structure explicitly in the body, framed as a
  contract, and that pay is based on individual production and is not guaranteed. The
  literal string `1099` must appear. In "The honest part", lead with a
  `<strong>Compensation:</strong>` sentence saying the agent is paid under an
  independent contractor (1099) contract based on the business they personally produce.
- Do not write "commission-only", "commission-based", or "no salary or hourly pay" in
  anything bound for Manatal. Manatal's Trust & Safety team scans for exactly that
  wording and has restricted this agency's free job-board access over it. The
  structure is still disclosed — as 1099 and production-based earnings — so a
  candidate learns the same thing. Read "Free job-board restriction" in
  `reference/manatal-api.md` before assuming wording is the whole story.
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
independent contractors (1099) paid under contract based on individual production;
compensation is not guaranteed. A state life insurance license is required before
soliciting or selling business, and licensing timelines vary by state. Equal opportunity — we
consider every applicant regardless of race, color, religion, sex, sexual
orientation, gender identity, national origin, age, disability, or veteran
status.</p>
```

If the agency is captive or operates under an upline's name, the footer must reflect
whatever the carrier or IMO requires. Ask before assuming the wording above is
approved for that agency.

## Before publishing

Run this check on every posting:

1. Any number that could be read as pay? → remove it.
2. Any promise about what the candidate will get? → make it conditional or remove it.
3. Every provision in "What we provide" traceable to `config/agency.json`? → if not, cut it.
4. `1099` present, production-based earnings stated, remote stated, footer attached,
   and none of the Manatal-flagged phrasings above? → if not, fix.
