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
  setError = null,
} = {}) {
  let activeTransactions = 0;
  let maxActiveTransactions = 0;
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
        return '00000000-0000-4000-8000-000000000000';
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
