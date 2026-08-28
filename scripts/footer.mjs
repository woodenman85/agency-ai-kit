// The compliance footer that must end every job description.
// One builder, used by generate-bulk.mjs and checked by post-jobs.mjs, so the
// generated footer and the validator can never drift apart.

/**
 * Build the footer for this agency.
 * `cfg.compliance_footer` wins outright — an agency under a carrier or IMO that
 * requires particular advertising wording pastes it there, and that wording is
 * not ours to rewrite.
 */
export function buildFooter(cfg) {
  if (cfg.compliance_footer) return cfg.compliance_footer;
  const kind = 'Independent insurance agency. ';
  return `<p>------------------------------------------------------------------</p>\n<p>${cfg.agency_name}. ${cfg.owner_name}, NPN ${cfg.npn}. ${kind}Agents are independent contractors compensated by commission; this position does not offer a salary, hourly wage, or guaranteed income. A state life insurance license is required before soliciting or selling business, and licensing timelines vary by state. Individual results depend on individual effort and are not guaranteed. Equal opportunity — we consider every applicant regardless of race, color, religion, sex, sexual orientation, gender identity, national origin, age, disability, or veteran status.</p>`;
}

/**
 * A distinctive phrase that must appear in a description for its footer to count
 * as present. With a custom footer we match its own text rather than assuming
 * the default wording — a carrier-supplied footer need not mention an NPN.
 */
export function footerMarker(cfg) {
  const text = (cfg.compliance_footer || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (text) return { needle: text.slice(0, 60), label: 'the compliance_footer from config/agency.json' };
  return { needle: 'NPN', label: 'the compliance footer' };
}
