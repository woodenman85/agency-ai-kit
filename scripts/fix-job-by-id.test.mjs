// Drives fixJob() against a fake api. The point of these tests is the
// verification path: a PATCH that returns 200 while the stored description
// never changed must be reported as a failure, not as success. Three live runs
// reported success on job 4438466 while it stayed broken.
// Run: node scripts/fix-job-by-id.test.mjs
import { fixJob } from './fix-job-by-id.mjs';

let failures = 0;
const check = (label, cond) => {
  console.log(`  ${cond ? 'pass' : 'FAIL'}  ${label}`);
  if (!cond) failures++;
};

// Job 4438466's description as the API returned it on 2026-10-01, trimmed to
// the parts the rules touch.
const DEFECTIVE =
  '<p>A remote life insurance sales role at The Wood Agency is open nationwide.</p>' +
  '<h3>Qualifications</h3><ul>' +
  '<li>Legally authorized to work in the United States</li>' +
  '<li>Some history working with variable or production-based compensation — this role carries no salary or base</li>' +
  '</ul><h3>Compensation</h3>' +
  '<p>This is a 1099 independent contractor position. Compensation is production-based. No salary or hourly pay is provided. Earnings depend on individual production. If that structure makes sense for your situation, The Wood Agency welcomes your application.</p>' +
  '<p>The Wood Agency Life provides equal opportunity to all applicants without regard to race.</p>';

// Job 4431293: already repaired, nothing for a rule to do.
const CLEAN = DEFECTIVE.replace(
  '<p>This is a 1099 independent contractor position. Compensation is production-based. No salary or hourly pay is provided. Earnings depend on individual production. If that structure makes sense for your situation, The Wood Agency welcomes your application.</p>',
  '<p>This is a 1099 independent contractor position. Earnings are based on individual production.</p>',
);

/** @param {{stored: string, honorWrite?: boolean}} opts */
function fakeApi({ stored, honorWrite = true }) {
  const calls = { gets: 0, patches: 0, sent: null };
  let current = stored;
  const api = async (path, init = {}) => {
    if (init.method === 'PATCH') {
      calls.patches++;
      calls.sent = JSON.parse(init.body).description;
      if (honorWrite) current = calls.sent;
      return { json: async () => ({}) };
    }
    calls.gets++;
    return {
      json: async () => ({
        id: 4438466, position_name: 'Remote Sales Consultant — Outside Sales and Territory Reps',
        city: 'Carpentersville', state: 'Illinois',
        updated_at: honorWrite && calls.patches ? '2026-10-01T12:00:00Z' : '2026-09-29T22:19:19Z',
        description: current,
      }),
    };
  };
  return { api, calls };
}

const quiet = () => {};

console.log('A write that lands is reported as verified');
{
  const { api, calls } = fakeApi({ stored: DEFECTIVE });
  const r = await fixJob(api, 4438466, { live: true, log: quiet });
  check('the posting is recognized as defective', r.defective === true);
  check('it is written', calls.patches === 1);
  check('reported as written', r.written === true);
  check('nothing left unresolved', r.unresolved === null);
  check('the banned compensation sentence is gone', !/No salary or hourly pay/i.test(calls.sent));
  check('the word is gone', !/commission/i.test(calls.sent));
  check('the Compensation block is normalized',
    /<h3>Compensation<\/h3><p>This is a 1099 independent contractor position\. Earnings are based on individual production\.<\/p>/.test(calls.sent));
  check('it re-read the posting after writing', calls.gets === 2);
}

console.log('\nA PATCH that returns 200 but does not stick is a failure');
{
  const { api, calls } = fakeApi({ stored: DEFECTIVE, honorWrite: false });
  const r = await fixJob(api, 4438466, { live: true, log: quiet });
  check('it attempted the write', calls.patches === 1);
  check('NOT reported as written', r.written === false);
  check('reported as unresolved', r.unresolved === 'write did not stick');
}

console.log('\nAn already-clean posting is left alone');
{
  const { api, calls } = fakeApi({ stored: CLEAN });
  const r = await fixJob(api, 4431293, { live: true, log: quiet });
  check('not defective', r.defective === false);
  check('not written', calls.patches === 0 && r.written === false);
  check('not flagged as a problem', r.unresolved === null);
}

console.log('\nDefective with no rule to match it is surfaced, not swallowed');
{
  const odd = CLEAN.replace('Earnings are based on individual production.',
    'Pay is 100% commission with no base whatsoever.');
  const { api, calls } = fakeApi({ stored: odd });
  const r = await fixJob(api, 9999999, { live: true, log: quiet });
  check('recognized as defective', r.defective === true);
  check('no write attempted', calls.patches === 0);
  check('says a new rule is needed', /needs a new rule/.test(r.unresolved || ''));
}

console.log('\nA dry run sends nothing');
{
  const { api, calls } = fakeApi({ stored: DEFECTIVE });
  const r = await fixJob(api, 4438466, { live: false, log: quiet });
  check('no PATCH', calls.patches === 0);
  check('no re-read', calls.gets === 1);
  check('still reports the defect', r.defective === true && r.written === false);
}

console.log('\n--drop-no-salary also clears the qualifications bullet');
{
  const { api, calls } = fakeApi({ stored: DEFECTIVE });
  await fixJob(api, 4438466, { live: true, dropNoSalary: true, log: quiet });
  check('the bullet loses the no-salary clause', !/no salary or base/i.test(calls.sent));
  check('the bullet still reads as a sentence',
    /<li>Some history working with variable or production-based compensation<\/li>/.test(calls.sent));
}

console.log(failures ? `\n${failures} FAILURE(S)` : '\nall passed');
process.exit(failures ? 1 : 0);
