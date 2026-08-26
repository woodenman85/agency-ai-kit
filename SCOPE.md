# What this kit is, and what it deliberately isn't

Read this before adding a feature. The obvious next feature is usually the one that
shouldn't be here.

## The line

This kit **writes things and pushes them into tools the agency already pays for.**
It does not host anything, does not own a candidate, and does not run in the cloud.
Everything happens on one person's laptop, against their own accounts.

## In scope

- Writing job postings, ads, emails, texts, and web copy — to a standard, in the
  agency's own voice.
- Compliance checking before anything goes out.
- Pushing that work into the agency's **own** Manatal, GoHighLevel, or web host.
- Interviewing the agency once so all of the above is specific to them.

## Out of scope — do not add these

| Not this | Why |
|---|---|
| A public job board, careers page, or hosted listings | That is a product, not a script. It needs uptime, SEO, and someone on call. |
| Google-for-Jobs JSON-LD, XML feeds, board syndication | Distribution is infrastructure. A laptop script cannot keep a feed healthy. |
| A candidate database, scoring, or ranking | It means storing other people's personal data. Not something to hand out as a folder of files. |
| Automated outreach or sequences to candidates | Every send has to be human-approved. A local script with an API key is how people get accounts banned. |
| Anything multi-tenant, hosted, or shared between agencies | The moment two agencies share a system, somebody has to run it. |

Each of those is a real need, and each is what **warprecruit.com** is for. That isn't
an accident of scoping — it's the actual difference between a helper that runs on your
machine and a service that runs for you.

## Why the writing standard is public, and why that's fine

`reference/writing-standard.md` and `reference/compliance.md` are the most valuable
documents in here, and giving them away costs very little. Compliance rules derive
from regulation — anyone serious reproduces them. Posting structure is visible in
every job posting ever published. Neither is defensible, and pretending otherwise
would mean shipping a worse kit to the people it's meant for.

What isn't reproducible from a repo: an indexed job board with history, live feeds to
the boards, and a candidate pipeline with real data in it. Keep those on the other
side of this line and the kit costs nothing to give away.
