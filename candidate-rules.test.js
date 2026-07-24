const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

function loadRules() {
  const sandbox = { globalThis: null, Set, String };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync('candidate-rules.js', 'utf8'), sandbox, {
    filename: 'candidate-rules.js',
  });
  return sandbox.CandidateRules;
}

test('extractSurname handles standard, comma, suffix, and hyphenated names', () => {
  const rules = loadRules();

  assert.equal(rules.extractSurname('Yoojin Lim'), 'lim');
  assert.equal(rules.extractSurname('Patel, Anika'), 'patel');
  assert.equal(rules.extractSurname('Min Park, Ph.D.'), 'park');
  assert.equal(rules.extractSurname('Ana Chen-Wong Jr.'), 'chen-wong');
});

test('Asian surname matching covers East, Southeast, and South Asia', () => {
  const rules = loadRules();

  for (const name of [
    'Amy Chen',
    'Jisoo Kim',
    'Haruto Sato',
    'Linh Nguyen',
    'Maya Patel',
    'Arjun Singh',
  ]) {
    assert.equal(rules.hasAsianSurname(name), true, name);
  }
  assert.equal(rules.hasAsianSurname('Jamie Robertson'), false);
});

test('seniority exclusions override surname and positive title matches', () => {
  const rules = loadRules();

  for (const title of [
    'Founder and Data Engineer',
    'Chief Data Officer',
    'CFO',
    'VP, Engineering',
    'Director of Analytics',
    'Head of Data',
    'Managing Partner',
    'Principal Engineer',
    'Engineering Manager',
  ]) {
    assert.equal(
      rules.classifyCandidate({ name: 'Amy Chen', title }),
      'excluded',
      title,
    );
  }
});

test('Engineer and Data-related titles qualify without substring false positives', () => {
  const rules = loadRules();

  for (const title of [
    'Software Engineer',
    'Engineering Specialist',
    'Data Analyst',
    'Analytics Consultant',
    'Machine Learning Scientist',
    'AI Researcher',
    'Business Intelligence Developer',
    'Database Administrator',
    'DBA',
  ]) {
    assert.equal(
      rules.classifyCandidate({ name: 'Jamie Robertson', title }),
      'title',
      title,
    );
  }
  assert.equal(
    rules.classifyCandidate({ name: 'Jamie Robertson', title: 'Retail Painter' }),
    'ineligible',
  );
  assert.equal(
    rules.classifyCandidate({ name: 'Jamie Robertson', title: 'Biologist' }),
    'ineligible',
  );
});

test('rankCandidates puts surname matches first and deduplicates selected URLs', () => {
  const rules = loadRules();
  const candidates = [
    { name: 'Jamie Robertson', title: 'Software Engineer', url: '/in/jamie' },
    { name: 'Amy Chen', title: 'Designer', url: '/in/amy' },
    { name: 'Chris Kim', title: 'Director of Data', url: '/in/chris' },
    { name: 'Linh Nguyen', title: 'Data Analyst', url: '/in/linh' },
    { name: 'Duplicate Chen', title: 'Designer', url: '/in/amy' },
  ];

  assert.deepEqual(
    Array.from(
      rules.rankCandidates(candidates, new Set(['/in/linh'])),
      (item) => item.url,
    ),
    ['/in/amy', '/in/jamie'],
  );
});
