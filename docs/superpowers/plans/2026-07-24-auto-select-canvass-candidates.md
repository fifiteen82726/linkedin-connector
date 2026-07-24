# Auto-Select Canvass Candidates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `Auto-select 10` action that preserves existing selections, loads at most two additional LinkedIn People result batches, and fills the list using Asian-surname priority followed by Engineer/Data-title fallback.

**Architecture:** Add a pure `candidate-rules.js` module for surname and title classification, loaded before the existing content script. Keep LinkedIn DOM parsing, bounded result loading, selection mutation, and floating-panel status in `detect.js`, with the rules module as its only new dependency.

**Tech Stack:** Chrome/Brave Manifest V3 content scripts, browser DOM and MutationObserver APIs, plain JavaScript, Node.js `node:test`, `assert`, and `vm`.

**Design reference:** `docs/superpowers/specs/2026-07-24-auto-select-canvass-candidates-design.md`

---

## File Structure

- Create `candidate-rules.js`: normalized surname/title rules and stable candidate ranking.
- Create `candidate-rules.test.js`: pure rule, priority, boundary, and deduplication tests.
- Modify `manifest.json`: load `candidate-rules.js` before `detect.js`.
- Modify `detect.test.js`: load the new module in the VM and test card parsing, bounded loading, preserved selections, and concurrency.
- Modify `detect.js`: extract reusable card/button state helpers, implement additional-result loading, implement auto-selection, and add floating-panel controls/status.
- Modify `README.md`: document the new review-before-connect workflow and its limits.

### Task 1: Implement the Candidate Rules Module

**Files:**
- Create: `candidate-rules.test.js`
- Create: `candidate-rules.js`

- [ ] **Step 1: Write the failing rules tests**

Create `candidate-rules.test.js`:

```js
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
    rules.rankCandidates(candidates, new Set(['/in/linh'])).map((item) => item.url),
    ['/in/amy', '/in/jamie'],
  );
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
node --test candidate-rules.test.js
```

Expected: FAIL with `ENOENT` for `candidate-rules.js`.

- [ ] **Step 3: Implement the rules module**

Create `candidate-rules.js`:

```js
(function initializeCandidateRules(global) {
  const HONORIFICS = new Set(['dr', 'mr', 'mrs', 'ms', 'prof']);
  const SUFFIXES = new Set([
    'jr', 'sr', 'ii', 'iii', 'iv', 'phd', 'md', 'mba', 'esq',
  ]);
  const ASIAN_SURNAMES = new Set([
    'ahn', 'alam', 'ali', 'amin', 'an', 'ang', 'bai', 'banerjee', 'bao',
    'basu', 'bhatt', 'bhat', 'biswas', 'bose', 'bui', 'cai', 'cao', 'chan',
    'chandra', 'chang', 'chatterjee', 'che', 'chen', 'cheng', 'cheung',
    'chiang', 'cho', 'chong', 'chow', 'chu', 'chung', 'dai', 'dang', 'dao',
    'das', 'deng', 'desai', 'dewan', 'dinh', 'do', 'dong', 'du', 'duong',
    'fan', 'fang', 'feng', 'fu', 'gao', 'ghosh', 'go', 'goh', 'gong',
    'gu', 'guo', 'gupta', 'ha', 'han', 'he', 'ho', 'hong', 'hou', 'hsieh',
    'hsu', 'hu', 'huang', 'hwang', 'ito', 'iyer', 'jang', 'jha', 'jiang',
    'jin', 'jo', 'joshi', 'kamat', 'kao', 'kapoor', 'kato', 'khan', 'khanna',
    'kim', 'kishore', 'koh', 'kong', 'kumar', 'kwak', 'kwan', 'kwok', 'lam',
    'lau', 'le', 'lee', 'li', 'lian', 'liang', 'liao', 'lim', 'lin', 'liu',
    'lo', 'lu', 'luo', 'ma', 'mah', 'malhotra', 'mao', 'matsumoto',
    'mehta', 'menon', 'min', 'mishra', 'mohanty', 'moon', 'mukherjee',
    'na', 'nakamura', 'nakamura', 'ng', 'ngo', 'nguyen', 'nishimura',
    'oh', 'okada', 'ono', 'oyang', 'pan', 'pandey', 'park', 'patel',
    'pham', 'phung', 'qian', 'qin', 'rao', 'reddy', 'ren', 'saha', 'saito',
    'sakurai', 'sato', 'sen', 'seo', 'shah', 'sharma', 'shen', 'shi',
    'shibata', 'shimizu', 'singh', 'song', 'son', 'su', 'sun', 'suzuki',
    'takahashi', 'tan', 'tang', 'tao', 'thakur', 'thi', 'tian', 'to',
    'tong', 'tran', 'trinh', 'tsai', 'wang', 'watanabe', 'wei', 'wen',
    'wong', 'woo', 'wu', 'xiang', 'xiao', 'xie', 'xu', 'xue', 'yamamoto',
    'yamashita', 'yan', 'yang', 'yao', 'ye', 'yeh', 'yi', 'yin', 'yoon',
    'you', 'young', 'yu', 'yuan', 'zeng', 'zhang', 'zhao', 'zheng', 'zhong',
    'zhou', 'zhu',
  ]);

  const EXCLUDED_TITLE_PATTERNS = [
    /\bco[\s-]?founder\b/,
    /\bfounder\b/,
    /\bowner\b/,
    /\bchief\b/,
    /\b(?:ceo|cfo|coo|cto|cio|cmo|cro|cpo)\b/,
    /\bpresident\b/,
    /\bvice[\s-]+president\b/,
    /\bvp\b/,
    /\bdirector\b/,
    /\bhead[\s-]+of\b/,
    /\bpartner\b/,
    /\bprincipal\b/,
    /\bmanager\b/,
  ];
  const POSITIVE_TITLE_PATTERNS = [
    /\bengineer(?:ing)?\b/,
    /\bdata\b/,
    /\banalytics?\b/,
    /\banalyst\b/,
    /\bdata[\s-]+scien(?:ce|tist)\b/,
    /\bmachine[\s-]+learning\b/,
    /\bml\b/,
    /\bartificial[\s-]+intelligence\b/,
    /\bai\b/,
    /\bbusiness[\s-]+intelligence\b/,
    /\bbi\b/,
    /\bdatabase\b/,
    /\bdba\b/,
  ];

  function normalize(value) {
    return String(value || '')
      .normalize('NFKD')
      .replace(/\p{Diacritic}/gu, '')
      .toLowerCase()
      .replace(/[’']/g, '')
      .replace(/\./g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function extractSurname(fullName) {
    const normalized = normalize(fullName);
    if (!normalized) return '';

    const commaParts = normalized.split(',').map((part) => part.trim());
    if (commaParts.length > 1) {
      const possibleSurname = commaParts[0]
        .split(/\s+/)
        .filter((token) => !HONORIFICS.has(token));
      return possibleSurname[possibleSurname.length - 1] || '';
    }

    const tokens = normalized
      .split(/\s+/)
      .filter((token, index) => !(index === 0 && HONORIFICS.has(token)));
    while (tokens.length > 1 && SUFFIXES.has(tokens[tokens.length - 1])) {
      tokens.pop();
    }
    return tokens[tokens.length - 1] || '';
  }

  function hasAsianSurname(fullName) {
    const surname = extractSurname(fullName);
    if (!surname) return false;
    return ASIAN_SURNAMES.has(surname) ||
      surname.split('-').some((part) => ASIAN_SURNAMES.has(part));
  }

  function matchesAny(value, patterns) {
    const normalized = normalize(value).replace(/[/_]/g, ' ');
    return patterns.some((pattern) => pattern.test(normalized));
  }

  function isExcludedTitle(title) {
    return matchesAny(title, EXCLUDED_TITLE_PATTERNS);
  }

  function hasTargetTitle(title) {
    return matchesAny(title, POSITIVE_TITLE_PATTERNS);
  }

  function classifyCandidate(candidate) {
    if (isExcludedTitle(candidate && candidate.title)) return 'excluded';
    if (hasAsianSurname(candidate && candidate.name)) return 'surname';
    if (hasTargetTitle(candidate && candidate.title)) return 'title';
    return 'ineligible';
  }

  function rankCandidates(candidates, selectedUrls = new Set()) {
    const seen = new Set(selectedUrls);
    const surnameMatches = [];
    const titleMatches = [];

    for (const candidate of candidates || []) {
      if (!candidate || !candidate.url || !candidate.name || seen.has(candidate.url)) {
        continue;
      }
      seen.add(candidate.url);
      const classification = classifyCandidate(candidate);
      if (classification === 'surname') surnameMatches.push(candidate);
      if (classification === 'title') titleMatches.push(candidate);
    }
    return surnameMatches.concat(titleMatches);
  }

  global.CandidateRules = Object.freeze({
    classifyCandidate,
    extractSurname,
    hasAsianSurname,
    hasTargetTitle,
    isExcludedTitle,
    rankCandidates,
  });
})(globalThis);
```

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run:

```bash
node --test candidate-rules.test.js
```

Expected: 5 tests pass, 0 fail.

- [ ] **Step 5: Commit the rules module**

```bash
git add candidate-rules.js candidate-rules.test.js
git commit -m "feat: add canvass candidate rules"
```

### Task 2: Load the Rules Before the LinkedIn Content Script

**Files:**
- Modify: `manifest.json:22-27`
- Modify: `detect.test.js:6-13`
- Modify: `detect.test.js:190-194`

- [ ] **Step 1: Strengthen the manifest test**

Change the manifest assertion in `detect.test.js` to:

```js
assert.deepEqual(
  manifest.content_scripts[0].js,
  ['candidate-rules.js', 'detect.js'],
);
```

In `loadDetect`, immediately after `vm.createContext(sandbox)`, load both scripts:

```js
vm.runInContext(fs.readFileSync('candidate-rules.js', 'utf8'), sandbox, {
  filename: 'candidate-rules.js',
});
vm.runInContext(fs.readFileSync('detect.js', 'utf8'), sandbox, {
  filename: 'detect.js',
});
```

- [ ] **Step 2: Run the manifest test and verify RED**

Run:

```bash
node --test --test-name-pattern="manifest configures" detect.test.js
```

Expected: FAIL because the manifest contains only `detect.js`.

- [ ] **Step 3: Update the content-script order**

Change `manifest.json` to:

```json
"js": ["candidate-rules.js", "detect.js"]
```

- [ ] **Step 4: Run the manifest test and verify GREEN**

Run:

```bash
node --test --test-name-pattern="manifest configures" detect.test.js
```

Expected: 1 matching test passes, 0 fail.

- [ ] **Step 5: Commit the manifest integration**

```bash
git add manifest.json detect.test.js
git commit -m "feat: load canvass candidate rules"
```

### Task 3: Implement Card Parsing and Bounded Additional-Result Loading

**Files:**
- Modify: `detect.test.js:23-194`
- Modify: `detect.js:14-22`
- Modify: `detect.js:258-336`

- [ ] **Step 1: Extend the VM element and observer harness**

Extend `makeElement` with `disabled`, `nodeType`, `style`, mutable classes, `addEventListener`, and generic attributes. Add `disconnect()` to the MutationObserver fake. Load `candidate-rules.js` before `detect.js`.

Add focused tests that construct cards with:

```js
function makeProfileCard({ name, title, url }) {
  const link = makeElement({ href: url });
  const nameElement = makeElement({ textContent: name });
  const titleElement = makeElement({ textContent: title });
  return makeElement({
    querySelectorMap: {
      'a[data-test-app-aware-link][href*="/in/"], a[href*="/in/"]': link,
      '.artdeco-entity-lockup__title': nameElement,
      '.artdeco-entity-lockup__subtitle': titleElement,
    },
  });
}

test('extractProfileCandidate reads name, title, and profile URL', () => {
  const card = makeProfileCard({
    name: 'Amy Chen',
    title: 'Data Engineer',
    url: 'https://www.linkedin.com/in/amy-chen/',
  });
  const sandbox = loadDetect(makeDocument());

  const candidate = sandbox.extractProfileCandidate(card);

  assert.equal(candidate.name, 'Amy Chen');
  assert.equal(candidate.title, 'Data Engineer');
  assert.equal(candidate.url, 'https://www.linkedin.com/in/amy-chen/');
  assert.equal(candidate.card, card);
});

test('findShowMoreResultsButton requires exact visible text and enabled state', () => {
  const wrong = makeElement({ textContent: 'Show more jobs' });
  const right = makeElement({ textContent: ' Show more results ' });
  const sandbox = loadDetect(makeDocument({
    querySelectorAllMap: { 'button, [role="button"]': [wrong, right] },
  }));

  assert.equal(sandbox.findShowMoreResultsButton(), right);
});
```

Add an async bounded-loading test by replacing `waitForAdditionalProfileCards` with a resolved function and returning a fresh button for each scan:

```js
test('loadAdditionalPeople clicks Show more results at most twice in sequence', async () => {
  const first = makeElement({ textContent: 'Show more results' });
  const second = makeElement({ textContent: 'Show more results' });
  const buttons = [first, second];
  const sandbox = loadDetect(makeDocument());
  sandbox.findShowMoreResultsButton = () => buttons.shift() || null;
  sandbox.getProfileUrlSet = () => new Set();
  sandbox.waitForAdditionalProfileCards = async () => true;

  const attempts = await sandbox.loadAdditionalPeople();

  assert.equal(attempts, 2);
  assert.equal(first.clicked, true);
  assert.equal(second.clicked, true);
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
node --test --test-name-pattern="extractProfileCandidate|findShowMoreResultsButton|loadAdditionalPeople" detect.test.js
```

Expected: FAIL because the three browser functions do not exist.

- [ ] **Step 3: Add constants, card parsing, and bounded loading**

Add near the existing constants:

```js
const AUTO_SELECT_TARGET = 10;
const AUTO_SELECT_MAX_LOADS = 2;
const AUTO_SELECT_LOAD_TIMEOUT_MS = 5000;
let autoSelectRunning = false;
```

Add before `addSelectButtonsToProfiles`:

```js
function getProfileCards() {
  return Array.from(document.querySelectorAll(
    'li.org-people-profile-card__profile-card-spacing'
  ));
}

function extractProfileCandidate(card) {
  const link = card.querySelector(
    'a[data-test-app-aware-link][href*="/in/"], a[href*="/in/"]'
  );
  const nameElement = card.querySelector('.artdeco-entity-lockup__title');
  const titleElement = card.querySelector(
    '.artdeco-entity-lockup__subtitle, .org-people-profile-card__profile-title'
  );
  const url = link && (link.href || link.getAttribute('href'));
  const name = nameElement && nameElement.textContent.trim();
  if (!url || !name) return null;
  return {
    name,
    title: titleElement ? titleElement.textContent.trim() : '',
    url,
    card,
  };
}

function getProfileUrlSet() {
  return new Set(
    getProfileCards()
      .map(extractProfileCandidate)
      .filter(Boolean)
      .map((candidate) => candidate.url)
  );
}

function findShowMoreResultsButton() {
  return Array.from(document.querySelectorAll('button, [role="button"]'))
    .find((element) => {
      const text = (element.textContent || '').replace(/\s+/g, ' ').trim();
      const label = (element.getAttribute('aria-label') || '')
        .replace(/\s+/g, ' ')
        .trim();
      return !element.disabled &&
        element.getAttribute('aria-disabled') !== 'true' &&
        (text === 'Show more results' || label === 'Show more results');
    }) || null;
}

function waitForAdditionalProfileCards(previousUrls, timeoutMs = AUTO_SELECT_LOAD_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (didLoad) => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      clearTimeout(timeoutId);
      resolve(didLoad);
    };
    const hasNewProfile = () => {
      for (const url of getProfileUrlSet()) {
        if (!previousUrls.has(url)) return true;
      }
      return false;
    };
    const observer = new MutationObserver(() => {
      if (hasNewProfile()) finish(true);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    const timeoutId = setTimeout(() => finish(hasNewProfile()), timeoutMs);
    if (hasNewProfile()) finish(true);
  });
}

async function loadAdditionalPeople() {
  let attempts = 0;
  while (attempts < AUTO_SELECT_MAX_LOADS) {
    const button = findShowMoreResultsButton();
    if (!button) break;
    updateAutoSelectStatus(`Loading people ${attempts + 1}/${AUTO_SELECT_MAX_LOADS}…`);
    const previousUrls = getProfileUrlSet();
    button.click();
    attempts += 1;
    const didLoad = await waitForAdditionalProfileCards(previousUrls);
    if (!didLoad) break;
  }
  return attempts;
}
```

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run:

```bash
node --test --test-name-pattern="extractProfileCandidate|findShowMoreResultsButton|loadAdditionalPeople" detect.test.js
```

Expected: 3 matching tests pass, 0 fail.

- [ ] **Step 5: Commit card parsing and loading**

```bash
git add detect.js detect.test.js
git commit -m "feat: load additional LinkedIn people results"
```

### Task 4: Add Auto-Selection State and Floating-Panel Controls

**Files:**
- Modify: `detect.test.js`
- Modify: `detect.js:278-565`

- [ ] **Step 1: Write failing controller tests**

Add tests that replace `loadAdditionalPeople`, `getProfileCards`, `updateFloatingPanel`, `updateAutoSelectStatus`, and `syncProfileSelectButton` in the VM. Cover:

```js
test('autoSelectProfiles preserves existing profiles and fills to ten by priority', async () => {
  const sandbox = loadDetect(makeDocument(), 'https://www.linkedin.com/company/acme/people/');
  const existing = Array.from({ length: 8 }, (_, index) => ({
    name: `Existing ${index}`,
    url: `/in/existing-${index}`,
    status: 'pending',
  }));
  const candidates = [
    { name: 'Jamie Robertson', title: 'Software Engineer', url: '/in/engineer' },
    { name: 'Amy Chen', title: 'Designer', url: '/in/chen' },
    { name: 'Chris Kim', title: 'Director of Data', url: '/in/director' },
  ];
  vm.runInContext(`selectedProfiles = ${JSON.stringify(existing)}`, sandbox);
  sandbox.loadAdditionalPeople = async () => 2;
  sandbox.getProfileCards = () => candidates.map((candidate) => candidate.card || candidate);
  sandbox.extractProfileCandidate = (candidate) => candidate;
  sandbox.updateFloatingPanel = () => {};
  sandbox.updateAutoSelectStatus = (message) => { sandbox.__status = message; };
  sandbox.syncProfileSelectButton = () => {};

  await sandbox.autoSelectProfiles();

  const selected = vm.runInContext('selectedProfiles', sandbox);
  assert.equal(selected.length, 10);
  assert.equal(selected[8].url, '/in/chen');
  assert.equal(selected[9].url, '/in/engineer');
  assert.equal(sandbox.__status, 'Selected 10/10 profiles');
});

test('autoSelectProfiles reports fewer than ten and does not run concurrently', async () => {
  const sandbox = loadDetect(makeDocument(), 'https://www.linkedin.com/company/acme/people/');
  let releaseLoading;
  sandbox.loadAdditionalPeople = () => new Promise((resolve) => {
    releaseLoading = resolve;
  });
  sandbox.getProfileCards = () => [];
  sandbox.updateFloatingPanel = () => {};
  sandbox.updateAutoSelectStatus = (message) => { sandbox.__status = message; };

  const first = sandbox.autoSelectProfiles();
  const secondResult = await sandbox.autoSelectProfiles();
  assert.equal(secondResult, false);
  releaseLoading(0);
  await first;
  assert.equal(sandbox.__status, 'Only found 0/10 matching profiles');
});
```

- [ ] **Step 2: Run the controller tests and verify RED**

Run:

```bash
node --test --test-name-pattern="autoSelectProfiles" detect.test.js
```

Expected: FAIL because `autoSelectProfiles` and UI status helpers do not exist.

- [ ] **Step 3: Extract reusable Select button state**

Add:

```js
function setProfileSelectButtonState(button, isSelected) {
  if (!button) return;
  button.innerHTML = isSelected
    ? '<span class="artdeco-button__text">Selected ✓</span>'
    : '<span class="artdeco-button__text">Select</span>';
  button.classList.toggle('artdeco-button--primary', isSelected);
  button.classList.toggle('artdeco-button--tertiary', !isSelected);
}

function syncProfileSelectButton(candidate, isSelected = true) {
  const button = candidate.card &&
    candidate.card.querySelector('.profile-select-button');
  setProfileSelectButtonState(button, isSelected);
}
```

Replace the duplicated manual-select, remove, and Clear All class/HTML mutations with this helper.

- [ ] **Step 4: Implement the auto-selection controller**

Add:

```js
function updateAutoSelectStatus(message) {
  const status = document.getElementById('auto-select-status');
  if (status) status.textContent = message;
}

function setAutoSelectButtonRunning(isRunning) {
  const button = document.getElementById('auto-select-profiles');
  if (!button) return;
  button.disabled = isRunning;
  button.setAttribute('aria-busy', String(isRunning));
}

async function autoSelectProfiles() {
  if (autoSelectRunning) return false;
  if (selectedProfiles.length >= AUTO_SELECT_TARGET) {
    updateAutoSelectStatus(`Selected ${selectedProfiles.length}/${AUTO_SELECT_TARGET} profiles`);
    return true;
  }

  autoSelectRunning = true;
  setAutoSelectButtonRunning(true);
  try {
    await loadAdditionalPeople();
    const candidates = getProfileCards()
      .map(extractProfileCandidate)
      .filter(Boolean);
    updateAutoSelectStatus(`Reviewing ${candidates.length} profiles…`);
    const selectedUrls = new Set(selectedProfiles.map((profile) => profile.url));
    const ranked = CandidateRules.rankCandidates(candidates, selectedUrls);
    const slots = Math.max(0, AUTO_SELECT_TARGET - selectedProfiles.length);

    for (const candidate of ranked.slice(0, slots)) {
      selectedProfiles.push({
        name: candidate.name,
        url: candidate.url,
        status: 'pending',
      });
      syncProfileSelectButton(candidate, true);
    }

    updateFloatingPanel();
    const message = selectedProfiles.length >= AUTO_SELECT_TARGET
      ? `Selected ${AUTO_SELECT_TARGET}/${AUTO_SELECT_TARGET} profiles`
      : `Only found ${selectedProfiles.length}/${AUTO_SELECT_TARGET} matching profiles`;
    updateAutoSelectStatus(message);
    return true;
  } catch (error) {
    updateAutoSelectStatus(`Auto-select failed: ${error.message || String(error)}`);
    return false;
  } finally {
    autoSelectRunning = false;
    setAutoSelectButtonRunning(false);
  }
}
```

- [ ] **Step 5: Add the floating-panel status and button**

In `createFloatingPanel`, create:

```js
const autoSelectStatus = document.createElement('div');
autoSelectStatus.id = 'auto-select-status';
autoSelectStatus.textContent = 'Ready to auto-select';
autoSelectStatus.style.padding = '8px 12px';
autoSelectStatus.style.fontSize = '12px';
autoSelectStatus.style.color = '#666';
autoSelectStatus.style.borderTop = '1px solid #e0e0e0';

const autoSelectButton = document.createElement('button');
autoSelectButton.id = 'auto-select-profiles';
autoSelectButton.className =
  'artdeco-button artdeco-button--2 artdeco-button--secondary';
autoSelectButton.innerHTML =
  '<span class="artdeco-button__text">Auto-select 10</span>';
autoSelectButton.onclick = autoSelectProfiles;
```

Set the footer to wrap with a gap:

```js
footer.style.flexWrap = 'wrap';
footer.style.gap = '8px';
```

Append the status before the footer, and append `autoSelectButton` before Clear All and Connect to All.

- [ ] **Step 6: Run the controller and full tests**

Run:

```bash
node --test --test-name-pattern="autoSelectProfiles" detect.test.js
node --test
```

Expected: controller tests pass; complete suite passes with 0 failures.

- [ ] **Step 7: Commit the auto-selection UI**

```bash
git add detect.js detect.test.js
git commit -m "feat: auto-select ten canvass candidates"
```

### Task 5: Document and Verify the Feature

**Files:**
- Modify: `README.md:5-24`

- [ ] **Step 1: Add README usage and limits**

Add a feature bullet:

```md
- **Canvass Candidate Selection**: On a LinkedIn company People page, load up
  to two additional result batches and fill the review list to ten candidates,
  prioritizing configured Asian surname romanizations and then Engineer/Data
  titles while excluding high-seniority roles
```

Add a workflow section:

```md
## Auto-Selecting Canvass Candidates

1. Open a LinkedIn company `People` page.
2. Click `Auto-select 10` in the extension's floating panel.
3. The extension preserves profiles already selected, clicks
   `Show more results` at most twice, and fills the list to ten.
4. Review the selected profiles.
5. Click `Connect to All` only when you are ready to send invitations.

The surname rule is a text heuristic based on the displayed name. It can
produce false positives or miss uncommon names and does not determine a
person's actual identity or ethnicity.
```

- [ ] **Step 2: Run final automated verification**

Run:

```bash
node --test
git diff --check
git status --short
```

Expected: all tests pass, `git diff --check` exits 0, and only `README.md` is uncommitted.

- [ ] **Step 3: Perform manual Chrome verification**

Load the worktree directory as an unpacked extension, open a LinkedIn company People page, and verify:

1. `Auto-select 10` is visible.
2. It clicks `Show more results` no more than twice.
3. Existing manual selections remain.
4. Excluded senior titles are not added.
5. Surname matches precede title-only matches.
6. The list stops at ten and no invitation is sent.
7. Fewer than ten matches produces `Only found N/10 matching profiles`.

Expected: all seven checks pass. If LinkedIn access is unavailable, record manual verification as pending without claiming it passed.

- [ ] **Step 4: Commit documentation**

```bash
git add README.md
git commit -m "docs: explain canvass candidate auto-selection"
```

- [ ] **Step 5: Verify the committed worktree**

Run:

```bash
node --test
git diff --check
git status --short --branch
```

Expected: all tests pass, no whitespace errors, and the branch has a clean working tree.
