const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const SCRIPT_PATH = path.join(__dirname, 'reply-templates.js');
const STYLE_PATH = path.join(__dirname, 'reply-templates.css');

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.parentNode = null;
    this.children = [];
    this.attributes = {};
    this.listeners = {};
    this.className = '';
    this.dataset = {};
    this.disabled = false;
    this.hidden = false;
    this.id = '';
    this.required = false;
    this.textContent = '';
    this.type = '';
    this.value = '';
    this.focusCount = 0;
  }

  get isConnected() {
    let current = this;
    while (current) {
      if (current === this.ownerDocument.body) {
        return true;
      }
      current = current.parentNode;
    }
    return false;
  }

  get isHidden() {
    let current = this;
    while (current) {
      if (current.hidden) {
        return true;
      }
      current = current.parentNode;
    }
    return false;
  }

  append(...children) {
    for (const child of children) {
      this.appendChild(child);
    }
  }

  appendChild(child) {
    if (child.parentNode) {
      child.remove();
    }
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  replaceChildren(...children) {
    for (const child of this.children) {
      child.parentNode = null;
    }
    this.children = [];
    this.append(...children);
  }

  remove() {
    if (!this.parentNode) {
      return;
    }
    const index = this.parentNode.children.indexOf(this);
    if (index !== -1) {
      this.parentNode.children.splice(index, 1);
    }
    this.parentNode = null;
  }

  setAttribute(name, value) {
    const stringValue = String(value);
    this.attributes[name] = stringValue;
    if (name === 'id') {
      this.id = stringValue;
    }
    if (name === 'class') {
      this.className = stringValue;
    }
  }

  getAttribute(name) {
    if (name === 'id') {
      return this.id || null;
    }
    if (name === 'class') {
      return this.className || null;
    }
    return this.attributes[name] ?? null;
  }

  addEventListener(type, listener) {
    this.listeners[type] ||= [];
    this.listeners[type].push(listener);
  }

  removeEventListener(type, listener) {
    this.listeners[type] = (this.listeners[type] || [])
      .filter((candidate) => candidate !== listener);
  }

  async emit(type, init = {}) {
    const event = makeEvent(type, init, this);
    const results = (this.listeners[type] || [])
      .slice()
      .map((listener) => listener(event));
    await Promise.all(results);
    return event;
  }

  focus() {
    if (this.isHidden) {
      return;
    }
    this.focusCount += 1;
    this.ownerDocument.activeElement = this;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const matches = [];
    for (const child of this.children) {
      if (matchesSelector(child, selector)) {
        matches.push(child);
      }
      matches.push(...child.querySelectorAll(selector));
    }
    return matches;
  }
}

class FakeDocument {
  constructor() {
    this.listeners = {};
    this.activeElement = null;
    this.body = new FakeElement('body', this);
  }

  createElement(tagName) {
    return new FakeElement(tagName, this);
  }

  getElementById(id) {
    if (this.body.id === id) {
      return this.body;
    }
    return this.body.querySelector(`#${id}`);
  }

  querySelector(selector) {
    return this.body.querySelector(selector);
  }

  addEventListener(type, listener) {
    this.listeners[type] ||= [];
    this.listeners[type].push(listener);
  }

  removeEventListener(type, listener) {
    this.listeners[type] = (this.listeners[type] || [])
      .filter((candidate) => candidate !== listener);
  }

  listenerCount(type) {
    return (this.listeners[type] || []).length;
  }

  async emit(type, init = {}) {
    const event = makeEvent(type, init, this);
    const results = (this.listeners[type] || [])
      .slice()
      .map((listener) => listener(event));
    await Promise.all(results);
    return event;
  }
}

function makeEvent(type, init, target) {
  return {
    ...init,
    type,
    target,
    currentTarget: target,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
  };
}

function matchesSelector(element, selector) {
  if (selector.startsWith('#')) {
    return element.id === selector.slice(1);
  }
  if (selector.startsWith('.')) {
    return element.className.split(/\s+/).includes(selector.slice(1));
  }

  const attributeMatch = selector.match(
    /^\[([a-z-]+)(?:="([^"]*)")?\]$/,
  );
  if (attributeMatch) {
    const value = element.getAttribute(attributeMatch[1]);
    return attributeMatch[2] === undefined
      ? value !== null
      : value === attributeMatch[2];
  }

  return element.tagName === selector.toUpperCase();
}

function readRequiredFile(filePath) {
  assert.ok(
    fs.existsSync(filePath),
    `${path.basename(filePath)} must be created`,
  );
  return fs.readFileSync(filePath, 'utf8');
}

function loadReplyTemplates({
  clipboard = {
    async writeText() {},
  },
  doc = new FakeDocument(),
  store = {
    async addCustomTemplate() {},
    async getTemplates() {
      return [];
    },
    async saveBody() {},
  },
} = {}) {
  const sandbox = {
    console,
    document: doc,
    navigator: {
      clipboard,
    },
    Promise,
    ReplyTemplateStore: {
      createStore() {
        return store;
      },
    },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(readRequiredFile(SCRIPT_PATH), sandbox, {
    filename: SCRIPT_PATH,
  });
  assert.ok(
    sandbox.ReplyTemplates,
    'ReplyTemplates must be exposed on globalThis',
  );
  return {
    api: sandbox.ReplyTemplates,
    doc,
  };
}

function deferred() {
  let reject;
  let resolve;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return {
    promise,
    reject,
    resolve,
  };
}

async function settle() {
  await new Promise((resolve) => {
    setImmediate(resolve);
  });
}

function findByText(root, tagName, text) {
  return root.querySelectorAll(tagName)
    .find((element) => element.textContent === text) || null;
}

function sampleTemplate(overrides = {}) {
  return {
    id: 'referral-follow-up',
    title: 'Referral follow-up',
    body: 'Stored reply',
    kind: 'builtin',
    ...overrides,
  };
}

test('exposes the reply template modal API', () => {
  const { api } = loadReplyTemplates();

  assert.equal(api.MODAL_ID, 'linkedin-reply-template-modal');
  assert.equal(typeof api.createActions, 'function');
  assert.equal(typeof api.showDialog, 'function');
});

test('copy writes the current body and closes only after the write succeeds', async () => {
  const write = deferred();
  const events = [];
  const { api } = loadReplyTemplates();
  const actions = api.createActions({
    clipboard: {
      writeText(body) {
        events.push(['write', body]);
        return write.promise;
      },
    },
    close() {
      events.push(['close']);
    },
    render() {},
    setStatus() {},
    store: {},
  });

  const resultPromise = actions.copy('Unsaved textarea text');
  await Promise.resolve();

  assert.deepEqual(events, [['write', 'Unsaved textarea text']]);
  write.resolve();
  assert.equal(await resultPromise, true);
  assert.deepEqual(events, [
    ['write', 'Unsaved textarea text'],
    ['close'],
  ]);
});

test('copy reports clipboard errors without closing', async () => {
  const statuses = [];
  let closeCalls = 0;
  const { api } = loadReplyTemplates();
  const actions = api.createActions({
    clipboard: {
      async writeText() {
        throw new Error('Clipboard permission denied');
      },
    },
    close() {
      closeCalls += 1;
    },
    render() {},
    setStatus(...status) {
      statuses.push(status);
    },
    store: {},
  });

  assert.equal(await actions.copy('Draft'), false);
  assert.equal(closeCalls, 0);
  assert.deepEqual(statuses, [
    ['Clipboard permission denied', 'error'],
  ]);
});

test('copy uses its fallback message for errors without a message', async () => {
  const statuses = [];
  const { api } = loadReplyTemplates();
  const actions = api.createActions({
    clipboard: {
      async writeText() {
        throw {};
      },
    },
    close() {
      assert.fail('copy must not close after a failed write');
    },
    render() {},
    setStatus(...status) {
      statuses.push(status);
    },
    store: {},
  });

  assert.equal(await actions.copy('Draft'), false);
  assert.deepEqual(statuses, [
    ['Could not copy template', 'error'],
  ]);
});

test('save persists the body, reports success, and leaves the modal open', async () => {
  const events = [];
  const { api } = loadReplyTemplates();
  const actions = api.createActions({
    clipboard: {},
    close() {
      assert.fail('save must not close the modal');
    },
    render() {},
    setStatus(...status) {
      events.push(['status', ...status]);
    },
    store: {
      async saveBody(id, body) {
        events.push(['save', id, body]);
      },
    },
  });

  assert.equal(await actions.save('template-1', 'Edited body'), true);
  assert.deepEqual(events, [
    ['save', 'template-1', 'Edited body'],
    ['status', 'Saved', 'success'],
  ]);
});

test('save reports storage errors and leaves the modal open', async () => {
  const statuses = [];
  const { api } = loadReplyTemplates();
  const actions = api.createActions({
    clipboard: {},
    close() {
      assert.fail('failed save must not close the modal');
    },
    render() {},
    setStatus(...status) {
      statuses.push(status);
    },
    store: {
      async saveBody() {
        throw new Error('Storage unavailable');
      },
    },
  });

  assert.equal(await actions.save('template-1', 'Edited body'), false);
  assert.deepEqual(statuses, [['Storage unavailable', 'error']]);
});

test('add persists, reloads, renders, and reports success without closing', async () => {
  const templates = [sampleTemplate()];
  const events = [];
  const { api } = loadReplyTemplates();
  const actions = api.createActions({
    clipboard: {},
    close() {
      assert.fail('add must not close the modal');
    },
    render(value) {
      events.push(['render', value]);
    },
    setStatus(...status) {
      events.push(['status', ...status]);
    },
    store: {
      async addCustomTemplate(title, body) {
        events.push(['add', title, body]);
      },
      async getTemplates() {
        events.push(['get']);
        return templates;
      },
    },
  });

  assert.equal(await actions.add('Follow-up', 'Thank you'), true);
  assert.deepEqual(events, [
    ['add', 'Follow-up', 'Thank you'],
    ['get'],
    ['render', templates],
    ['status', 'Template added', 'success'],
  ]);
});

test('add reports persistence errors without reloading, rendering, or closing', async () => {
  const events = [];
  const { api } = loadReplyTemplates();
  const actions = api.createActions({
    clipboard: {},
    close() {
      assert.fail('failed add must not close the modal');
    },
    render() {
      events.push(['render']);
    },
    setStatus(...status) {
      events.push(['status', ...status]);
    },
    store: {
      async addCustomTemplate() {
        events.push(['add']);
        throw new Error('Template title is required');
      },
      async getTemplates() {
        events.push(['get']);
        return [];
      },
    },
  });

  assert.equal(await actions.add('', 'Body'), false);
  assert.deepEqual(events, [
    ['add'],
    ['status', 'Template title is required', 'error'],
  ]);
});

test('add treats persistence as success when the template reload fails', async () => {
  const events = [];
  const createdTemplate = sampleTemplate({
    id: 'custom-1',
    title: 'Title',
    body: 'Body',
    kind: 'custom',
  });
  const { api } = loadReplyTemplates();
  const actions = api.createActions({
    clipboard: {},
    close() {
      assert.fail('partial add success must not close the modal');
    },
    render(templates, options) {
      events.push([
        'render',
        Array.from(templates),
        options && options.append,
      ]);
    },
    setStatus(...status) {
      events.push(['status', ...status]);
    },
    store: {
      async addCustomTemplate() {
        events.push(['add']);
        return createdTemplate;
      },
      async getTemplates() {
        events.push(['get']);
        throw new Error('Could not reload templates');
      },
    },
  });

  assert.equal(await actions.add('Title', 'Body'), true);
  assert.deepEqual(events, [
    ['add'],
    ['get'],
    ['render', [createdTemplate], true],
    [
      'status',
      'Template added, but the template list could not be refreshed',
      'warning',
    ],
  ]);
});

test('showDialog returns an existing modal and focuses its first textarea', () => {
  const doc = new FakeDocument();
  const existing = doc.createElement('div');
  existing.id = 'linkedin-reply-template-modal';
  const textarea = doc.createElement('textarea');
  existing.append(textarea);
  doc.body.append(existing);
  let getCalls = 0;
  const { api } = loadReplyTemplates({
    doc,
    store: {
      async getTemplates() {
        getCalls += 1;
        return [];
      },
    },
  });

  const result = api.showDialog({ doc, store: {} });

  assert.equal(result, existing);
  assert.equal(textarea.focusCount, 1);
  assert.equal(doc.body.children.length, 1);
  assert.equal(getCalls, 0);
});

test('showDialog builds an accessible modal and safely renders template text', async () => {
  const doc = new FakeDocument();
  const templates = [
    sampleTemplate({
      title: '<img src=x onerror=alert(1)>',
      body: '<script>unsafe()</script>\nExact text',
    }),
    sampleTemplate({
      id: 'custom-1',
      title: 'Custom reply',
      body: 'Second body',
      kind: 'custom',
    }),
  ];
  const { api } = loadReplyTemplates({
    doc,
    store: {
      async getTemplates() {
        return templates;
      },
    },
  });

  const backdrop = api.showDialog({ doc, store: {
    async getTemplates() {
      return templates;
    },
  } });
  await settle();

  assert.equal(backdrop.id, api.MODAL_ID);
  assert.ok(backdrop.className.includes('reply-template-backdrop'));
  const dialog = backdrop.querySelector('[role="dialog"]');
  assert.ok(dialog);
  assert.equal(dialog.getAttribute('aria-modal'), 'true');
  const labelledBy = dialog.getAttribute('aria-labelledby');
  const heading = backdrop.querySelector(`#${labelledBy}`);
  assert.equal(heading.textContent, 'Reply Templates');
  assert.ok(backdrop.querySelector('[aria-label="Close reply templates"]'));
  const status = backdrop.querySelector('[role="status"]');
  assert.equal(status.getAttribute('aria-live'), 'polite');
  const templateList = backdrop.querySelector('.reply-template-list');
  assert.equal(templateList.querySelectorAll('textarea').length, 2);
  const templateTitles = templateList.querySelectorAll('h3');
  const templateTextareas = templateList.querySelectorAll('textarea');
  assert.equal(
    new Set(templateTitles.map(({ id }) => id)).size,
    templateTitles.length,
  );
  for (let index = 0; index < templateTitles.length; index += 1) {
    const labelledBy = templateTextareas[index].getAttribute(
      'aria-labelledby',
    );
    assert.ok(labelledBy);
    assert.equal(labelledBy, templateTitles[index].id);
    assert.equal(doc.getElementById(labelledBy), templateTitles[index]);
  }
  assert.deepEqual(
    templateTextareas.map(({ value }) => value),
    ['<script>unsafe()</script>\nExact text', 'Second body'],
  );
  assert.equal(
    backdrop.querySelector('h3').textContent,
    '<img src=x onerror=alert(1)>',
  );
  const copyButtons = templateList.querySelectorAll('button')
    .filter(({ textContent }) => textContent === 'Copy');
  const saveButtons = templateList.querySelectorAll('button')
    .filter(({ textContent }) => textContent === 'Save');
  assert.deepEqual(
    copyButtons.map((button) => button.getAttribute('aria-label')),
    [
      'Copy <img src=x onerror=alert(1)>',
      'Copy Custom reply',
    ],
  );
  assert.deepEqual(
    saveButtons.map((button) => button.getAttribute('aria-label')),
    [
      'Save <img src=x onerror=alert(1)>',
      'Save Custom reply',
    ],
  );
  assert.equal(backdrop.querySelectorAll('script').length, 0);
  assert.doesNotMatch(readRequiredFile(SCRIPT_PATH), /\binnerHTML\b/);
});

test('showDialog focuses the first template textarea after initial render', async () => {
  const doc = new FakeDocument();
  const store = {
    async getTemplates() {
      return [
        sampleTemplate(),
        sampleTemplate({
          id: 'custom-1',
          title: 'Custom reply',
          body: 'Second body',
          kind: 'custom',
        }),
      ];
    },
  };
  const { api } = loadReplyTemplates({ doc, store });

  const backdrop = api.showDialog({ doc, store });
  await settle();

  const firstTextarea = backdrop
    .querySelector('.reply-template-list')
    .querySelector('textarea');
  assert.equal(firstTextarea.focusCount, 1);
  assert.equal(doc.activeElement, firstTextarea);
});

test('closing the modal restores focus to the element active before opening', async () => {
  const doc = new FakeDocument();
  const opener = doc.createElement('button');
  doc.body.append(opener);
  opener.focus();
  const store = {
    async getTemplates() {
      return [sampleTemplate()];
    },
  };
  const { api } = loadReplyTemplates({ doc, store });
  const backdrop = api.showDialog({ doc, store });
  await settle();
  assert.notEqual(doc.activeElement, opener);

  await findByText(backdrop, 'button', 'Copy').emit('click');

  assert.equal(backdrop.isConnected, false);
  assert.equal(doc.activeElement, opener);
  assert.equal(opener.focusCount, 2);
});

test('Tab and Shift+Tab wrap focus within the modal', async () => {
  const doc = new FakeDocument();
  const store = {
    async getTemplates() {
      return [sampleTemplate()];
    },
  };
  const { api } = loadReplyTemplates({ doc, store });
  const backdrop = api.showDialog({ doc, store });
  await settle();
  const closeButton = backdrop.querySelector(
    '[aria-label="Close reply templates"]',
  );
  const addTemplateButton = findByText(
    backdrop,
    'button',
    'Add template',
  );

  addTemplateButton.focus();
  const forwardEvent = await doc.emit('keydown', {
    key: 'Tab',
    shiftKey: false,
  });
  assert.equal(forwardEvent.defaultPrevented, true);
  assert.equal(doc.activeElement, closeButton);

  const backwardEvent = await doc.emit('keydown', {
    key: 'Tab',
    shiftKey: true,
  });
  assert.equal(backwardEvent.defaultPrevented, true);
  assert.equal(doc.activeElement, addTemplateButton);
});

test('an empty template list focuses the Add template control', async () => {
  const doc = new FakeDocument();
  const store = {
    async getTemplates() {
      return [];
    },
  };
  const { api } = loadReplyTemplates({ doc, store });
  const backdrop = api.showDialog({ doc, store });
  await settle();

  assert.equal(
    doc.activeElement,
    findByText(backdrop, 'button', 'Add template'),
  );
});

test('template Save and Copy use current textarea values', async () => {
  const doc = new FakeDocument();
  const saveCalls = [];
  const copyCalls = [];
  const store = {
    async getTemplates() {
      return [sampleTemplate()];
    },
    async saveBody(...args) {
      saveCalls.push(args);
    },
  };
  const { api } = loadReplyTemplates({
    clipboard: {
      async writeText(body) {
        copyCalls.push(body);
      },
    },
    doc,
    store,
  });
  const backdrop = api.showDialog({
    clipboard: {
      async writeText(body) {
        copyCalls.push(body);
      },
    },
    doc,
    store,
  });
  await settle();
  const textarea = backdrop.querySelector('textarea');
  const saveButton = findByText(backdrop, 'button', 'Save');
  const copyButton = findByText(backdrop, 'button', 'Copy');

  textarea.value = 'Edited but unsaved';
  await saveButton.emit('click');

  assert.deepEqual(saveCalls, [
    ['referral-follow-up', 'Edited but unsaved'],
  ]);
  assert.equal(backdrop.querySelector('[role="status"]').textContent, 'Saved');
  assert.ok(backdrop.isConnected);

  textarea.value = 'Latest unsaved value';
  await copyButton.emit('click');

  assert.deepEqual(copyCalls, ['Latest unsaved value']);
  assert.equal(backdrop.isConnected, false);
  assert.equal(doc.listenerCount('keydown'), 0);
});

test('editing a template after Save clears the stale Saved status', async () => {
  const doc = new FakeDocument();
  const store = {
    async getTemplates() {
      return [sampleTemplate()];
    },
    async saveBody() {},
  };
  const { api } = loadReplyTemplates({ doc, store });
  const backdrop = api.showDialog({ doc, store });
  await settle();
  const textarea = backdrop.querySelector('textarea');
  const saveButton = findByText(backdrop, 'button', 'Save');
  const status = backdrop.querySelector('[role="status"]');

  textarea.value = 'Saved body';
  await saveButton.emit('click');

  assert.equal(status.textContent, 'Saved');
  assert.equal(
    status.className,
    'reply-template-status reply-template-status--success',
  );

  textarea.value = 'Later unsaved edit';
  await textarea.emit('input');

  assert.equal(status.textContent, '');
  assert.equal(status.className, 'reply-template-status');
});

test('editing while Save is pending does not mark the newer body as Saved', async () => {
  const doc = new FakeDocument();
  const save = deferred();
  const savedBodies = [];
  const store = {
    async getTemplates() {
      return [sampleTemplate()];
    },
    saveBody(id, body) {
      savedBodies.push([id, body]);
      return save.promise;
    },
  };
  const { api } = loadReplyTemplates({ doc, store });
  const backdrop = api.showDialog({ doc, store });
  await settle();
  const textarea = backdrop.querySelector('textarea');
  const saveButton = findByText(backdrop, 'button', 'Save');
  const status = backdrop.querySelector('[role="status"]');

  textarea.value = 'Body A';
  const saveClick = saveButton.emit('click');
  textarea.value = 'Body B';
  await textarea.emit('input');
  save.resolve();
  await saveClick;

  assert.deepEqual(savedBodies, [['referral-follow-up', 'Body A']]);
  assert.equal(status.textContent, '');
  assert.equal(status.className, 'reply-template-status');
});

test('Save and Copy buttons ignore duplicate clicks while pending and recover', async () => {
  const doc = new FakeDocument();
  const save = deferred();
  const copy = deferred();
  let saveCalls = 0;
  let copyCalls = 0;
  const store = {
    async getTemplates() {
      return [sampleTemplate()];
    },
    saveBody() {
      saveCalls += 1;
      return save.promise;
    },
  };
  const clipboard = {
    writeText() {
      copyCalls += 1;
      return copy.promise;
    },
  };
  const { api } = loadReplyTemplates({ clipboard, doc, store });
  const backdrop = api.showDialog({ clipboard, doc, store });
  await settle();
  const saveButton = findByText(backdrop, 'button', 'Save');
  const copyButton = findByText(backdrop, 'button', 'Copy');

  const firstSave = saveButton.emit('click');
  await Promise.resolve();
  await saveButton.emit('click');
  assert.equal(saveCalls, 1);
  assert.equal(saveButton.disabled, true);

  save.resolve();
  await firstSave;
  assert.equal(saveButton.disabled, false);

  const firstCopy = copyButton.emit('click');
  await Promise.resolve();
  await copyButton.emit('click');
  assert.equal(copyCalls, 1);
  assert.equal(copyButton.disabled, true);

  copy.reject(new Error('Clipboard busy'));
  await firstCopy;
  assert.equal(copyButton.disabled, false);
  assert.ok(backdrop.isConnected);
  assert.equal(
    backdrop.querySelector('[role="status"]').textContent,
    'Clipboard busy',
  );
});

test('Escape and the close button remove the keydown listener', async () => {
  const firstDoc = new FakeDocument();
  const firstLoad = loadReplyTemplates({ doc: firstDoc });
  const firstBackdrop = firstLoad.api.showDialog({
    doc: firstDoc,
    store: {
      async getTemplates() {
        return [];
      },
    },
  });

  assert.equal(firstDoc.listenerCount('keydown'), 1);
  await firstDoc.emit('keydown', { key: 'Escape' });
  assert.equal(firstBackdrop.isConnected, false);
  assert.equal(firstDoc.listenerCount('keydown'), 0);

  const secondDoc = new FakeDocument();
  const secondLoad = loadReplyTemplates({ doc: secondDoc });
  const secondBackdrop = secondLoad.api.showDialog({
    doc: secondDoc,
    store: {
      async getTemplates() {
        return [];
      },
    },
  });
  const closeButton = secondBackdrop.querySelector(
    '[aria-label="Close reply templates"]',
  );

  assert.equal(secondDoc.listenerCount('keydown'), 1);
  await closeButton.emit('click');
  assert.equal(secondBackdrop.isConnected, false);
  assert.equal(secondDoc.listenerCount('keydown'), 0);
});

test('initial template load errors are reported without throwing', async () => {
  const doc = new FakeDocument();
  const { api } = loadReplyTemplates({ doc });

  const backdrop = api.showDialog({
    doc,
    store: {
      async getTemplates() {
        throw new Error('Storage read failed');
      },
    },
  });
  await settle();

  const status = backdrop.querySelector('[role="status"]');
  assert.equal(status.textContent, 'Storage read failed');
  assert.ok(status.className.includes('reply-template-status--error'));
  assert.equal(
    doc.activeElement,
    findByText(backdrop, 'button', 'Add template'),
  );
  assert.ok(backdrop.isConnected);
});

test('the add form cancels cleanly and resets only after a successful add', async () => {
  const doc = new FakeDocument();
  const add = deferred();
  const templates = [
    sampleTemplate(),
    sampleTemplate({
      id: 'custom-1',
      title: 'New template',
      body: 'New body',
      kind: 'custom',
    }),
  ];
  let addCalls = 0;
  let getCalls = 0;
  const store = {
    addCustomTemplate(title, body) {
      addCalls += 1;
      assert.equal(title, 'New template');
      assert.equal(body, 'New body');
      return add.promise;
    },
    async getTemplates() {
      getCalls += 1;
      return getCalls === 1 ? templates.slice(0, 1) : templates;
    },
  };
  const { api } = loadReplyTemplates({ doc, store });
  const backdrop = api.showDialog({ doc, store });
  await settle();
  const revealButton = findByText(backdrop, 'button', 'Add template');
  const form = backdrop.querySelector('form');
  const nameInput = form.querySelector('input');
  const bodyInput = form.querySelector('textarea');
  const cancelButton = findByText(form, 'button', 'Cancel');
  const submitButton = findByText(form, 'button', 'Add');
  let formHiddenWhenRevealFocused = null;
  const focusRevealButton = revealButton.focus.bind(revealButton);
  revealButton.focus = () => {
    formHiddenWhenRevealFocused = form.hidden;
    focusRevealButton();
  };

  assert.equal(form.hidden, true);
  await revealButton.emit('click');
  assert.equal(form.hidden, false);
  assert.equal(revealButton.hidden, true);
  assert.equal(nameInput.required, true);
  assert.equal(bodyInput.required, true);

  nameInput.value = 'Discard me';
  bodyInput.value = 'Discard this body';
  await cancelButton.emit('click');
  assert.equal(form.hidden, true);
  assert.equal(revealButton.hidden, false);
  assert.equal(formHiddenWhenRevealFocused, false);
  assert.equal(doc.activeElement, revealButton);
  assert.equal(nameInput.value, '');
  assert.equal(bodyInput.value, '');

  formHiddenWhenRevealFocused = null;
  await revealButton.emit('click');
  nameInput.value = 'New template';
  bodyInput.value = 'New body';
  const firstSubmit = form.emit('submit');
  await Promise.resolve();
  await form.emit('submit');
  assert.equal(addCalls, 1);
  assert.equal(submitButton.disabled, true);
  assert.equal(form.hidden, false);
  assert.equal(nameInput.value, 'New template');
  assert.equal(bodyInput.value, 'New body');

  add.resolve();
  await firstSubmit;
  assert.equal(submitButton.disabled, false);
  assert.equal(form.hidden, true);
  assert.equal(revealButton.hidden, false);
  assert.equal(formHiddenWhenRevealFocused, false);
  assert.equal(doc.activeElement, revealButton);
  assert.equal(nameInput.value, '');
  assert.equal(bodyInput.value, '');
  assert.equal(backdrop.querySelectorAll('.reply-template-item').length, 2);
  assert.equal(
    backdrop.querySelector('[role="status"]').textContent,
    'Template added',
  );
  assert.ok(backdrop.isConnected);
});

test('a successful add preserves unsaved existing template drafts', async () => {
  const doc = new FakeDocument();
  const createdTemplate = sampleTemplate({
    id: 'custom-1',
    title: 'New template',
    body: 'New body',
    kind: 'custom',
  });
  let getCalls = 0;
  const store = {
    async addCustomTemplate() {
      return createdTemplate;
    },
    async getTemplates() {
      getCalls += 1;
      return getCalls === 1
        ? [sampleTemplate()]
        : [sampleTemplate(), createdTemplate];
    },
  };
  const { api } = loadReplyTemplates({ doc, store });
  const backdrop = api.showDialog({ doc, store });
  await settle();
  const existingTextarea = backdrop
    .querySelector('.reply-template-list')
    .querySelector('textarea');
  existingTextarea.value = 'Unsaved existing draft';
  const revealButton = findByText(backdrop, 'button', 'Add template');
  await revealButton.emit('click');
  const form = backdrop.querySelector('form');
  form.querySelector('input').value = 'New template';
  form.querySelector('textarea').value = 'New body';

  await form.emit('submit');

  assert.equal(
    backdrop.querySelectorAll('.reply-template-item').length,
    2,
  );
  assert.deepEqual(
    backdrop
      .querySelector('.reply-template-list')
      .querySelectorAll('textarea')
      .map(({ value }) => value),
    ['Unsaved existing draft', 'New body'],
  );
  assert.equal(
    backdrop.querySelector('[role="status"]').textContent,
    'Template added',
  );
});

test('a stale initial load cannot overwrite a newer successful add', async () => {
  const doc = new FakeDocument();
  const initialLoad = deferred();
  const existingTemplate = sampleTemplate({
    body: 'Authoritative stored body',
  });
  const createdTemplate = sampleTemplate({
    id: 'custom-1',
    title: 'New template',
    body: 'New body',
    kind: 'custom',
  });
  let addCalls = 0;
  let getCalls = 0;
  const store = {
    async addCustomTemplate() {
      addCalls += 1;
      return createdTemplate;
    },
    getTemplates() {
      getCalls += 1;
      if (getCalls === 1) {
        return initialLoad.promise;
      }
      return Promise.resolve([existingTemplate, createdTemplate]);
    },
  };
  const { api } = loadReplyTemplates({ doc, store });
  const backdrop = api.showDialog({ doc, store });
  await settle();
  assert.equal(getCalls, 1);
  const revealButton = findByText(backdrop, 'button', 'Add template');
  await revealButton.emit('click');
  const form = backdrop.querySelector('form');
  form.querySelector('input').value = 'New template';
  form.querySelector('textarea').value = 'New body';

  await form.emit('submit');

  const templateList = backdrop.querySelector('.reply-template-list');
  const firstTextarea = templateList.querySelector('textarea');
  firstTextarea.value = 'Unsaved authoritative draft';
  const status = backdrop.querySelector('[role="status"]');
  assert.equal(addCalls, 1);
  assert.equal(getCalls, 2);
  assert.equal(status.textContent, 'Template added');
  assert.equal(doc.activeElement, revealButton);

  initialLoad.resolve([
    sampleTemplate({
      body: 'Stale initial body',
    }),
  ]);
  await settle();

  assert.deepEqual(
    templateList.querySelectorAll('h3').map(({ textContent }) => textContent),
    ['Referral follow-up', 'New template'],
  );
  assert.deepEqual(
    templateList.querySelectorAll('textarea').map(({ value }) => value),
    ['Unsaved authoritative draft', 'New body'],
  );
  assert.equal(status.textContent, 'Template added');
  assert.equal(doc.activeElement, revealButton);
});

test('a persisted add with a failed refresh clears the form without duplicating', async () => {
  const doc = new FakeDocument();
  const createdTemplate = sampleTemplate({
    id: 'custom-1',
    title: 'New template',
    body: 'New body',
    kind: 'custom',
  });
  let addCalls = 0;
  let getCalls = 0;
  const store = {
    async addCustomTemplate() {
      addCalls += 1;
      return createdTemplate;
    },
    async getTemplates() {
      getCalls += 1;
      if (getCalls === 1) {
        return [sampleTemplate()];
      }
      throw new Error('Refresh failed');
    },
  };
  const { api } = loadReplyTemplates({ doc, store });
  const backdrop = api.showDialog({ doc, store });
  await settle();
  backdrop.querySelector('.reply-template-list').querySelector(
    'textarea',
  ).value = 'Unsaved existing draft';
  const revealButton = findByText(backdrop, 'button', 'Add template');
  await revealButton.emit('click');
  const form = backdrop.querySelector('form');
  const nameInput = form.querySelector('input');
  const bodyInput = form.querySelector('textarea');
  nameInput.value = 'New template';
  bodyInput.value = 'New body';

  await form.emit('submit');

  assert.equal(addCalls, 1);
  assert.equal(getCalls, 2);
  assert.equal(form.hidden, true);
  assert.equal(revealButton.hidden, false);
  assert.equal(nameInput.value, '');
  assert.equal(bodyInput.value, '');
  assert.deepEqual(
    backdrop
      .querySelector('.reply-template-list')
      .querySelectorAll('textarea')
      .map(({ value }) => value),
    ['Unsaved existing draft', 'New body'],
  );
  const status = backdrop.querySelector('[role="status"]');
  assert.equal(
    status.textContent,
    'Template added, but the template list could not be refreshed',
  );
  assert.ok(status.className.includes('reply-template-status--warning'));
});

test('a failed add keeps the inline form and its values available for retry', async () => {
  const doc = new FakeDocument();
  let addCalls = 0;
  const store = {
    async addCustomTemplate() {
      addCalls += 1;
      throw new Error('Could not save custom template');
    },
    async getTemplates() {
      return [];
    },
  };
  const { api } = loadReplyTemplates({ doc, store });
  const backdrop = api.showDialog({ doc, store });
  await settle();
  const revealButton = findByText(backdrop, 'button', 'Add template');
  await revealButton.emit('click');
  const form = backdrop.querySelector('form');
  const nameInput = form.querySelector('input');
  const bodyInput = form.querySelector('textarea');
  const submitButton = findByText(form, 'button', 'Add');
  nameInput.value = 'Retry title';
  bodyInput.value = 'Retry body';

  await form.emit('submit');

  assert.equal(addCalls, 1);
  assert.equal(form.hidden, false);
  assert.equal(revealButton.hidden, true);
  assert.equal(submitButton.disabled, false);
  assert.equal(nameInput.value, 'Retry title');
  assert.equal(bodyInput.value, 'Retry body');
  assert.equal(
    backdrop.querySelector('[role="status"]').textContent,
    'Could not save custom template',
  );
});

test('reply template styles stay scoped and include modal constraints', () => {
  const source = readRequiredFile(STYLE_PATH);
  const modalRule = source.match(
    /\.reply-template-modal\s*\{([^}]*)\}/,
  )[1];
  const listRule = source.match(
    /\.reply-template-list\s*\{([^}]*)\}/,
  )[1];

  assert.match(source, /\.reply-template-backdrop\s*\{/);
  assert.match(source, /\.reply-template-modal\s*\{/);
  assert.match(source, /max-width:\s*720px/);
  assert.match(modalRule, /max-height:\s*min\(88vh,\s*760px\)/);
  assert.match(modalRule, /max-height:\s*min\(88dvh,\s*760px\)/);
  assert.match(modalRule, /overflow-y:\s*auto/);
  assert.doesNotMatch(modalRule, /overflow:\s*hidden/);
  assert.match(listRule, /flex:\s*0 0 auto/);
  assert.match(listRule, /overflow-y:\s*visible/);
  assert.match(source, /max-height:\s*100dvh/);
  assert.match(source, /\.reply-template-status--warning\s*\{/);
  assert.match(source, /resize:\s*vertical/);
  assert.match(source, /@media\s*\(/);
  assert.doesNotMatch(source, /(?:^|})\s*(?:body|html|button|textarea)\s*\{/m);
  assert.doesNotMatch(source, /\b(?:linear|radial)-gradient\b/);
  assert.doesNotMatch(source, /\.artdeco-|\.linkedin-|\.scaffold-/);
});
