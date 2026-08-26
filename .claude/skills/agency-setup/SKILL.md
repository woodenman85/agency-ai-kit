---
name: agency-setup
description: First-run interview that sets up this kit for one agency — collects licensing facts, business model, brand voice, and tool credentials, then writes config/agency.json and BRAND.md. Use when the user says set me up, get started, onboard me, configure the kit, run setup, or when any other skill finds config/agency.json missing.
---

# Agency setup interview

The job is to end up with two files that everything else in this kit depends on:

| File | What it is | Rule |
|---|---|---|
| `config/agency.json` | **Facts.** The only things a job posting or ad is allowed to claim. | Never write a value the user did not give you. |
| `BRAND.md` | **Voice.** How this agency sounds, who it is for, the stories it tells. | Written in the user's own words wherever possible. |

`config/agency.example.json` shows the shape of the first file. Read it before you start.

## How to run the interview

**One question at a time. Wait for the answer. Then ask the next one.** A wall of
twenty questions gets abandoned; a conversation gets finished. Most people running
this are insurance agents, not developers — no jargon, no file paths in the questions,
no asking them to format anything as JSON.

- Number the questions out loud ("question 4 of about 18") so they can see the end.
- If an answer is vague, ask one follow-up, then move on. Perfect is not the goal.
- "I don't know" and "skip" are valid answers. Leave the field out rather than
  guessing — a missing field is a small problem, an invented one is a license problem.
- Let them stop early. Save what you have and tell them how to resume ("just say
  *finish my setup*").
- If `config/agency.json` already exists, do not start over. Show what is in it, ask
  what they want to change, and edit only that.

## Phase 1 — who is on the license (required, no skipping)

Every posting and every ad carries a real person's license. Nothing else in the kit
can run until these are answered.

1. Agency or business name, exactly as it should appear in print.
2. The name of the licensed person the postings run under.
3. Their **NPN** (National Producer Number). If they don't know it, tell them:
   look it up free at `nipr.com` → PDB lookup. Do not proceed with a placeholder.
4. Which states they're licensed in — all 50, or a specific list.
5. Home city and state of the business.
6. Are they **captive** (one carrier) or **independent** (many)? If captive, ask which
   carrier or IMO, and warn them that their upline may require specific ad language —
   they should check before publishing anything.

## Phase 2 — what the postings are allowed to say

This phase exists because of one rule: if it isn't captured here, no skill in this kit
may claim it. Ask about each, and record the honest answer, including "no".

7. Which products they actually sell (term, whole life, mortgage protection, final
   expense, IUL, annuities…).
8. **Leads** — this is the one candidates care about most and the one agencies fudge
   most. Which is true: agents buy their own leads, the agency supplies leads at no
   cost, leads are inbound from marketing, or a mix? Get the real answer and record it
   plainly.
9. What the agency genuinely provides a new agent: licensing help, paid licensing,
   training, mentorship, CRM access, carrier contracts. Only what actually exists.
10. Is experience required, or do they take brand-new people?
11. How long licensing usually takes for their state, and whether they walk people
    through it.
12. How someone applies — a URL, a phone number, or through the ATS.

Then say back to them, in one short list, everything a posting will now be permitted
to claim, and ask them to confirm it is all true. Fix anything they flag.

## Phase 3 — brand and voice

This is what stops every agency in the group from publishing identical content.

13. In one sentence: who do they most want to reach — clients, recruits, or both?
14. Their story — how they got into insurance, in their own words. Two or three
    sentences is plenty. This is the single most useful answer in the file; if they
    give you a short one, ask one warm follow-up.
15. Their ideal client: family situation, age range, what usually prompts the call.
16. The three objections they hear most, and roughly how they answer each.
17. How they want to sound — warm, blunt, funny, quiet, plain-spoken. Ask for two or
    three agencies or people whose tone they like, or just words that fit.
18. Anything they never want said on their behalf (hype words, pressure tactics,
    specific phrases they hate).

## Phase 4 — tools (optional, and skippable)

Ask which of these they use, and only set up the ones they say yes to. Anyone who
says "not yet" gets it noted and skipped — they can add it later.

- **Manatal** (job posting / ATS) — needed for the `job-posts` skill.
- **GoHighLevel** — needed for the `crm` skill.
- **A website they can edit** — needed for the `website` skill.

For each yes, walk them through getting the credential and have them paste it. See
`SETUP.md` for the exact click-path for each one. Write credentials to `.env` only —
never into `config/agency.json`, `BRAND.md`, or any file that gets committed. Say that
out loud when you write it, so they know their key is not going to GitHub.

## Phase 5 — write the files

1. Write `config/agency.json` using `config/agency.example.json` as the shape. Omit
   keys they skipped rather than filling them with examples. Include a
   `"setup_completed"` date.
2. Write `BRAND.md` with the Phase 3 answers, in their words. Structure it as:
   who we serve · our story · ideal client · objections and answers · how we sound ·
   never say. Quote them directly where the phrasing is theirs — a story rewritten
   into marketing language stops being usable.
3. Show them the compliance footer that will now appear on every job posting, built
   from their real name and NPN, and ask them to read it once and approve it.
4. If they set up Manatal, run `node scripts/check-manatal.mjs`, and put the
   `organization_id` it prints into `config/agency.json` as `manatal_organization_id`.
5. Tell them what they can do now, in plain language, with the exact words to say:
   - *"write me three job postings"* → the `job-posts` skill
   - *"check this post for compliance"* → the `compliance` skill
   - *"write me a week of social posts"* → the `content` skill

Then stop. Do not start writing postings in the same breath as finishing setup —
let them see the files first.
