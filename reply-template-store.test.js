const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const STORE_PATH = path.join(__dirname, 'reply-template-store.js');
const EXPECTED_DEFAULT_BODY = `Yes, thank you so much for connecting with me. The job market is brutal now, I truly appreciate your time and support. I’m very interested in this position. I've attached my resume. Let me know if you need more info.

**Job - link**

First Name: Yi-Yun
Last Name: Liao
Email: yiyunliao0321@gmail.com
Phone: 929-313-3362`;

function clone(value) {
  return value === undefined
    ? undefined
    : JSON.parse(JSON.stringify(value));
}

function loadStore({
  cloneStorageReads = true,
  delayedStorage = false,
  initialState,
  getError = null,
  lockManager,
  randomUUIDs = ['uuid-1'],
  setError = null,
} = {}) {
  let activeTransactions = 0;
  let maxActiveTransactions = 0;
  let randomUUIDIndex = 0;
  const rawSetCalls = [];
  const storageValues = {};
  const setCalls = [];
  if (initialState !== undefined) {
    storageValues.replyTemplateState = clone(initialState);
  }

  function schedule(callback) {
    if (delayedStorage) {
      setImmediate(callback);
    } else {
      callback();
    }
  }

  const chrome = {
    runtime: {
      lastError: null,
    },
    storage: {
      local: {
        get(key, callback) {
          if (delayedStorage) {
            activeTransactions += 1;
            maxActiveTransactions = Math.max(
              maxActiveTransactions,
              activeTransactions,
            );
          }
          schedule(() => {
            chrome.runtime.lastError = getError
              ? { message: getError }
              : null;
            callback({
              [key]: cloneStorageReads
                ? clone(storageValues[key])
                : storageValues[key],
            });
            chrome.runtime.lastError = null;
            if (delayedStorage && getError) {
              activeTransactions -= 1;
            }
          });
        },
        set(values, callback) {
          schedule(() => {
            chrome.runtime.lastError = setError
              ? { message: setError }
              : null;
            rawSetCalls.push(values);
            setCalls.push(clone(values));
            if (!setError) {
              Object.assign(storageValues, clone(values));
            }
            callback();
            chrome.runtime.lastError = null;
            if (delayedStorage) {
              activeTransactions -= 1;
            }
          });
        },
      },
    },
  };
  const sandbox = {
    chrome,
    crypto: {
      randomUUID() {
        const uuid = randomUUIDs[randomUUIDIndex];
        randomUUIDIndex += 1;
        if (uuid === undefined) {
          throw new Error('No deterministic UUID configured');
        }
        return uuid;
      },
    },
    Promise,
  };
  if (lockManager) {
    sandbox.navigator = {
      locks: lockManager,
    };
  }
  sandbox.globalThis = sandbox;

  vm.createContext(sandbox);
  const source = fs.readFileSync(STORE_PATH, 'utf8');
  vm.runInContext(source, sandbox, {
    filename: STORE_PATH,
  });
  assert.ok(
    sandbox.ReplyTemplateStore,
    'ReplyTemplateStore must be exposed on globalThis',
  );

  return {
    api: sandbox.ReplyTemplateStore,
    getMaxActiveTransactions() {
      return maxActiveTransactions;
    },
    rawSetCalls,
    setCalls,
    storageValues,
  };
}

function makeSerialLockManager() {
  const requestedNames = [];
  let tail = Promise.resolve();

  return {
    requestedNames,
    request(name, callback) {
      requestedNames.push(name);
      const result = tail.then(callback, callback);
      tail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  };
}

test('getTemplates exposes the built-in referral follow-up template', async () => {
  const { api } = loadStore();
  const store = api.createStore();

  assert.equal(api.STORAGE_KEY, 'replyTemplateState');
  assert.deepEqual(clone(api.DEFAULT_TEMPLATES), [{
    id: 'referral-follow-up',
    title: 'Referral follow-up',
    body: EXPECTED_DEFAULT_BODY,
    kind: 'builtin',
  }]);
  assert.deepEqual(clone(await store.getTemplates()), [{
    id: 'referral-follow-up',
    title: 'Referral follow-up',
    body: EXPECTED_DEFAULT_BODY,
    kind: 'builtin',
  }]);
});

test('addCustomTemplate returns and persists a custom template after built-ins', async () => {
  const { api, setCalls, storageValues } = loadStore();
  const store = api.createStore();

  assert.deepEqual(Object.keys(store), [
    'addCustomTemplate',
    'getTemplates',
    'saveBody',
  ]);

  const customTemplate = await store.addCustomTemplate(
    'Quick follow-up',
    'Thanks again.',
  );

  const expectedCustomTemplate = {
    id: 'custom-uuid-1',
    title: 'Quick follow-up',
    body: 'Thanks again.',
    kind: 'custom',
  };
  const expectedState = {
    version: 1,
    overrides: {},
    customTemplates: [expectedCustomTemplate],
  };
  assert.deepEqual(clone(customTemplate), expectedCustomTemplate);
  assert.deepEqual(setCalls, [{
    replyTemplateState: expectedState,
  }]);
  assert.deepEqual(storageValues.replyTemplateState, expectedState);
  assert.deepEqual(clone(await store.getTemplates()), [
    {
      id: 'referral-follow-up',
      title: 'Referral follow-up',
      body: EXPECTED_DEFAULT_BODY,
      kind: 'builtin',
    },
    expectedCustomTemplate,
  ]);
});

test('addCustomTemplate trims the title and preserves exact body whitespace', async () => {
  const { api, storageValues } = loadStore();

  const customTemplate = await api.createStore().addCustomTemplate(
    '  Quick follow-up  ',
    '  Thanks again.\n',
  );

  assert.deepEqual(clone(customTemplate), {
    id: 'custom-uuid-1',
    title: 'Quick follow-up',
    body: '  Thanks again.\n',
    kind: 'custom',
  });
  assert.deepEqual(
    storageValues.replyTemplateState.customTemplates[0],
    clone(customTemplate),
  );
});

test('addCustomTemplate rejects a blank title', async () => {
  const { api, setCalls } = loadStore();

  await assert.rejects(
    api.createStore().addCustomTemplate(' \n\t ', 'Thanks again.'),
    { message: 'Template title is required' },
  );
  assert.equal(setCalls.length, 0);
});

test('addCustomTemplate rejects a blank body', async () => {
  const { api, setCalls } = loadStore();

  await assert.rejects(
    api.createStore().addCustomTemplate('Quick follow-up', ' \n\t '),
    { message: 'Template body is required' },
  );
  assert.equal(setCalls.length, 0);
});

test('addCustomTemplate returns clones without exposing stored records', async () => {
  const { api, rawSetCalls } = loadStore();
  const store = api.createStore();

  const addedTemplate = await store.addCustomTemplate(
    'Quick follow-up',
    'Thanks again.',
  );
  assert.notStrictEqual(
    addedTemplate,
    rawSetCalls[0].replyTemplateState.customTemplates[0],
  );
  addedTemplate.title = 'Mutated title';
  addedTemplate.body = 'Mutated body';

  const firstRead = await store.getTemplates();
  assert.equal(firstRead[1].title, 'Quick follow-up');
  assert.equal(firstRead[1].body, 'Thanks again.');
  firstRead[1].body = 'Another mutation';

  const secondRead = await store.getTemplates();
  assert.equal(secondRead[1].body, 'Thanks again.');
  assert.notStrictEqual(firstRead[1], secondRead[1]);
});

test('addCustomTemplate rejects a generated ID that already exists', async () => {
  const { api, setCalls } = loadStore({
    initialState: {
      version: 1,
      overrides: {},
      customTemplates: [{
        id: 'custom-uuid-1',
        title: 'Existing template',
        body: 'Existing body',
        kind: 'custom',
      }],
    },
  });

  await assert.rejects(
    api.createStore().addCustomTemplate('Quick follow-up', 'Thanks again.'),
    { message: 'Template ID already exists' },
  );
  assert.equal(setCalls.length, 0);
});

test('saveBody persists a built-in override and getTemplates returns it', async () => {
  const { api, setCalls, storageValues } = loadStore();
  const store = api.createStore();

  await store.saveBody('referral-follow-up', 'Edited reply');

  const expectedState = {
    version: 1,
    overrides: {
      'referral-follow-up': 'Edited reply',
    },
    customTemplates: [],
  };
  assert.deepEqual(setCalls, [{
    replyTemplateState: expectedState,
  }]);
  assert.deepEqual(storageValues.replyTemplateState, expectedState);
  assert.deepEqual(clone(await store.getTemplates()), [{
    id: 'referral-follow-up',
    title: 'Referral follow-up',
    body: 'Edited reply',
    kind: 'builtin',
  }]);
});

test('saveBody persists a custom template edit and getTemplates returns it', async () => {
  const { api, storageValues } = loadStore();
  const store = api.createStore();
  const customTemplate = await store.addCustomTemplate(
    'Quick follow-up',
    'Thanks again.',
  );

  await store.saveBody(customTemplate.id, 'Updated');

  assert.deepEqual(storageValues.replyTemplateState.customTemplates, [{
    id: 'custom-uuid-1',
    title: 'Quick follow-up',
    body: 'Updated',
    kind: 'custom',
  }]);
  assert.deepEqual(clone(await store.getTemplates()), [
    {
      id: 'referral-follow-up',
      title: 'Referral follow-up',
      body: EXPECTED_DEFAULT_BODY,
      kind: 'builtin',
    },
    {
      id: 'custom-uuid-1',
      title: 'Quick follow-up',
      body: 'Updated',
      kind: 'custom',
    },
  ]);
});

test('saveBody rejects a blank body', async () => {
  const { api, setCalls } = loadStore();
  const store = api.createStore();

  await assert.rejects(
    store.saveBody('referral-follow-up', ' \n\t '),
    { message: 'Template body is required' },
  );
  assert.equal(setCalls.length, 0);
});

test('saveBody rejects an unknown template ID', async () => {
  const { api, setCalls } = loadStore();

  await assert.rejects(
    api.createStore().saveBody('missing-template', 'Edited reply'),
    { message: 'Template not found' },
  );
  assert.equal(setCalls.length, 0);
});

test('saveBody normalizes invalid stored state before persisting', async () => {
  const { api, storageValues } = loadStore({
    initialState: {
      version: 2,
      overrides: [],
      customTemplates: {},
    },
  });
  const store = api.createStore();

  await store.saveBody('referral-follow-up', '  Exact body \n');

  assert.deepEqual(storageValues.replyTemplateState, {
    version: 1,
    overrides: {
      'referral-follow-up': '  Exact body \n',
    },
    customTemplates: [],
  });
});

test('normalization keeps valid siblings, drops malformed entries, and clones custom records', async () => {
  const { api, rawSetCalls, storageValues } = loadStore({
    cloneStorageReads: false,
    initialState: {
      version: 1,
      overrides: {
        'referral-follow-up': 'Stored reply',
        'missing-template': 'Dead override',
        blank: '   ',
        invalid: 42,
      },
      customTemplates: [
        {
          id: 'custom-1',
          title: 'Custom one',
          body: 'Custom body',
          kind: 'builtin',
          extra: true,
        },
        null,
        {
          id: '',
          title: 'Missing ID',
          body: 'Body',
        },
        {
          id: 'custom-2',
          title: 'Missing body',
          body: '  ',
        },
      ],
    },
  });
  const store = api.createStore();

  assert.equal((await store.getTemplates())[0].body, 'Stored reply');

  const originalCustomRecord =
    storageValues.replyTemplateState.customTemplates[0];
  await store.saveBody('referral-follow-up', 'Next reply');

  assert.deepEqual(clone(rawSetCalls[0].replyTemplateState), {
    version: 1,
    overrides: {
      'referral-follow-up': 'Next reply',
    },
    customTemplates: [{
      id: 'custom-1',
      title: 'Custom one',
      body: 'Custom body',
      kind: 'custom',
    }],
  });
  assert.notStrictEqual(
    rawSetCalls[0].replyTemplateState.customTemplates[0],
    originalCustomRecord,
  );
});

test('saveBody serializes storage updates with a stable Web Lock', async () => {
  const lockManager = makeSerialLockManager();
  const { api, getMaxActiveTransactions } = loadStore({
    delayedStorage: true,
    lockManager,
  });
  const store = api.createStore();

  await Promise.all([
    store.saveBody('referral-follow-up', 'First reply'),
    store.saveBody('referral-follow-up', 'Second reply'),
  ]);

  assert.equal(getMaxActiveTransactions(), 1);
  assert.deepEqual(lockManager.requestedNames, [
    'linkedin-connector-reply-template-state-write',
    'linkedin-connector-reply-template-state-write',
  ]);
});

test('saveBody serializes storage updates with the in-context fallback', async () => {
  const { api, getMaxActiveTransactions } = loadStore({
    delayedStorage: true,
  });
  const store = api.createStore();

  await Promise.all([
    store.saveBody('referral-follow-up', 'First reply'),
    store.saveBody('referral-follow-up', 'Second reply'),
  ]);

  assert.equal(getMaxActiveTransactions(), 1);
});

test('concurrent add and save operations preserve custom template data', async () => {
  const { api, getMaxActiveTransactions, storageValues } = loadStore({
    delayedStorage: true,
    initialState: {
      version: 1,
      overrides: {},
      customTemplates: [{
        id: 'custom-existing',
        title: 'Existing template',
        body: 'Existing body',
        kind: 'custom',
      }],
    },
  });
  const store = api.createStore();

  await Promise.all([
    store.addCustomTemplate('New template', 'New body'),
    store.saveBody('custom-existing', 'Updated existing body'),
  ]);

  assert.equal(getMaxActiveTransactions(), 1);
  assert.deepEqual(storageValues.replyTemplateState.customTemplates, [
    {
      id: 'custom-existing',
      title: 'Existing template',
      body: 'Updated existing body',
      kind: 'custom',
    },
    {
      id: 'custom-uuid-1',
      title: 'New template',
      body: 'New body',
      kind: 'custom',
    },
  ]);
});

test('getTemplates rejects chrome.storage.local.get errors', async () => {
  const { api } = loadStore({ getError: 'Unable to read templates' });

  await assert.rejects(
    api.createStore().getTemplates(),
    { message: 'Unable to read templates' },
  );
});

test('saveBody rejects chrome.storage.local.set errors', async () => {
  const { api } = loadStore({ setError: 'Unable to save templates' });

  await assert.rejects(
    api.createStore().saveBody('referral-follow-up', 'Edited reply'),
    { message: 'Unable to save templates' },
  );
});
