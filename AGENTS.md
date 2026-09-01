# Agency AI Kit — instructions

An insurance agency's AI workspace. This file is what Codex reads; Claude Code reads
`CLAUDE.md` and loads the same skill files automatically.

## Two files everything depends on

- `config/agency.json` — **facts.** The only claims allowed on this agency's behalf.
  If it is not in this file, it does not go in a job post, an ad, or an email.
- `BRAND.md` — **voice.** How this agency sounds and the stories it tells.

If either is missing, read `.claude/skills/agency-setup/SKILL.md` and run that
interview before doing anything else.

## Read the matching file before you start the work

| When the user asks about | Read first |
|---|---|
| setup, onboarding, "get me started", changing their config | `.claude/skills/agency-setup/SKILL.md` |
| job postings, recruiting ads, the ATS, Manatal | `.claude/skills/job-posts/SKILL.md` plus `reference/writing-standard.md`, `reference/compliance.md`, and `reference/job-board-eligibility.md` |
| checking content, "is this allowed", "review this before I send it" | `.claude/skills/compliance/SKILL.md` |
| GoHighLevel, the CRM, contacts, pipelines, follow-up | `.claude/skills/crm/SKILL.md` |
| social posts, emails, texts, ads, content for the week | `.claude/skills/content/SKILL.md` |
| the website, landing pages, deploying changes | `.claude/skills/website/SKILL.md` |

These are not optional reference material. They contain the compliance rules and the
required structure, and work done without them will be wrong in ways that are not
obvious from the output.

## Standing rules

- Never invent an agency fact. A real person's insurance license is on this content.
- Client-facing copy goes through the compliance check before it is sent or published.
- Publishing, sending, or messaging anyone requires explicit approval in the
  conversation. Drafting is not sending.
- Credentials live in `.env` only. Never in `config/agency.json`, `BRAND.md`, or any
  committed file.
- Never remove a compensation disclosure to get a posting past a job board filter.
  Boards reject commission-only as a business model, not as a phrase — see
  `reference/job-board-eligibility.md`. Route the posting; never reword the disclosure.
- Before adding a feature, read `SCOPE.md`. This kit writes things and pushes them
  into tools the agency already pays for. It does not host, syndicate, or store
  candidate data, and those omissions are deliberate.
