#!/usr/bin/env node
// OPTIONAL. Only needed for large city runs. Requires an Anthropic API key
// (console.anthropic.com — this is separate billing from a Claude subscription).
//
//   npm install @anthropic-ai/sdk
//   add ANTHROPIC_API_KEY=sk-ant-... to .env
//   node scripts/generate-bulk.mjs [roleCount] [cityCount]
//
// Stage 1 writes N distinct role angles to roles.json.
// Stage 2 localizes each across cities.json and writes posts.json.
// Then review posts.json and use scripts/post-jobs.mjs to send it.
import fs from 'node:fs';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { ROOT, requireKey } from './env.mjs';

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

requireKey('ANTHROPIC_API_KEY', 'Create one at console.anthropic.com. This is pay-as-you-go API billing, separate from a Claude subscription.');
const client = new Anthropic();
const MODEL_QUALITY = 'claude-sonnet-5';
const MODEL_FAST = 'claude-haiku-4-5-20251001';

const ROLE_COUNT = Number(process.argv[2] || 10);
const cfg = JSON.parse(read('config/agency.json'));
const STANDARD = read('reference/writing-standard.md');
const COMPLIANCE = read('reference/compliance.md');
const cities = JSON.parse(read('scripts/cities.json')).slice(0, Number(process.argv[3] || 50));

const FOOTER = `<p>------------------------------------------------------------------</p>\n<p>${cfg.agency_name}. ${cfg.owner_name}, NPN ${cfg.npn}. Independent insurance agency. Agents are independent contractors compensated by commission; this position does not offer a salary, hourly wage, or guaranteed income. A state life insurance license is required before soliciting or selling business, and licensing timelines vary by state. Individual results depend on individual effort and are not guaranteed. Equal opportunity — we consider every applicant regardless of race, color, religion, sex, sexual orientation, gender identity, national origin, age, disability, or veteran status.</p>`;

const FACTS = `VERIFIED AGENCY FACTS — do not contradict these and do not invent beyond them:\n${JSON.stringify(cfg, null, 2)}`;

const DRAFT_SYSTEM = `You are an expert recruiting copywriter for a 100% remote, 1099 independent-contractor life insurance sales organization in the United States. You write postings that are warm, honest and specific — never corporate, never hype.

${COMPLIANCE}

${STANDARD}

Write postings for genuinely DISTINCT angles — not one role reworded. Return ONLY valid JSON matching the schema. Descriptions use simple HTML: <p>, <ul>, <li>, <strong>, <h3>.`;

const SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: { drafts: { type: 'array', items: { type: 'object', additionalProperties: false,
    properties: { angle: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' } },
    required: ['angle', 'title', 'description'] } } },
  required: ['drafts'],
};

async function catalog(n, existing) {
  const msg = await client.messages.create({
    model: MODEL_QUALITY, max_tokens: 16000, system: DRAFT_SYSTEM,
    messages: [{ role: 'user', content: `${FACTS}

Generate ${n} distinct role drafts for this agency.${existing.length ? `\n\nAlready generated — make these genuinely different, no overlap:\n${existing.map((t) => '- ' + t).join('\n')}` : ''}
Titles must be clean and searchable — what a candidate actually types into a job board. Never put a city in the title.` }],
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA } },
  });
  const text = msg.content.find((b) => b.type === 'text')?.text ?? '';
  return JSON.parse(text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '')).drafts;
}

async function localize(title, body, city, state) {
  const place = `${city}, ${state}`;
  const msg = await client.messages.create({
    model: MODEL_FAST, max_tokens: 4000,
    system: `You localize a remote job posting's opening and closing paragraphs for one market, without changing the substance of the role.

Rewrite ONLY the opening hook and the closing call-to-action so they feel specific to ${place}. Keep everything in between — duties, fit, provisions, compensation — exactly as written.

The opening paragraph must do two things: name ${place}, and state plainly that this is a remote, work-from-home position serving the ${place} area. Never imply an office, a commute, a local branch, or that the candidate must live there.

Keep the same HTML structure and the same <h3> headings. Return ONLY the full rewritten HTML description — no preamble, no markdown fences.`,
    messages: [{ role: 'user', content: `Title: ${title}\n\nDescription:\n${body}` }],
  });
  return (msg.content.find((b) => b.type === 'text')?.text ?? '').trim()
    .replace(/^```(?:html)?\s*/i, '').replace(/```$/, '').trim();
}

console.log(`stage 1: ${ROLE_COUNT} distinct roles...`);
let roles = [];
while (roles.length < ROLE_COUNT) {
  const batch = await catalog(Math.min(5, ROLE_COUNT - roles.length), roles.map((r) => r.title));
  roles.push(...batch);
  console.log('  ' + batch.map((b) => b.title).join(' / '));
}
roles = roles.slice(0, ROLE_COUNT);
fs.writeFileSync(path.join(ROOT, 'roles.json'), JSON.stringify(roles, null, 2));

console.log(`\nstage 2: localizing ${cities.length} postings...`);
const jobs = cities.map((c, i) => ({ ...c, role: roles[i % roles.length] }));
const out = [];
for (let i = 0; i < jobs.length; i += 6) {
  const part = await Promise.all(jobs.slice(i, i + 6).map(async (j) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const desc = await localize(j.role.title, j.role.description, j.city, j.state);
        if (desc.length > 400) return { title: j.role.title, angle: j.role.angle, city: j.city, state: j.state, description: desc + '\n' + FOOTER };
      } catch { await new Promise((r) => setTimeout(r, 1500 * (attempt + 1))); }
    }
    return { title: j.role.title, angle: j.role.angle, city: j.city, state: j.state, description: j.role.description + '\n' + FOOTER, fallback: true };
  }));
  out.push(...part);
  process.stdout.write(`  ${out.length}/${jobs.length}\r`);
}
fs.writeFileSync(path.join(ROOT, 'posts.json'), JSON.stringify(out, null, 2));
console.log(`\n\nposts.json written: ${out.length} postings, ${out.filter((p) => p.fallback).length} fallbacks.`);
console.log('Read a few, then: node scripts/post-jobs.mjs');
