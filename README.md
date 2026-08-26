# Agency AI Kit

A starter setup that turns Claude Code or Codex into something genuinely useful for a
life insurance agency — writing compliant job postings, working your CRM, drafting
content in *your* voice, and editing your website.

It interviews you once, learns your agency, and from then on you talk to it in plain
English.

## What you can do once it's set up

| Say this | What happens |
|---|---|
| *"write me three job postings for final expense agents"* | Compliant, non-generic postings, with your NPN footer, ready to publish |
| *"post these to Manatal"* | Published to your careers page through the API |
| *"check this before I send it"* | A compliance pass on any email, text, ad, or post |
| *"write me a week of social posts"* | Content in your voice, from your stories — not stock AI filler |
| *"who's in my pipeline this week?"* | Pulled live from GoHighLevel |
| *"fix the headline on my homepage"* | Edited locally and deployed |

## Getting started

**You need:** a Claude Code or Codex account, and [Node.js](https://nodejs.org)
(click the LTS button; if you're not sure whether you have it, the kit will check).

**Optional, add whichever you use:** Manatal, GoHighLevel, website FTP access. Skip
any you don't have — everything else still works.

### Then paste this into Claude Code or Codex

```
Set me up with the Agency AI Kit. Do all of this for me:

1. Clone https://github.com/woodenman85/agency-ai-kit into a folder called
   agency-ai-kit in my home folder, then work from inside that folder.
2. Read SETUP.md and follow it exactly.
3. Interview me one question at a time. I'm not technical, so don't hand me
   commands to run unless there's no way around it.

Start now.
```

It takes about 20 minutes, most of which is you answering questions about your own
agency. You can stop partway and pick it up later by saying *"finish my setup"*.

## What it asks you

Three kinds of questions, and the difference matters:

1. **License facts** — your name, NPN, states, carrier setup. These go on every
   posting and every ad. No guessing allowed.
2. **What's actually true about your agency** — what you sell, how leads really work,
   what a new agent genuinely gets. This becomes the list of things your AI is
   *permitted* to claim. Nothing outside it ever gets written.
3. **Your voice** — your story, your ideal client, the objections you actually hear,
   how you want to sound. This is what keeps your content from reading like every
   other agency's.

## Your information stays yours

Your answers go in `config/agency.json` and `BRAND.md`. Your API keys go in `.env`.
All three are git-ignored — they live on your computer and are never committed or
shared. Nobody else in the group sees your setup.

## What's in the box

```
.claude/skills/     the six skills (setup, job posts, compliance, CRM, content, website)
reference/          the recruiting writing standard and compliance rules
scripts/            Manatal publishing tools
config/             your agency facts
SETUP.md            the runbook your AI follows to onboard you
```

## Two things this kit will not do

- **It won't publish anything without asking you first.** Job postings, website
  changes, and messages to leads all stop for your explicit yes.
- **It won't make up facts about your agency.** If you didn't tell it during setup,
  it doesn't say it. That's deliberate — your license is on this content, not the
  AI's.

Compliance checking here is a first filter, not legal advice. For anything novel or
high-stakes, run it past your carrier or IMO's advertising review.

## Getting help or improving it

Found something wrong, or want a skill added? Open an issue, or just tell your AI
what's broken and have it write the issue for you.
