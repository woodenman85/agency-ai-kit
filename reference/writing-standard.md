# Writing standard

Everything here is a specification of **what to convey**, never of how to word it.
If a posting reuses this document's phrasing, the posting failed. Candidates and
job-board ranking algorithms both punish copy that reads like a template.

## Required skeleton — not optional

A job posting is a scannable document, not a letter. Use this exact skeleton, in
this order, with these exact `<h3>` headings:

```html
<p>Opening hook — 2–3 sentences: who this role is for, why the work matters, and
that it is 100% remote. 45 words maximum.</p>
<h3>What you'll actually do</h3>
<ul>… 4–6 bullets, the concrete day-to-day …</ul>
<h3>Who this is a fit for</h3>
<ul>… 4–6 bullets: background, mindset, licensing status for this angle …</ul>
<h3>What we provide</h3>
<ul>… 2–5 bullets, ONLY provisions listed in config/agency.json …</ul>
<h3>The honest part</h3>
<p>1–3 sentences: commission-only 1099 work, who this specific role is NOT for,
and how to apply.</p>
```

- All four headings appear. Never merge, rename, drop, or reorder them.
- The three lists are mandatory. A posting made only of paragraphs is wrong,
  however well it reads.
- Bullets are one idea each, roughly 6–18 words. Never a paragraph inside a bullet.
  Never a one-bullet list.
- Total 225–350 words. Prose lives in the opening and the close; the middle is bulleted.
- Allowed HTML: `<p> <ul> <li> <strong> <h3>`. Nothing else.
- Vary the content per angle. Never vary the skeleton.

## Content

- **Name the deal in the opening.** Remote, commission-based, 1099, life insurance
  sales. Do not bury the employment model under mission language.
- **Make the day-to-day tangible.** Convey these facts in whatever words fit the
  angle: the agent contacts people who already asked for information; coverage
  conversations are scheduled and held remotely; the agent learns the household's
  situation before presenting anything; options are explained and an application is
  completed together; the agent follows it through underwriting. Never imply the
  agent approves coverage or guarantees an outcome.
- **State requirements plainly:** a state life insurance license (or willingness to
  get one before selling), a computer, phone, reliable internet, and the discipline
  to work without supervision.
- **Only real provisions.** Licensing help, paid licensing, training, mentorship, CRM
  access, supplied or warm leads, no cold calling, carrier count — each may appear
  ONLY if it is in `config/agency.json`. An aspiration in a voice profile is not a fact.
- **Never invent** citizenship, age, residency, degree, vehicle, background-check, or
  experience requirements.
- **"The honest part" must be specific.** The person a final-expense role turns away
  is not the person a bilingual or veteran role turns away. A close that would read
  identically on a different posting is a failed close.
- **Cut empty phrases:** "unlimited opportunity", "financial freedom", "be your own
  boss", "cutting-edge", "industry-leading". Every line should give a candidate
  something they can decide on.

## Angles worth writing

Final expense · mortgage protection · bilingual (Spanish/English) · career changers
new to insurance · already-licensed agents · veterans and military spouses ·
part-time / evenings · former real-estate or hospitality workers · retirees returning
to work · telesales-experienced closers.

One angle per posting. Two postings that differ only in adjectives are one posting.

## City localization

When the same role runs across many cities, rewrite **only** the opening hook and the
closing paragraph. Leave duties, fit, provisions, and compensation untouched.

The opening must do two things at once: name the market, and disclose plainly that the
role is remote — e.g. "This is a remote, work-from-home position serving the
{city}, {state} area." Never imply an office, a commute, a local branch, or that the
candidate must live there.

Never put the city in the job title.
