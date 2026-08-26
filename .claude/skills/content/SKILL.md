---
name: content
description: Write marketing content in this agency's own voice — social posts, emails, texts, ad copy, video scripts, and content batches for the week. Use when asked to write a post, draft an email or text to a lead, plan a content week, or repurpose something into other formats.
---

# Content

## Always, before writing a word

1. Read `BRAND.md`. If it does not exist, run the `agency-setup` skill — generic
   content is the whole problem this kit exists to solve.
2. Read `config/agency.json` for what may be claimed, the products actually sold, and
   the correct phone number and link.

Content that could have been written for any agency in the country is a failure, even
if it is compliant and well-formed. The specific detail — their story, their town,
the objection they actually hear — is the entire value.

## How to write it

- **Open on a real moment, not a statistic.** "A client asked me last week…" beats
  "Did you know 40% of families…". Pull from the stories in `BRAND.md`.
- **One idea per piece.** A post that covers term, whole life, and IUL covers nothing.
- **Educate, then invite.** No hard close in organic content — the call to action is
  a question or a next step, not a pitch.
- **Their words, not marketing words.** If `BRAND.md` says they hate "financial
  freedom", that phrase never appears.
- Anonymize every client story: change the name, the town, and any detail that could
  identify a household. Say that you have done so.

## Format notes

| Where | What works |
|---|---|
| Facebook / Instagram | 80–150 words, one idea, line breaks, a question at the end |
| LinkedIn | 150–250 words, a lesson or a mistake, no hashtag walls |
| Short video script | 30–45 seconds spoken: hook in 3 seconds, one point, one ask |
| Email | one subject idea, under 200 words, one link |
| SMS | under 160 characters, a name, one question, easy opt-out |

## Before anything is published or sent

Run the `compliance` skill on it. Every time — including the pieces that seem
obviously safe, since "tax-free" and "guaranteed" slip in most often when the topic
feels routine. Show the user the verdict alongside the draft.

If the account is connected to GHL, the `crm` skill can schedule or send it. Drafting
is not sending: publishing or messaging anyone requires explicit approval first.
