---
name: website
description: Edit and deploy the agency's website — copy changes, new sections, forms, tracking, and pushing files live over FTP. Use when asked to change, fix, add to, or deploy anything on the agency's site or landing pages.
---

# Website

## Setup

`config/agency.json` holds `website_domain` and `website_local_path` (the folder on
this machine where the site's files live). FTP credentials live in `.env` as
`FTP_HOST`, `FTP_USER`, `FTP_PASSWORD`. If any are missing, run `agency-setup`.

Not every agency has a site they can edit this way. Sites built inside GHL, Wix, or
Squarespace are edited in those tools — say so plainly instead of trying to FTP into
something that has no FTP.

## Workflow

1. Edit files in the local folder. Never edit on the server.
2. Preview locally before deploying — open the file in a browser and look at it,
   including at phone width.
3. Deploy only the files that changed:

```bash
curl --ftp-pasv -T <file> \
  "ftp://$FTP_HOST/domains/$DOMAIN/public_html/<path>" \
  --user "$FTP_USER:$FTP_PASSWORD"
```

4. Load the live URL and confirm the change is actually there before saying it is done.

## Rules

- **Back up first.** Download the current version of any file before overwriting it.
  There is no version history on shared hosting.
- One file at a time. A half-finished bulk upload is a broken site.
- Any copy that makes a claim goes through the `compliance` skill first.
- Phone numbers and form destinations come from `config/agency.json`. Getting a lead
  form pointed at the wrong inbox loses real leads silently, so verify by submitting
  a test entry and confirming it arrived.
- Never commit FTP credentials, and never paste them into a page, a script that gets
  committed, or a chat log.
