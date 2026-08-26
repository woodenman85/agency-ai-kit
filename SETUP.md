# Setup runbook

*This file is written for the AI, not for the agent using it. If you are a person and
you just want to get started, see [README.md](README.md).*

You are setting up this kit for one insurance agency. The person you are talking to
is an insurance agent, not a developer. Assume no technical background. Do the work
yourself and tell them what you did — do not hand them commands to run unless there
is no alternative.

## Step 1 — check the machine

Confirm Node.js is installed: `node -v`. It must be v18 or newer.

If it is missing, tell them where to get it (nodejs.org, the LTS button) and what to
do after installing (quit and reopen the terminal, then say "keep going"). Do not try
to install it for them or route around it — everything that talks to Manatal needs it.

Nothing else needs installing. There is no `npm install` step unless they later want
the optional bulk city generator.

## Step 2 — create their files

```bash
cp .env.example .env
```

Do not create `config/agency.json` yet. The interview writes it.

## Step 3 — run the interview

Read `.claude/skills/agency-setup/SKILL.md` and follow it exactly. It is the whole
onboarding: licensing facts, what the agency may claim, brand voice, and tools.

**One question at a time.** This is the part people abandon if it feels like a form.

## Step 4 — credentials, only for tools they actually use

Walk them through each one they said yes to. Paste-ready click paths:

**Manatal** (job postings)
> Log in to Manatal → the gear icon → Settings → Integrations → Open API → Generate.
> Copy the key immediately; Manatal only shows it once.

Then add it to `.env` as `MANATAL_API_KEY=...` and run `node scripts/check-manatal.mjs`.
It prints their organization id — put that in `config/agency.json` as
`manatal_organization_id`.

**GoHighLevel** (CRM)
> Settings → Private Integrations → Create new integration → name it "AI Kit" → tick
> the scopes for contacts, opportunities, calendars, and conversations → Create.
> The token starts with `pit-`.

Add it to `.env` as `GHL_API_KEY=...`. Their Location ID is in the browser URL after
`/location/`. That goes in `config/agency.json` as `ghl_location_id`.

**Website FTP**
> Hosting control panel → Files → FTP Accounts. Host, username, and password.

Add them to `.env` as `FTP_HOST`, `FTP_USER`, `FTP_PASSWORD`.

Say out loud, once, that `.env` is git-ignored and their keys stay on their computer.
People are right to be nervous about pasting an API key into a chat window, and they
should hear the answer rather than have to ask.

## Step 5 — prove it works

Pick whichever they set up and run one harmless read-only thing end to end:

- Manatal → `node scripts/check-manatal.mjs`
- GHL → fetch their pipelines and name them back
- Website → list the local site folder

Then write **one** sample job posting following the `job-posts` skill, show it in full,
and *do not publish it*. It is the proof that the compliance footer, their NPN, and
their voice all came out right. Ask them to read it.

## Step 6 — hand them the keys

Tell them, in plain language, exactly what to say to get each thing. Keep it to five
lines or fewer. Then stop.

## Things to get right

- **Never invent an agency fact.** A missing field is fine. A guessed NPN, a claimed
  lead program that does not exist, or an invented "paid training" is a licensing
  problem for a real person.
- **Never publish anything during setup.** Not a job post, not a page, not a message.
- **Credentials only ever go in `.env`.** Never in `config/agency.json`, never in
  `BRAND.md`, never in a file that gets committed.
- If they get stuck or bored, save progress and give them one sentence on how to
  resume. Half a setup is recoverable; a person who gave up is not.
