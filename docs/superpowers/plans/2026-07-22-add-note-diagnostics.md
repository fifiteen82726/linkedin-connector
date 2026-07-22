# Add Note Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add bounded, structured console diagnostics that identify which frame is scanning for LinkedIn's Add-a-note modal and why selector or frame delegation fails.

**Architecture:** Keep automation behavior unchanged and add a small diagnostic layer inside `detect.js`. Diagnostic helpers produce `[LinkedIn Invite]` events with shared frame context; existing modal scanning, frame delegation, message reception, and selector matching call those helpers at decision boundaries. Tests capture console calls in the existing VM harness and assert structured event fields.

**Tech Stack:** Chrome Manifest V3 content script, browser DOM APIs, Node.js `node:test`, `vm`, and strict assertions.

---

### Task 1: Capture Structured Console Events In Tests

**Files:**
- Modify: `detect.test.js`

- [ ] **Step 1: Extend the VM harness with console capture**

Add a `logs` option to `loadDetect()` and append all `console.log()` argument arrays:

```js
function loadDetect(
  document,
  href = 'https://www.linkedin.com/in/yoojin-lim/',
  { isTopFrame = true, logs = [], setTimeout = () => {}, settings = {} } = {},
) {
  // Existing setup remains unchanged.
  const sandbox = {
    __logs: logs,
    console: {
      log(...args) {
        logs.push(args);
      },
    },
    // Existing sandbox fields remain unchanged.
  };
}
```

- [ ] **Step 2: Run the existing suite**

Run: `node --test detect.test.js`

Expected: all existing tests pass; the harness-only change does not alter production behavior.

### Task 2: Add Shared Diagnostic Context And Scan Snapshots

**Files:**
- Modify: `detect.test.js`
- Modify: `detect.js`

- [ ] **Step 1: Write a failing scan diagnostic test**

Create a document with a visible modal outlet but no Add-a-note button, call `handleAddNote(false, 0)`, and assert a structured `ADD_NOTE_SCAN` event:

```js
test('handleAddNote logs frame and modal diagnostics when scanning fails', () => {
  const logs = [];
  const document = makeDocument({
    querySelectorAllMap: {
      '#artdeco-modal-outlet': [makeElement()],
      '[data-test-modal-id="send-invite-modal"]': [makeElement()],
      '[data-test-modal]': [makeElement()],
      'button[aria-label="Add a note"]': [],
      button: [],
      iframe: [],
    },
  });
  const sandbox = loadDetect(document, undefined, { logs });

  sandbox.handleAddNote(false, 0);

  const event = logs.map((entry) => entry[1]).find((value) => value?.event === 'ADD_NOTE_SCAN');
  assert.equal(event.frameRole, 'top');
  assert.equal(event.retriesRemaining, 0);
  assert.equal(event.modalOutletCount, 1);
  assert.equal(event.dialogCount, 1);
  assert.equal(event.addNoteButtonCount, 0);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test --test-name-pattern='logs frame and modal diagnostics' detect.test.js`

Expected: FAIL because no `ADD_NOTE_SCAN` event exists.

- [ ] **Step 3: Implement diagnostic helpers and bounded scan logging**

Add helpers to `detect.js`:

```js
const ADD_NOTE_INITIAL_RETRIES = 20;

function getDiagnosticContext() {
  return {
    frameRole: window === window.top ? 'top' : 'child',
    url: window.location.href,
    readyState: document.readyState || 'unknown',
    visibilityState: document.visibilityState || 'unknown'
  };
}

function logDiagnostic(event, details = {}) {
  console.log('[LinkedIn Invite]', {
    event,
    ...getDiagnosticContext(),
    ...details
  });
}

function summarizeButton(button) {
  return {
    text: (button.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120),
    ariaLabel: button.getAttribute('aria-label') || '',
    id: button.id || '',
    disabled: Boolean(button.disabled)
  };
}

function logAddNoteScan(retriesRemaining) {
  const attempt = ADD_NOTE_INITIAL_RETRIES - retriesRemaining + 1;
  const shouldIncludeSnapshot = retriesRemaining === ADD_NOTE_INITIAL_RETRIES ||
    retriesRemaining % 5 === 0;
  if (!shouldIncludeSnapshot) return;

  const details = {
    attempt,
    retriesRemaining,
    modalOutletCount: document.querySelectorAll('#artdeco-modal-outlet').length,
    dialogCount: document.querySelectorAll('[data-test-modal-id="send-invite-modal"]').length,
    modalCount: document.querySelectorAll('[data-test-modal]').length,
    addNoteButtonCount: document.querySelectorAll('button[aria-label="Add a note"]').length,
    accessibleDocumentCount: getAccessibleDocuments().length,
    iframeCount: document.querySelectorAll('iframe').length,
    activeElement: document.activeElement ? summarizeButton(document.activeElement) : null
  };

  if (retriesRemaining === 0) {
    details.buttonSamples = Array.from(document.querySelectorAll('button'))
      .slice(0, 20)
      .map(summarizeButton);
  }

  logDiagnostic('ADD_NOTE_SCAN', details);
}
```

Call `logAddNoteScan(retriesRemaining)` at the start of `handleAddNote()`.

- [ ] **Step 4: Add one script initialization event**

After settings initialization, call:

```js
logDiagnostic('SCRIPT_INIT', {
  referrer: document.referrer || ''
});
```

- [ ] **Step 5: Run focused and full tests**

Run: `node --test --test-name-pattern='logs frame and modal diagnostics' detect.test.js`

Expected: PASS.

Run: `node --test detect.test.js`

Expected: all tests pass.

### Task 3: Add Frame Delegation And Message Diagnostics

**Files:**
- Modify: `detect.test.js`
- Modify: `detect.js`

- [ ] **Step 1: Write failing frame outcome assertions**

Extend the existing parent broadcast test with captured logs and assert:

```js
const events = logs.map((entry) => entry[1]?.event).filter(Boolean);
assert.equal(events.filter((event) => event === 'FRAME_DISCOVERY').length, 2);
assert.equal(events.filter((event) => event === 'FRAME_MESSAGE_SENT').length, 1);
assert.equal(events.filter((event) => event === 'FRAME_MESSAGE_SKIPPED').length, 1);
```

Extend the child command test to assert a `FRAME_MESSAGE_RECEIVED` event whose `sourceIsParent` is true.

- [ ] **Step 2: Run both focused tests and verify RED**

Run: `node --test --test-name-pattern='parent frame broadcasts|child frame handles' detect.test.js`

Expected: FAIL because frame diagnostic events do not exist.

- [ ] **Step 3: Instrument delegation without changing recipient selection**

Inside `broadcastInviteModalCommand()`, log one `FRAME_DISCOVERY` event per iframe with index, source, parsed origin, LinkedIn status, `contentWindow` availability, and readable `contentDocument` status. Log `FRAME_MESSAGE_SENT`, `FRAME_MESSAGE_SKIPPED`, or `FRAME_MESSAGE_ERROR` for the existing branch result. After iteration, log `INVITE_DELEGATED` with `recipients`.

- [ ] **Step 4: Filter and instrument invite command reception**

Remove the unconditional `RECEIVED MESSAGE FROM PARENT TAB` log. For messages with the extension source and `handleInviteModal` action, log `FRAME_MESSAGE_RECEIVED` with `origin`, `sourceIsParent`, and action before applying the existing validation.

- [ ] **Step 5: Run focused and full tests**

Run: `node --test --test-name-pattern='parent frame broadcasts|child frame handles' detect.test.js`

Expected: PASS.

Run: `node --test detect.test.js`

Expected: all tests pass.

### Task 4: Add Selector Success Diagnostics And Verify

**Files:**
- Modify: `detect.test.js`
- Modify: `detect.js`

- [ ] **Step 1: Write a failing selector-match diagnostic test**

Use the existing Add-note button fixture, capture logs, call `findAddNoteButton()`, and assert `ADD_NOTE_FOUND` includes `documentIndex: 0` and `selector: 'button[aria-label="Add a note"]'`.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test --test-name-pattern='logs the selector that found Add a note' detect.test.js`

Expected: FAIL because `ADD_NOTE_FOUND` is not logged.

- [ ] **Step 3: Instrument selector matches and click boundary**

In `findAddNoteButton()`, iterate with document indexes and log `ADD_NOTE_FOUND` immediately before returning a matched button. In `handleAddNote()`, log `ADD_NOTE_CLICK` with `summarizeButton(addNoteButton)` immediately before `.click()`.

- [ ] **Step 4: Run all verification commands**

Run: `node --test detect.test.js`

Expected: all tests pass.

Run: `node --check detect.js && node --check detect.test.js`

Expected: exit code 0 with no output.

Run: `node -e "JSON.parse(require('node:fs').readFileSync('manifest.json','utf8'))"`

Expected: exit code 0 with no output.

Run: `git diff --check`

Expected: exit code 0 with no whitespace errors.

