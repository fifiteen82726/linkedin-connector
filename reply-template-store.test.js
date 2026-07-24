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

function clone(value) {
  return value === undefined
    ? undefined
    : JSON.parse(JSON.stringify(value));
}

function loadStore({
  initialState,
  getError = null,
  setError = null,
} = {}) {
  const storageValues = {};
  const setCalls = [];
  if (initialState !== undefined) {
    storageValues.replyTemplateState = clone(initialState);
  }

  const chrome = {
    runtime: {
      lastError: null,
    },
    storage: {
      local: {
        get(key, callback) {
          chrome.runtime.lastError = getError
            ? { message: getError }
            : null;
          callback({ [key]: clone(storageValues[key]) });
          chrome.runtime.lastError = null;
        },
        set(values, callback) {
          chrome.runtime.lastError = setError
            ? { message: setError }
            : null;
          setCalls.push(clone(values));
          if (!setError) {
            Object.assign(storageValues, clone(values));
          }
          callback();
          chrome.runtime.lastError = null;
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
  sandbox.globalThis = sandbox;

  vm.createContext(sandbox);
  const source = fs.existsSync('reply-template-store.js')
    ? fs.readFileSync('reply-template-store.js', 'utf8')
    : '';
  vm.runInContext(source, sandbox, {
    filename: 'reply-template-store.js',
  });
  assert.ok(
    sandbox.ReplyTemplateStore,
    'ReplyTemplateStore must be exposed on globalThis',
  );

  return {
    api: sandbox.ReplyTemplateStore,
    setCalls,
    storageValues,
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
