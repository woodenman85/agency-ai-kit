# Agency AI Kit

An insurance agency's AI workspace. Skills live in `.claude/skills/` and are
discovered automatically.

## Two files everything depends on

- `config/agency.json` — **facts.** The only claims allowed on this agency's behalf.
  If it is not in this file, it does not go in a job post, an ad, or an email.
- `BRAND.md` — **voice.** How this agency sounds and the stories it tells.

If either is missing, run the `agency-setup` skill before doing anything else.

## Standing rules

- Never invent an agency fact. A real person's insurance license is on this content.
- Client-facing copy goes through the `compliance` skill before it is sent or published.
- Publishing, sending, or messaging anyone requires explicit approval in the
  conversation. Drafting is not sending.
- Credentials live in the macOS Keychain (`node scripts/credentials.mjs set NAME`) or,
  where there is no Keychain, in `.env`. Never in `config/agency.json`, `BRAND.md`, or
  any committed file — and never pasted into an email or a support ticket.
- Never remove a compensation disclosure to get a posting past a job board filter.
  Boards reject commission-only as a business model, not as a phrase — see
  `reference/job-board-eligibility.md`. Route the posting; never reword the disclosure.
- Before adding a feature, read `SCOPE.md`. This kit writes things and pushes them
  into tools the agency already pays for. It does not host, syndicate, or store
  candidate data, and those omissions are deliberate.
