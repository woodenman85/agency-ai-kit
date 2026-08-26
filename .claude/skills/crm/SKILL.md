---
name: crm
description: Work in the agency's GoHighLevel (GHL) account — look up contacts and opportunities, build or fix custom fields, forms and surveys, inspect pipelines and workflows, and send from the CRM. Use when asked about GHL, LeadConnector, the CRM, pipelines, contacts, or lead follow-up automation.
---

# GoHighLevel

## Setup

- **Location ID** lives in `config/agency.json` as `ghl_location_id`. Find it in GHL
  under Settings → Business Profile, or in the URL: `/location/<THIS_PART>/`.
- **Token** lives in `.env` as `GHL_API_KEY`. It must be a **private integration
  token** — it starts with `pit-`. Create one in Settings → Private Integrations, and
  give it only the scopes it needs.
- Never use a session JWT copied out of browser dev tools. They expire in about an
  hour and then everything silently breaks in a way that looks like a bug.

If either is missing, run the `agency-setup` skill rather than asking for it inline.

## Calling the API

```bash
curl -s -H "Authorization: Bearer $GHL_API_KEY" \
     -H "Version: 2021-07-28" \
     "https://services.leadconnectorhq.com/contacts/?locationId=$LOCATION_ID" \
  | python3 -m json.tool
```

| Resource | Method | Path |
|---|---|---|
| Contacts | GET / POST | `/contacts/?locationId={id}` |
| Contact by id | GET / PUT | `/contacts/{contactId}` |
| Custom fields | GET / POST | `/locations/{id}/customFields` |
| Custom values | GET / POST | `/locations/{id}/customValues` |
| Pipelines | GET | `/opportunities/pipelines?locationId={id}` |
| Opportunities | GET | `/opportunities/search?location_id={id}` |
| Workflows | GET | `/workflows/?locationId={id}` |
| Surveys | GET | `/surveys/?locationId={id}` |
| Calendars | GET | `/calendars/?locationId={id}` |
| Conversations | POST | `/conversations/messages` |

Some accounts also have a GHL MCP server connected. If those tools are available, use
them — they are less error-prone than raw curl. Fall back to curl when they are not.

## Rules

- **Read before you write.** Fetch the current state of a field, workflow, or pipeline
  and show it to the user before changing it. GHL has no undo.
- **Never bulk-send.** Adding contacts to a campaign or workflow, or sending SMS or
  email to more than one person, requires explicit approval in this conversation with
  the count named out loud ("this will text 412 people — confirm?").
- Any client-facing message drafted here goes through the `compliance` skill first.
- Deleting a contact, custom field, or pipeline stage is permanent and usually breaks
  automations that reference it. Show what depends on it, then ask.
- Personal cell numbers do not go on bulk SMS. Use the agency's business texting
  number from `config/agency.json`.
