# Reply Template Popup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an `Option+E` reply-template modal on LinkedIn where users can edit a template for one-time copying, explicitly save edits, and add persistent custom templates.

**Architecture:** Load a small template store and modal module before `detect.js`, then let the existing top-frame keydown handler open the modal. Keep built-in template text in source, store only built-in overrides and custom templates in `chrome.storage.local`, and keep all unsaved textarea edits inside the current modal instance. Use a controller boundary so storage and clipboard behavior can be tested with Node's existing `node:test` and `vm` setup without introducing a build system or DOM dependency.

**Tech Stack:** Chrome/Brave Manifest V3, content scripts, `chrome.storage.local`, Clipboard API, browser DOM/CSS, Node.js `node:test`, `vm`, and strict assertions.

**Execution precondition:** The current worktree contains uncommitted invitation-automation changes that this plan depends on. Do not discard or overwrite them. Before implementation, preserve those changes in a commit or create a worktree from a commit containing them.

**Product decisions:**

- The first built-in template is titled `Referral follow-up`.
- Copy uses the current textarea value, including unsaved edits, and closes the modal only after the clipboard write succeeds.
- Save persists the current textarea value and keeps the modal open.
- Closing the modal discards edits that were not saved.
- Adding a custom template requires a non-empty title and body and persists immediately.
- Reply-template state uses `chrome.storage.local` so the included email address and phone number are not synced through Chrome/Brave sync.
- Deleting, renaming, reordering, importing, and exporting templates are outside this first version.

---

### Task 1: Add The Persistent Built-In Template Store

**Files:**
- Create: `reply-template-store.js`
- Create: `reply-template-store.test.js`

- [ ] **Step 1: Write a VM harness and failing built-in-template tests**

Create `reply-template-store.test.js`:

```js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const EXPECTED_DEFAULT_BODY = `Yes, thank you so much for connecting with me. The job market is brutal now, I truly appreciate your time and support. I’m very interested in this position. I've attached my resume. Let me know if you need more info.

**Job - link**

First Name: Yi-Yun
Last Name: Liao
Email: yiyunliao0321@gmail.com
Phone: 929-313-3362`;

function loadStore(initialState) {
  let storedState = initialState;
  const writes = [];
  const sandbox = {
    __writes: writes,
    chrome: {
      runtime: { lastError: null },
      storage: {
        local: {
          get(key, callback) {
            callback(storedState === undefined ? {} : { [key]: storedState });
          },
          set(value, callback) {
            storedState = value.replyTemplateState;
            writes.push(value);
            callback();
          },
        },
      },
    },
    crypto: {
      randomUUID() {
        return 'uuid-1';
      },
    },
    globalThis: null,
    Promise,
    Set,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(
    fs.readFileSync('reply-template-store.js', 'utf8'),
    sandbox,
    { filename: 'reply-template-store.js' },
  );
  return sandbox;
}

test('store exposes the built-in referral follow-up template', async () => {
  const sandbox = loadStore();
  const store = sandbox.ReplyTemplateStore.createStore();

  const templates = await store.getTemplates();

  assert.equal(templates.length, 1);
  assert.equal(templates[0].id, 'referral-follow-up');
  assert.equal(templates[0].title, 'Referral follow-up');
  assert.equal(templates[0].body, EXPECTED_DEFAULT_BODY);
  assert.equal(templates[0].kind, 'builtin');
});

test('saving a built-in template stores an override', async () => {
  const sandbox = loadStore();
  const store = sandbox.ReplyTemplateStore.createStore();

  await store.saveBody('referral-follow-up', 'Edited reply');
  const templates = await store.getTemplates();

  assert.equal(templates[0].body, 'Edited reply');
  assert.deepEqual(
    JSON.parse(JSON.stringify(sandbox.__writes[0])),
    {
      replyTemplateState: {
        version: 1,
        overrides: { 'referral-follow-up': 'Edited reply' },
        customTemplates: [],
      },
    },
  );
});

test('saving rejects an empty template body', async () => {
  const sandbox = loadStore();
  const store = sandbox.ReplyTemplateStore.createStore();

  await assert.rejects(
    store.saveBody('referral-follow-up', '   '),
    /Template body is required/,
  );
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
node --test reply-template-store.test.js
```

Expected: FAIL because `reply-template-store.js` does not exist.

- [ ] **Step 3: Implement the built-in template state and storage adapter**

Create `reply-template-store.js`:

```js
(function initializeReplyTemplateStore(global) {
  const STORAGE_KEY = 'replyTemplateState';
  const STATE_VERSION = 1;
  const DEFAULT_TEMPLATES = Object.freeze([
    Object.freeze({
      id: 'referral-follow-up',
      title: 'Referral follow-up',
      body: `Yes, thank you so much for connecting with me. The job market is brutal now, I truly appreciate your time and support. I’m very interested in this position. I've attached my resume. Let me know if you need more info.

**Job - link**

First Name: Yi-Yun
Last Name: Liao
Email: yiyunliao0321@gmail.com
Phone: 929-313-3362`,
      kind: 'builtin',
    }),
  ]);

  function emptyState() {
    return {
      version: STATE_VERSION,
      overrides: {},
      customTemplates: [],
    };
  }

  function normalizeState(value) {
    if (!value || value.version !== STATE_VERSION) {
      return emptyState();
    }

    return {
      version: STATE_VERSION,
      overrides: value.overrides && typeof value.overrides === 'object'
        ? { ...value.overrides }
        : {},
      customTemplates: Array.isArray(value.customTemplates)
        ? value.customTemplates
          .filter((template) => (
            template &&
            typeof template.id === 'string' &&
            typeof template.title === 'string' &&
            typeof template.body === 'string'
          ))
          .map((template) => ({ ...template, kind: 'custom' }))
        : [],
    };
  }

  function createStore(
    storageArea = chrome.storage.local,
    getLastError = () => chrome.runtime.lastError,
  ) {
    function readState() {
      return new Promise((resolve, reject) => {
        storageArea.get(STORAGE_KEY, (items) => {
          const error = getLastError();
          if (error) {
            reject(new Error(error.message));
            return;
          }
          resolve(normalizeState(items[STORAGE_KEY]));
        });
      });
    }

    function writeState(state) {
      return new Promise((resolve, reject) => {
        storageArea.set({ [STORAGE_KEY]: state }, () => {
          const error = getLastError();
          if (error) {
            reject(new Error(error.message));
            return;
          }
          resolve();
        });
      });
    }

    async function getTemplates() {
      const state = await readState();
      const builtins = DEFAULT_TEMPLATES.map((template) => ({
        ...template,
        body: state.overrides[template.id] ?? template.body,
      }));
      return [...builtins, ...state.customTemplates.map((template) => ({ ...template }))];
    }

    async function saveBody(id, body) {
      if (typeof body !== 'string' || !body.trim()) {
        throw new Error('Template body is required');
      }

      const state = await readState();
      const builtin = DEFAULT_TEMPLATES.some((template) => template.id === id);
      if (builtin) {
        state.overrides[id] = body;
      } else {
        const index = state.customTemplates.findIndex((template) => template.id === id);
        if (index === -1) {
          throw new Error('Template not found');
        }
        state.customTemplates[index] = {
          ...state.customTemplates[index],
          body,
        };
      }
      await writeState(state);
    }

    return {
      getTemplates,
      saveBody,
    };
  }

  global.ReplyTemplateStore = {
    DEFAULT_TEMPLATES,
    STORAGE_KEY,
    createStore,
  };
})(globalThis);
```

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run:

```bash
node --test reply-template-store.test.js
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit the store**

```bash
git add reply-template-store.js reply-template-store.test.js
git commit -m "feat: add persistent reply template store"
```

### Task 2: Add Custom Template Persistence

**Files:**
- Modify: `reply-template-store.js`
- Modify: `reply-template-store.test.js`

- [ ] **Step 1: Write failing custom-template tests**

Append to `reply-template-store.test.js`:

```js
test('adding a custom template persists and returns it', async () => {
  const sandbox = loadStore();
  const store = sandbox.ReplyTemplateStore.createStore();

  const created = await store.addCustomTemplate('Quick follow-up', 'Thanks again.');
  const templates = await store.getTemplates();

  assert.deepEqual(
    JSON.parse(JSON.stringify(created)),
    {
      id: 'custom-uuid-1',
      title: 'Quick follow-up',
      body: 'Thanks again.',
      kind: 'custom',
    },
  );
  assert.equal(templates[1].title, 'Quick follow-up');
  assert.equal(templates[1].body, 'Thanks again.');
});

test('adding a custom template requires a title and body', async () => {
  const sandbox = loadStore();
  const store = sandbox.ReplyTemplateStore.createStore();

  await assert.rejects(
    store.addCustomTemplate('', 'Body'),
    /Template title is required/,
  );
  await assert.rejects(
    store.addCustomTemplate('Title', ''),
    /Template body is required/,
  );
});

test('saved custom-template edits are returned on the next load', async () => {
  const sandbox = loadStore();
  const store = sandbox.ReplyTemplateStore.createStore();
  const created = await store.addCustomTemplate('Follow-up', 'Original');

  await store.saveBody(created.id, 'Updated');
  const templates = await store.getTemplates();

  assert.equal(templates[1].body, 'Updated');
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
node --test --test-name-pattern='custom template|custom-template' reply-template-store.test.js
```

Expected: FAIL because `addCustomTemplate` is not defined.

- [ ] **Step 3: Implement custom-template creation**

Inside `createStore()` in `reply-template-store.js`, add:

```js
async function addCustomTemplate(title, body) {
  const normalizedTitle = typeof title === 'string' ? title.trim() : '';
  if (!normalizedTitle) {
    throw new Error('Template title is required');
  }
  if (typeof body !== 'string' || !body.trim()) {
    throw new Error('Template body is required');
  }

  const state = await readState();
  const template = {
    id: `custom-${crypto.randomUUID()}`,
    title: normalizedTitle,
    body,
    kind: 'custom',
  };
  state.customTemplates.push(template);
  await writeState(state);
  return { ...template };
}
```

Return it from `createStore()`:

```js
return {
  addCustomTemplate,
  getTemplates,
  saveBody,
};
```

- [ ] **Step 4: Run the store suite**

Run:

```bash
node --test reply-template-store.test.js
```

Expected: 6 tests pass.

- [ ] **Step 5: Commit custom-template persistence**

```bash
git add reply-template-store.js reply-template-store.test.js
git commit -m "feat: persist custom reply templates"
```

### Task 3: Build The Modal And Copy/Save Controller

**Files:**
- Create: `reply-templates.js`
- Create: `reply-templates.css`
- Create: `reply-templates.test.js`

- [ ] **Step 1: Write failing controller tests**

Create `reply-templates.test.js`:

```js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

function loadReplyTemplates() {
  const sandbox = {
    globalThis: null,
    console,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(
    fs.readFileSync('reply-templates.js', 'utf8'),
    sandbox,
    { filename: 'reply-templates.js' },
  );
  return sandbox;
}

test('copy writes the current unsaved text and then closes', async () => {
  const sandbox = loadReplyTemplates();
  const events = [];
  const actions = sandbox.ReplyTemplates.createActions({
    clipboard: {
      async writeText(value) {
        events.push(['copy', value]);
      },
    },
    close() {
      events.push(['close']);
    },
    render() {},
    setStatus() {},
    store: {},
  });

  await actions.copy('Edited but unsaved');

  assert.deepEqual(events, [
    ['copy', 'Edited but unsaved'],
    ['close'],
  ]);
});

test('copy keeps the modal open and reports clipboard failure', async () => {
  const sandbox = loadReplyTemplates();
  const events = [];
  const actions = sandbox.ReplyTemplates.createActions({
    clipboard: {
      async writeText() {
        throw new Error('Clipboard unavailable');
      },
    },
    close() {
      events.push(['close']);
    },
    render() {},
    setStatus(message, type) {
      events.push(['status', message, type]);
    },
    store: {},
  });

  await actions.copy('Reply');

  assert.deepEqual(events, [
    ['status', 'Clipboard unavailable', 'error'],
  ]);
});

test('save persists the edited body without closing', async () => {
  const sandbox = loadReplyTemplates();
  const events = [];
  const actions = sandbox.ReplyTemplates.createActions({
    clipboard: {},
    close() {
      events.push(['close']);
    },
    render() {},
    setStatus(message, type) {
      events.push(['status', message, type]);
    },
    store: {
      async saveBody(id, body) {
        events.push(['save', id, body]);
      },
    },
  });

  await actions.save('referral-follow-up', 'Saved edit');

  assert.deepEqual(events, [
    ['save', 'referral-follow-up', 'Saved edit'],
    ['status', 'Saved', 'success'],
  ]);
});

test('add persists a custom template and refreshes the list', async () => {
  const sandbox = loadReplyTemplates();
  const events = [];
  const actions = sandbox.ReplyTemplates.createActions({
    clipboard: {},
    close() {},
    render() {
      events.push(['render']);
    },
    setStatus(message, type) {
      events.push(['status', message, type]);
    },
    store: {
      async addCustomTemplate(title, body) {
        events.push(['add', title, body]);
      },
      async getTemplates() {
        return [{ id: 'custom-1' }];
      },
    },
  });

  await actions.add('My reply', 'Reply body');

  assert.deepEqual(events, [
    ['add', 'My reply', 'Reply body'],
    ['render'],
    ['status', 'Template added', 'success'],
  ]);
});
```

- [ ] **Step 2: Run the controller tests and verify RED**

Run:

```bash
node --test reply-templates.test.js
```

Expected: FAIL because `reply-templates.js` does not exist.

- [ ] **Step 3: Implement the action controller and modal DOM**

Create `reply-templates.js` with this module shape and behavior:

```js
(function initializeReplyTemplates(global) {
  const MODAL_ID = 'linkedin-reply-template-modal';

  function createActions({
    clipboard,
    close,
    render,
    setStatus,
    store,
  }) {
    return {
      async copy(body) {
        try {
          await clipboard.writeText(body);
          close();
        } catch (error) {
          setStatus(error.message || 'Could not copy template', 'error');
        }
      },

      async save(id, body) {
        try {
          await store.saveBody(id, body);
          setStatus('Saved', 'success');
        } catch (error) {
          setStatus(error.message || 'Could not save template', 'error');
        }
      },

      async add(title, body) {
        try {
          await store.addCustomTemplate(title, body);
          render(await store.getTemplates());
          setStatus('Template added', 'success');
        } catch (error) {
          setStatus(error.message || 'Could not add template', 'error');
        }
      },
    };
  }

  function makeButton(doc, label, className) {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = label;
    return button;
  }

  async function showDialog({
    doc = document,
    clipboard = navigator.clipboard,
    store = ReplyTemplateStore.createStore(),
  } = {}) {
    const existing = doc.getElementById(MODAL_ID);
    if (existing) {
      existing.querySelector('textarea')?.focus();
      return existing;
    }

    const backdrop = doc.createElement('div');
    backdrop.id = MODAL_ID;
    backdrop.className = 'reply-template-backdrop';

    const dialog = doc.createElement('section');
    dialog.className = 'reply-template-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'reply-template-title');

    const header = doc.createElement('header');
    header.className = 'reply-template-header';
    const title = doc.createElement('h2');
    title.id = 'reply-template-title';
    title.textContent = 'Reply Templates';
    const closeButton = makeButton(doc, '×', 'reply-template-icon-button');
    closeButton.setAttribute('aria-label', 'Close reply templates');
    header.append(title, closeButton);

    const toolbar = doc.createElement('div');
    toolbar.className = 'reply-template-toolbar';
    const addButton = makeButton(doc, 'Add template', 'reply-template-add-button');
    toolbar.appendChild(addButton);

    const addForm = doc.createElement('form');
    addForm.className = 'reply-template-add-form';
    addForm.hidden = true;
    const nameInput = doc.createElement('input');
    nameInput.type = 'text';
    nameInput.placeholder = 'Template name';
    nameInput.setAttribute('aria-label', 'Template name');
    const bodyInput = doc.createElement('textarea');
    bodyInput.placeholder = 'Template text';
    bodyInput.setAttribute('aria-label', 'Template text');
    const addActions = doc.createElement('div');
    addActions.className = 'reply-template-actions';
    const cancelAddButton = makeButton(doc, 'Cancel', 'reply-template-button secondary');
    const confirmAddButton = makeButton(doc, 'Add', 'reply-template-button primary');
    confirmAddButton.type = 'submit';
    addActions.append(cancelAddButton, confirmAddButton);
    addForm.append(nameInput, bodyInput, addActions);

    const list = doc.createElement('div');
    list.className = 'reply-template-list';
    const status = doc.createElement('p');
    status.className = 'reply-template-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');

    const close = () => {
      doc.removeEventListener('keydown', onKeydown);
      backdrop.remove();
    };
    const setStatus = (message, type) => {
      status.textContent = message;
      status.dataset.type = type;
    };
    const actions = createActions({
      clipboard,
      close,
      render,
      setStatus,
      store,
    });

    function render(templates) {
      list.replaceChildren();
      for (const template of templates) {
        const item = doc.createElement('article');
        item.className = 'reply-template-item';
        const itemTitle = doc.createElement('h3');
        itemTitle.textContent = template.title;
        const textarea = doc.createElement('textarea');
        textarea.value = template.body;
        textarea.setAttribute('aria-label', `${template.title} template`);
        const buttonRow = doc.createElement('div');
        buttonRow.className = 'reply-template-actions';
        const copyButton = makeButton(doc, 'Copy', 'reply-template-button primary');
        const saveButton = makeButton(doc, 'Save', 'reply-template-button secondary');
        copyButton.addEventListener('click', () => actions.copy(textarea.value));
        saveButton.addEventListener(
          'click',
          () => actions.save(template.id, textarea.value),
        );
        buttonRow.append(copyButton, saveButton);
        item.append(itemTitle, textarea, buttonRow);
        list.appendChild(item);
      }
    }

    function onKeydown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    }

    closeButton.addEventListener('click', close);
    addButton.addEventListener('click', () => {
      addForm.hidden = false;
      nameInput.focus();
    });
    cancelAddButton.addEventListener('click', () => {
      addForm.hidden = true;
      addForm.reset();
      setStatus('', '');
    });
    addForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      await actions.add(nameInput.value, bodyInput.value);
      if (status.dataset.type === 'success') {
        addForm.hidden = true;
        addForm.reset();
      }
    });
    doc.addEventListener('keydown', onKeydown);

    dialog.append(header, toolbar, addForm, list, status);
    backdrop.appendChild(dialog);
    doc.body.appendChild(backdrop);

    try {
      render(await store.getTemplates());
      list.querySelector('textarea')?.focus();
    } catch (error) {
      setStatus(error.message || 'Could not load templates', 'error');
    }

    return backdrop;
  }

  global.ReplyTemplates = {
    MODAL_ID,
    createActions,
    showDialog,
  };
})(globalThis);
```

- [ ] **Step 4: Add scoped modal styling**

Create `reply-templates.css`:

```css
.reply-template-backdrop {
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(0, 0, 0, 0.52);
}

.reply-template-dialog {
  width: min(720px, 100%);
  max-height: min(760px, calc(100vh - 48px));
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid #d9d9d9;
  border-radius: 8px;
  background: #fff;
  color: #1f2328;
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.28);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.reply-template-header,
.reply-template-toolbar,
.reply-template-actions {
  display: flex;
  align-items: center;
}

.reply-template-header {
  min-height: 56px;
  justify-content: space-between;
  padding: 0 18px;
  border-bottom: 1px solid #e5e7eb;
}

.reply-template-header h2,
.reply-template-item h3 {
  margin: 0;
  letter-spacing: 0;
}

.reply-template-header h2 {
  font-size: 20px;
}

.reply-template-toolbar {
  justify-content: flex-end;
  padding: 12px 18px;
}

.reply-template-list {
  min-height: 0;
  overflow-y: auto;
  padding: 0 18px 18px;
}

.reply-template-item {
  padding: 14px 0;
  border-top: 1px solid #e5e7eb;
}

.reply-template-item h3 {
  margin-bottom: 8px;
  font-size: 15px;
}

.reply-template-item textarea,
.reply-template-add-form textarea,
.reply-template-add-form input {
  box-sizing: border-box;
  width: 100%;
  border: 1px solid #aeb4ba;
  border-radius: 6px;
  background: #fff;
  color: #1f2328;
  font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.reply-template-item textarea,
.reply-template-add-form textarea {
  min-height: 150px;
  padding: 10px;
  resize: vertical;
}

.reply-template-add-form {
  margin: 0 18px 14px;
  padding: 14px;
  border: 1px solid #d9d9d9;
  border-radius: 6px;
  background: #f7f8fa;
}

.reply-template-add-form input {
  height: 40px;
  margin-bottom: 10px;
  padding: 0 10px;
}

.reply-template-actions {
  justify-content: flex-end;
  gap: 8px;
  margin-top: 10px;
}

.reply-template-button,
.reply-template-add-button,
.reply-template-icon-button {
  min-height: 36px;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.reply-template-button,
.reply-template-add-button {
  padding: 0 14px;
}

.reply-template-button.primary {
  border: 1px solid #0a66c2;
  background: #0a66c2;
  color: #fff;
}

.reply-template-button.secondary,
.reply-template-add-button {
  border: 1px solid #0a66c2;
  background: #fff;
  color: #0a66c2;
}

.reply-template-icon-button {
  width: 36px;
  border: 0;
  background: transparent;
  color: #4b5563;
  font-size: 26px;
}

.reply-template-status {
  min-height: 20px;
  margin: 0;
  padding: 0 18px 14px;
  font-size: 13px;
}

.reply-template-status[data-type="success"] {
  color: #16794a;
}

.reply-template-status[data-type="error"] {
  color: #b42318;
}

@media (max-width: 600px) {
  .reply-template-backdrop {
    padding: 12px;
  }

  .reply-template-dialog {
    max-height: calc(100vh - 24px);
  }
}
```

- [ ] **Step 5: Run the modal controller tests**

Run:

```bash
node --test reply-templates.test.js
```

Expected: 4 tests pass.

- [ ] **Step 6: Commit the modal**

```bash
git add reply-templates.js reply-templates.css reply-templates.test.js
git commit -m "feat: add reply template modal"
```

### Task 4: Wire `Option+E` Into The LinkedIn Content Script

**Files:**
- Modify: `manifest.json`
- Modify: `detect.js`
- Modify: `detect.test.js`

- [ ] **Step 1: Write failing manifest and hotkey tests**

Extend the manifest test in `detect.test.js`:

```js
assert.ok(manifest.permissions.includes('clipboardWrite'));
assert.deepEqual(
  manifest.content_scripts[0].js,
  ['reply-template-store.js', 'reply-templates.js', 'detect.js'],
);
assert.deepEqual(
  manifest.content_scripts[0].css,
  ['reply-templates.css'],
);
```

Add the hotkey test:

```js
test('Option+E opens reply templates once in the top frame', () => {
  const listeners = {};
  const document = makeDocument({ listeners });
  const sandbox = loadDetect(document);
  let calls = 0;
  sandbox.ReplyTemplates = {
    showDialog() {
      calls += 1;
      return Promise.resolve();
    },
  };

  listeners.keydown({
    altKey: true,
    code: 'KeyE',
    ctrlKey: false,
    key: '´',
    keyCode: 69,
    location: 0,
    metaKey: false,
    preventDefault() {},
    stopPropagation() {},
    which: 69,
  });

  assert.equal(calls, 1);
});

test('Option+E does not open reply templates in a child frame', () => {
  const listeners = {};
  const document = makeDocument({ listeners });
  const sandbox = loadDetect(
    document,
    'https://www.linkedin.com/preload/?_bprMode=vanilla',
    { isTopFrame: false },
  );
  let calls = 0;
  sandbox.ReplyTemplates = {
    showDialog() {
      calls += 1;
      return Promise.resolve();
    },
  };

  listeners.keydown({
    altKey: true,
    code: 'KeyE',
    ctrlKey: false,
    key: 'e',
    keyCode: 69,
    location: 0,
    metaKey: false,
    preventDefault() {},
    stopPropagation() {},
    which: 69,
  });

  assert.equal(calls, 0);
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```bash
node --test --test-name-pattern='manifest configures|Option\\+E' detect.test.js
```

Expected: FAIL because the manifest does not load the template modules and `KeyE` is not handled.

- [ ] **Step 3: Load template assets and grant clipboard access**

Update the relevant `manifest.json` fields:

```json
{
  "permissions": [
    "storage",
    "tabs",
    "clipboardWrite"
  ],
  "content_scripts": [
    {
      "matches": ["https://*.linkedin.com/*"],
      "css": ["reply-templates.css"],
      "js": [
        "reply-template-store.js",
        "reply-templates.js",
        "detect.js"
      ],
      "all_frames": true
    }
  ]
}
```

- [ ] **Step 4: Add the top-frame `Option+E` branch**

Add this branch to the first `switch (event.code)` in `detect.js`, immediately before `KeyO`:

```js
case 'KeyE':
  console.log(
    '%c HOTKEY "Option+E" DETECTED! (Reply Templates)',
    'background: #0a66c2; color: #ffffff; font-size: 16px; font-weight: bold;',
  );
  ReplyTemplates.showDialog().catch((error) => {
    console.error('Could not open reply templates:', error);
  });
  break;
```

Do not add a second `KeyE` branch to the legacy lower hotkey block. A handled event returns at the end of the first switch, which guarantees one modal-open call per keydown.

Extend the test sandbox console so the new error path is valid:

```js
console: {
  error(...args) {
    logs.push(args);
  },
  log(...args) {
    logs.push(args);
  },
},
```

- [ ] **Step 5: Run hotkey, manifest, and full tests**

Run:

```bash
node --test --test-name-pattern='manifest configures|Option\\+E' detect.test.js
```

Expected: the focused tests pass.

Run:

```bash
node --test detect.test.js background.test.js reply-template-store.test.js reply-templates.test.js
```

Expected: all tests pass.

- [ ] **Step 6: Commit the integration**

```bash
git add manifest.json detect.js detect.test.js
git commit -m "feat: open reply templates with option e"
```

### Task 5: Document And Verify The Complete Workflow

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update the feature and usage documentation**

Add to the README feature list:

```md
- **Reply Templates**: Press `Option+E` (`Alt+E` on non-macOS keyboards) to edit, copy, save, and add reusable replies.
```

Add this section before Troubleshooting:

```md
## Reply Templates

Press `Option+E` on LinkedIn to open the reply-template modal.

- Edit any textarea and click **Copy** to copy the current text and close the modal. This does not save the edit.
- Click **Save** to persist an edited template for the next time the modal opens.
- Click **Add template** to create a named custom template.
- Close the modal with its close button or the `Escape` key. Unsaved edits are discarded.

Reply templates are stored in `chrome.storage.local` and are not sent to an external service by this extension.
```

- [ ] **Step 2: Run automated verification**

Run:

```bash
node --test detect.test.js background.test.js reply-template-store.test.js reply-templates.test.js
node --check detect.js
node --check background.js
node --check options.js
node --check reply-template-store.js
node --check reply-templates.js
node -e "JSON.parse(require('node:fs').readFileSync('manifest.json', 'utf8'))"
git diff --check
```

Expected: every command exits 0; all tests pass; no syntax, manifest, or whitespace errors are reported.

- [ ] **Step 3: Reload the unpacked extension after any active batch finishes**

In Brave:

1. Wait until `Connect to All` has no profile marked `Processing`.
2. Open `brave://extensions`.
3. Find `Linkedin Invite`.
4. Click **Reload**.
5. Return to LinkedIn and reload that page once.

Expected: the updated content scripts and stylesheet load without interrupting an active connection batch.

- [ ] **Step 4: Verify the modal without sending LinkedIn messages**

Perform this read/write-only local verification:

1. Press `Option+E` and confirm one modal opens.
2. Edit the built-in template, click **Copy**, and confirm the modal closes.
3. Paste into a local text editor and confirm the pasted value contains the unsaved edit.
4. Reopen with `Option+E` and confirm the unsaved edit was discarded.
5. Edit again, click **Save**, close, reopen, and confirm the saved edit remains.
6. Click **Add template**, enter a title and body, add it, close, reopen, and confirm it remains.
7. Press `Escape` and confirm the modal closes.

Expected: all seven behaviors match the product decisions and no LinkedIn message or invitation is sent.

- [ ] **Step 5: Commit documentation**

```bash
git add README.md
git commit -m "docs: explain reply template popup"
```
