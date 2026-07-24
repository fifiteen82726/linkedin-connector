const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

function loadBackground({ sendMessageResponses = [] } = {}) {
  const runtimeListeners = [];
  const tabUpdatedListeners = [];
  const tabRemovedListeners = [];
  const createdTabs = [];
  const removedTabs = [];
  const sentMessages = [];
  const timers = [];
  const chrome = {
    runtime: {
      lastError: null,
      onMessage: {
        addListener(listener) {
          runtimeListeners.push(listener);
        },
      },
    },
    tabs: {
      create(options, callback) {
        createdTabs.push(options);
        callback({ id: 42, status: 'loading' });
      },
      onRemoved: {
        addListener(listener) {
          tabRemovedListeners.push(listener);
        },
      },
      onUpdated: {
        addListener(listener) {
          tabUpdatedListeners.push(listener);
        },
      },
      remove(tabId) {
        removedTabs.push(tabId);
      },
      sendMessage(tabId, message, options, callback) {
        sentMessages.push({ tabId, message, options });
        const nextResponse = sendMessageResponses.shift();
        chrome.runtime.lastError = nextResponse && nextResponse.error
          ? { message: nextResponse.error }
          : null;
        if (callback) {
          callback(nextResponse && nextResponse.response || { accepted: true });
        }
        chrome.runtime.lastError = null;
      },
    },
  };
  const sandbox = {
    chrome,
    console: { log() {}, warn() {} },
    setTimeout(callback, delay) {
      timers.push({ callback, delay });
      return timers.length;
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync('background.js', 'utf8'), sandbox, {
    filename: 'background.js',
  });
  return {
    createdTabs,
    removedTabs,
    runtimeListeners,
    sentMessages,
    tabRemovedListeners,
    tabUpdatedListeners,
    timers,
  };
}

function startBatchProfile(background) {
  const responses = [];
  background.runtimeListeners[0](
    {
      source: 'linkedin-invite-extension',
      action: 'openBatchProfile',
      requestId: 'batch-1',
      profileUrl: 'https://www.linkedin.com/in/yoojin-lim/',
      shouldSend: true,
    },
    { frameId: 0, tab: { id: 7 } },
    (response) => responses.push(response),
  );
  return responses;
}

test('background opens a profile and starts automation after the tab loads', () => {
  const background = loadBackground();

  const responses = startBatchProfile(background);

  assert.equal(background.createdTabs.length, 1);
  assert.equal(background.createdTabs[0].active, false);
  assert.equal(
    background.createdTabs[0].url,
    'https://www.linkedin.com/in/yoojin-lim/',
  );
  assert.equal(background.sentMessages.length, 0);
  assert.equal(responses.length, 1);
  assert.equal(responses[0].accepted, true);
  assert.equal(responses[0].tabId, 42);

  background.tabUpdatedListeners[0](42, { status: 'complete' }, { id: 42 });

  assert.equal(background.sentMessages.length, 1);
  assert.equal(background.sentMessages[0].tabId, 42);
  assert.equal(background.sentMessages[0].options.frameId, 0);
  assert.equal(background.sentMessages[0].message.action, 'autoConnect');
  assert.equal(background.sentMessages[0].message.shouldSend, true);
  assert.equal(background.sentMessages[0].message.requestId, 'batch-1');
});

test('background relays the final result to the selection tab and closes the profile', () => {
  const background = loadBackground();
  startBatchProfile(background);
  background.tabUpdatedListeners[0](42, { status: 'complete' }, { id: 42 });

  background.runtimeListeners[0](
    {
      source: 'linkedin-invite-extension',
      action: 'batchProfileResult',
      requestId: 'batch-1',
      status: 'completed',
      profileUrl: 'https://www.linkedin.com/in/yoojin-lim/',
    },
    { frameId: 0, tab: { id: 42 } },
    () => {},
  );

  assert.equal(background.sentMessages.length, 2);
  assert.equal(background.sentMessages[1].tabId, 7);
  assert.equal(background.sentMessages[1].options.frameId, 0);
  assert.equal(background.sentMessages[1].message.action, 'batchProfileResult');
  assert.equal(background.sentMessages[1].message.status, 'completed');
  assert.deepEqual(background.removedTabs, []);

  background.timers.shift().callback();

  assert.deepEqual(background.removedTabs, [42]);
});

test('background accepts a final result from the LinkedIn invite child frame', () => {
  const background = loadBackground();
  startBatchProfile(background);
  background.tabUpdatedListeners[0](42, { status: 'complete' }, { id: 42 });

  background.runtimeListeners[0](
    {
      source: 'linkedin-invite-extension',
      action: 'batchProfileResult',
      requestId: 'batch-1',
      status: 'completed',
      profileUrl: 'https://www.linkedin.com/preload/custom-invite/',
    },
    { frameId: 2, tab: { id: 42 } },
    () => {},
  );

  assert.equal(background.sentMessages.length, 2);
  assert.equal(background.sentMessages[1].tabId, 7);
  assert.equal(background.sentMessages[1].message.action, 'batchProfileResult');
  assert.equal(background.sentMessages[1].message.status, 'completed');
});

test('background retries when the profile content script is not ready yet', () => {
  const background = loadBackground({
    sendMessageResponses: [
      { error: 'Receiving end does not exist' },
      { response: { accepted: true } },
    ],
  });
  startBatchProfile(background);

  background.tabUpdatedListeners[0](42, { status: 'complete' }, { id: 42 });

  assert.equal(background.sentMessages.length, 1);
  assert.equal(background.removedTabs.length, 0);
  assert.equal(background.timers.length, 1);

  background.timers.shift().callback();

  assert.equal(background.sentMessages.length, 2);
  assert.equal(background.removedTabs.length, 0);
});

test('background restarts automation after the profile redirects', () => {
  const background = loadBackground({
    sendMessageResponses: [
      { response: { accepted: true } },
      { response: { accepted: true } },
    ],
  });
  startBatchProfile(background);

  background.tabUpdatedListeners[0](42, { status: 'complete' }, { id: 42 });
  assert.equal(background.sentMessages.length, 1);

  background.tabUpdatedListeners[0](42, { status: 'loading' }, { id: 42 });
  background.tabUpdatedListeners[0](42, { status: 'complete' }, { id: 42 });

  assert.equal(background.sentMessages.length, 2);
  assert.equal(background.sentMessages[1].message.action, 'autoConnect');
  assert.equal(background.sentMessages[1].message.requestId, 'batch-1');
});
