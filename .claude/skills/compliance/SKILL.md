---
name: compliance
description: Check insurance marketing content for compliance problems before it is published or sent — emails, texts, social posts, ads, website copy, or scripts. Use when asked to review, check, or clear content, when asked whether a claim is allowed, and automatically before any other skill publishes client-facing copy.
---

# Compliance check

Insurance advertising is regulated, and the licensed person's NPN is on it — not the
tool that wrote it. Read `config/agency.json` for who that is and what this agency is
actually allowed to claim. When in doubt, leave it out.

Recruiting posts have their own, stricter rules: see `reference/compliance.md`.
This skill is for **client-facing** marketing.

## Run every piece through these three passes

### Pass 1 — hard stops. Rewrite, never soften.

- Guaranteed returns, rates, or growth ("earn 8%", "guaranteed 10%").
- Guaranteed approval, guaranteed coverage, or "everyone qualifies", without the
  actual qualification terms.
- Specific benefit or premium amounts with no disclosure of what drives them
  (age, health, state, carrier, underwriting).
- Naming a competitor in a comparison that isn't substantiated.
- "Free money", "government program", "the banks don't want you to know" framing.
- Anything implying a policy replaces or supplements Social Security.
- Anything a reader could take as a promise about cost, payout, or timing.

### Pass 2 — yellow flags. Allowed only with the qualifier attached.

| Phrase | Required qualification |
|---|---|
| "tax-free" | say *how*: through policy loans, not withdrawals — and that it depends on the policy staying in force |
| illustrated rates or cash-value figures | mark non-guaranteed values as **not guaranteed** |
| "infinite banking" / "be your own bank" | no comparison implying it is a bank, insured deposits, or a savings account |
| testimonials | typical results, or a disclaimer that results vary |
| "retire early", "replace your income" | conditional language and what it depends on |
| "no medical exam" | true only for specific products — name which |

### Pass 3 — what should be there and usually isn't

- Education before promise. If the piece has no useful information in it, that is a
  compliance problem *and* a marketing problem.
- "May", "can", "could" instead of "will" for any benefit.
- "Results vary" near any performance claim.
- The licensed name and NPN on paid ads.
- The correct phone number and apply/quote link from `config/agency.json`.

## What to give back

1. **Verdict first**: clear to send, needs edits, or do not send.
2. Each problem quoted exactly, with the rule it breaks, in a short list.
3. A rewritten version that keeps the user's voice — pull it from `BRAND.md`. A
   compliant rewrite that sounds like a legal notice will not get used, which helps
   nobody.
4. If the content is state-specific, say so. Rules vary by state, and this check is
   a first filter, not legal advice. For anything novel or high-stakes, tell the user
   to run it past their carrier or IMO's advertising review — that is a real,
   available step, not a brush-off.
