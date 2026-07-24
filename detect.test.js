const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

test('manifest configures LinkedIn content scripts and the batch background worker', () => {
  const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));

  assert.equal(manifest.content_scripts[0].all_frames, true);
  assert.deepEqual(manifest.content_scripts[0].matches, ['https://*.linkedin.com/*']);
  assert.deepEqual(
    manifest.content_scripts[0].js,
    ['candidate-rules.js', 'detect.js'],
  );
  assert.ok(manifest.permissions.includes('tabs'));
  assert.equal(manifest.background.service_worker, 'background.js');
});

test('basic template defaults to the Sr. Data Engineer role everywhere', () => {
  const detectSource = fs.readFileSync('detect.js', 'utf8');
  const optionsSource = fs.readFileSync('options.js', 'utf8');

  assert.match(detectSource, /myRole:\s*'Sr\. Data Engineer'/);
  assert.match(optionsSource, /myRole:\s*'Sr\. Data Engineer'/);
});

function makeElement({
  textContent = '',
  href = '',
  src = '',
  ariaLabel = '',
  contentDocument = null,
  contentWindow = null,
  shadowRoot = null,
  querySelectorMap = {},
  querySelectorAllMap = {},
} = {}) {
  return {
    textContent,
    href,
    src,
    contentDocument,
    contentWindow,
    shadowRoot,
    clicked: false,
    classList: {
      contains() {
        return false;
      },
    },
    closest() {
      return null;
    },
    click() {
      this.clicked = true;
    },
    dispatchEvent() {},
    getAttribute(name) {
      if (name === 'aria-label') return ariaLabel;
      if (name === 'href') return href;
      if (name === 'src') return src;
      return null;
    },
    querySelector(selector) {
      return querySelectorMap[selector] || null;
    },
    querySelectorAll(selector) {
      return querySelectorAllMap[selector] || [];
    },
  };
}

function makeDocument({
  title = 'Yoojin L. | LinkedIn',
  querySelectorMap = {},
  querySelectorAllMap = {},
  listeners = {},
} = {}) {
  return {
    title,
    body: makeElement(),
    addEventListener(type, handler) {
      listeners[type] = handler;
    },
    getElementById() {
      return null;
    },
    querySelector(selector) {
      return querySelectorMap[selector] || null;
    },
    querySelectorAll(selector) {
      return querySelectorAllMap[selector] || [];
    },
  };
}

function loadDetect(
  document,
  href = 'https://www.linkedin.com/in/yoojin-lim/',
  {
    clearTimeout = () => {},
    isTopFrame = true,
    logs = [],
    opener = null,
    open = () => null,
    runtimeSendMessage = null,
    setTimeout = () => {},
    settings = {},
  } = {},
) {
  const windowListeners = {};
  const mutationObservers = [];
  const runtimeListeners = [];
  const runtimeMessages = [];
  const windowObject = {
    addEventListener(type, handler) {
      windowListeners[type] ||= [];
      windowListeners[type].push(handler);
    },
    removeEventListener(type, handler) {
      windowListeners[type] = (windowListeners[type] || [])
        .filter((listener) => listener !== handler);
    },
    close() {},
    location: {
      href,
    },
    opener,
    open,
  };
  windowObject.top = isTopFrame ? windowObject : {};
  windowObject.parent = isTopFrame ? windowObject : {};

  const sandbox = {
    __logs: logs,
    __mutationObservers: mutationObservers,
    __runtimeListeners: runtimeListeners,
    __runtimeMessages: runtimeMessages,
    __windowListeners: windowListeners,
    alert() {},
    chrome: {
      runtime: {
        lastError: null,
        onMessage: {
          addListener(listener) {
            runtimeListeners.push(listener);
          },
        },
        sendMessage(message, callback) {
          runtimeMessages.push(message);
          if (runtimeSendMessage) {
            runtimeSendMessage(message, callback);
          } else if (callback) {
            callback({ accepted: true });
          }
        },
      },
      storage: {
        sync: {
          get(defaults, callback) {
            callback({ ...defaults, ...settings });
          },
          set() {},
        },
      },
    },
    console: {
      log(...args) {
        logs.push(args);
      },
    },
    clearTimeout,
    document,
    Event: class {
      constructor(type, options = {}) {
        this.type = type;
        Object.assign(this, options);
      }
    },
    MouseEvent: class {},
    MutationObserver: class {
      constructor(callback) {
        this.callback = callback;
        mutationObservers.push(this);
      }

      observe() {}
    },
    setTimeout,
    URL,
    window: windowObject,
  };

  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync('candidate-rules.js', 'utf8'), sandbox, {
    filename: 'candidate-rules.js',
  });
  vm.runInContext(fs.readFileSync('detect.js', 'utf8'), sandbox, {
    filename: 'detect.js',
  });
  return sandbox;
}

test('Connect to All asks the background worker to automate the selected profile', () => {
  const profileUrl = 'https://www.linkedin.com/in/yoojin-lim/';
  const sandbox = loadDetect(makeDocument());
  vm.runInContext(
    `selectedProfiles = [{ name: 'Yoojin L.', url: '${profileUrl}', status: 'pending' }]`,
    sandbox,
  );

  sandbox.processNextProfile(0);

  assert.equal(sandbox.__runtimeMessages.length, 1);
  assert.equal(sandbox.__runtimeMessages[0].source, 'linkedin-invite-extension');
  assert.equal(sandbox.__runtimeMessages[0].action, 'openBatchProfile');
  assert.equal(sandbox.__runtimeMessages[0].profileUrl, profileUrl);
  assert.equal(sandbox.__runtimeMessages[0].shouldSend, true);
});

test('Connect to All marks a profile completed only after the background result', () => {
  const timers = [];
  const profileUrl = 'https://www.linkedin.com/in/yoojin-lim/';
  const sandbox = loadDetect(makeDocument(), undefined, {
    setTimeout(callback, delay) {
      timers.push({ callback, delay });
      return timers.length;
    },
  });
  vm.runInContext(
    `selectedProfiles = [{ name: 'Yoojin L.', url: '${profileUrl}', status: 'pending' }]`,
    sandbox,
  );

  sandbox.processNextProfile(0);

  assert.equal(
    vm.runInContext('selectedProfiles[0].status', sandbox),
    'processing',
  );
  const requestId = sandbox.__runtimeMessages[0].requestId;
  for (const listener of sandbox.__runtimeListeners) {
    listener({
      source: 'linkedin-invite-extension',
      action: 'batchProfileResult',
      requestId,
      status: 'completed',
      profileUrl,
    });
  }

  assert.equal(
    vm.runInContext('selectedProfiles[0].status', sandbox),
    'completed',
  );
});

test('findProfileName reads the current LinkedIn profile name from the new profile header h2', () => {
  const profileName = makeElement({ textContent: 'Yoojin L.' });
  const profileLink = makeElement({
    href: 'https://www.linkedin.com/in/yoojin-lim/',
    querySelectorMap: {
      h2: profileName,
      'h1, h2': profileName,
    },
  });
  const document = makeDocument({
    title: 'LinkedIn',
    querySelectorAllMap: {
      'a[href*="/in/"]': [profileLink],
      h1: [],
    },
  });

  const sandbox = loadDetect(document);

  assert.equal(sandbox.findProfileName(), 'Yoojin L.');
});

test('findProfileName falls back to plain LinkedIn page titles without notification counts', () => {
  const document = makeDocument({
    title: 'Yoojin L. | LinkedIn',
    querySelectorAllMap: {
      h1: [],
    },
  });

  const sandbox = loadDetect(document);

  assert.equal(sandbox.findProfileName(), 'Yoojin L.');
});

test('findConnectButton returns LinkedIn styled connect link anchors', () => {
  const connectLink = makeElement({
    textContent: 'Connect',
    href: '/preload/custom-invite/?vanityName=yoojin-lim',
    ariaLabel: 'Invite Yoojin L. to connect',
  });
  const mainProfile = makeElement({
    querySelectorAllMap: {
      'button[aria-label*="connect" i], button[aria-label*="invite" i]': [],
      'a[aria-label*="connect" i], a[aria-label*="invite" i], a[href*="/preload/custom-invite/"]': [
        connectLink,
      ],
      button: [],
    },
  });
  const document = makeDocument({
    querySelectorMap: {
      '.ph5.pb5': mainProfile,
    },
  });

  const sandbox = loadDetect(document);

  assert.equal(sandbox.findConnectButton(), connectLink);
});

test('findConnectButton falls back to document-level connect links when LinkedIn randomizes the profile container classes', () => {
  const connectLink = makeElement({
    textContent: 'Connect',
    href: '/preload/custom-invite/?vanityName=zeyu-jack-zou',
    ariaLabel: 'Invite Zeyu Zou to connect',
  });
  const document = makeDocument({
    querySelectorAllMap: {
      'button[aria-label*="connect" i], button[aria-label*="invite" i]': [],
      'a[aria-label*="connect" i], a[aria-label*="invite" i], a[href*="/preload/custom-invite/"]': [
        connectLink,
      ],
      button: [],
    },
  });

  const sandbox = loadDetect(document, 'https://www.linkedin.com/in/zeyu-jack-zou/');

  assert.equal(sandbox.findConnectButton(), connectLink);
});

test('findConnectButton ignores document-level connect links for other profiles', () => {
  const sidebarConnectLink = makeElement({
    textContent: 'Connect',
    href: '/preload/custom-invite/?vanityName=someone-else',
    ariaLabel: 'Invite Someone Else to connect',
  });
  const document = makeDocument({
    querySelectorAllMap: {
      'button[aria-label*="connect" i], button[aria-label*="invite" i]': [],
      'a[aria-label*="connect" i], a[aria-label*="invite" i], a[href*="/preload/custom-invite/"]': [
        sidebarConnectLink,
      ],
      button: [],
    },
  });

  const sandbox = loadDetect(document, 'https://www.linkedin.com/in/zeyu-jack-zou/');

  assert.equal(sandbox.findConnectButton(), null);
});

test('handleAddNote waits until LinkedIn renders the Add a note button', () => {
  const timers = [];
  const addNoteButton = makeElement({
    textContent: 'Add a note',
    ariaLabel: 'Add a note',
  });
  let rendered = false;
  const document = makeDocument();
  document.querySelectorAll = (selector) => {
    if (selector === 'button[aria-label="Add a note"]') {
      return rendered ? [addNoteButton] : [];
    }
    return [];
  };

  const sandbox = loadDetect(document, undefined, {
    setTimeout(callback) {
      timers.push(() => {
        rendered = true;
        callback();
      });
    },
  });

  sandbox.handleAddNote(false);

  assert.equal(addNoteButton.clicked, false);
  assert.equal(timers.length, 1);

  timers.shift()();

  assert.equal(addNoteButton.clicked, true);
});

test('handleAddNote keeps polling long enough for a delayed LinkedIn modal', () => {
  const timers = [];
  let elapsedTicks = 0;
  const addNoteButton = makeElement({
    textContent: 'Add a note',
    ariaLabel: 'Add a note',
  });
  const document = makeDocument();
  document.querySelectorAll = (selector) => {
    if (selector === 'button[aria-label="Add a note"]') {
      return elapsedTicks >= 25 ? [addNoteButton] : [];
    }
    return [];
  };
  const sandbox = loadDetect(document, undefined, {
    setTimeout(callback) {
      timers.push(() => {
        elapsedTicks += 1;
        callback();
      });
    },
  });

  sandbox.handleAddNote(false);
  while (timers.length > 0 && !addNoteButton.clicked) {
    timers.shift()();
  }

  assert.equal(addNoteButton.clicked, true);
});

test('a DOM mutation clicks Add a note and cancels the stale polling request', () => {
  const timers = [];
  let modalRendered = false;
  let clickCount = 0;
  const addNoteButton = makeElement({
    textContent: 'Add a note',
    ariaLabel: 'Add a note',
  });
  addNoteButton.click = () => {
    clickCount += 1;
  };
  const document = makeDocument();
  document.querySelectorAll = (selector) => {
    if (selector === 'button[aria-label="Add a note"]') {
      return modalRendered ? [addNoteButton] : [];
    }
    return [];
  };
  const sandbox = loadDetect(document, undefined, {
    setTimeout(callback) {
      timers.push(callback);
    },
  });

  sandbox.handleAddNote(false);
  assert.equal(timers.length, 1);

  modalRendered = true;
  sandbox.__mutationObservers[0].callback([]);
  assert.equal(clickCount, 1);

  timers.shift()();
  assert.equal(clickCount, 1);
});

test('findAddNoteButton finds the invite modal inside a same-origin preload frame', () => {
  const addNoteButton = makeElement({
    textContent: 'Add a note',
    ariaLabel: 'Add a note',
  });
  const preloadDocument = makeDocument({
    querySelectorAllMap: {
      'button[aria-label="Add a note"]': [addNoteButton],
    },
  });
  const document = makeDocument({
    querySelectorAllMap: {
      iframe: [makeElement({ contentDocument: preloadDocument })],
    },
  });

  const sandbox = loadDetect(document);

  assert.equal(sandbox.findAddNoteButton(), addNoteButton);
});

test('findAddNoteButton finds the invite modal inside the LinkedIn interop shadow root', () => {
  const addNoteButton = makeElement({
    textContent: 'Add a note',
    ariaLabel: 'Add a note',
  });
  const shadowRoot = makeDocument({
    querySelectorAllMap: {
      'button[aria-label="Add a note"]': [addNoteButton],
    },
  });
  const interopOutlet = makeElement({ shadowRoot });
  const document = makeDocument({
    querySelectorAllMap: {
      '#interop-outlet, [data-testid="interop-shadowdom"]': [interopOutlet],
    },
  });
  const sandbox = loadDetect(document);

  assert.equal(sandbox.findAddNoteButton(), addNoteButton);
});

test('handleAddNote logs the selector match and click details', () => {
  const logs = [];
  const addNoteButton = makeElement({
    textContent: 'Add a note',
    ariaLabel: 'Add a note',
  });
  const document = makeDocument({
    querySelectorAllMap: {
      'button[aria-label="Add a note"]': [addNoteButton],
      iframe: [],
    },
  });
  const sandbox = loadDetect(document, undefined, { logs });

  sandbox.handleAddNote(false);

  const diagnosticEvents = logs
    .map((entry) => entry[1])
    .filter((value) => value && value.event);
  const foundEvent = diagnosticEvents.find(
    (event) => event.event === 'ADD_NOTE_FOUND',
  );
  assert.equal(foundEvent.documentIndex, 0);
  assert.equal(foundEvent.selector, 'button[aria-label="Add a note"]');
  assert.equal(foundEvent.button.ariaLabel, 'Add a note');

  const clickEvent = diagnosticEvents.find(
    (event) => event.event === 'ADD_NOTE_CLICK',
  );
  assert.equal(clickEvent.button.ariaLabel, 'Add a note');
  assert.equal(addNoteButton.clicked, true);
});

test('handleAddNote leaves the modal open when the button never appears', () => {
  const dismissButton = makeElement({ textContent: 'Dismiss' });
  const document = makeDocument({
    querySelectorAllMap: {
      'button[aria-label="Dismiss"], button.artdeco-modal__dismiss': [dismissButton],
    },
  });
  const sandbox = loadDetect(document);
  let reconnectCalls = 0;
  sandbox.findAndClickConnect = () => {
    reconnectCalls += 1;
  };

  sandbox.handleAddNote(false, 0);

  assert.equal(dismissButton.clicked, false);
  assert.equal(reconnectCalls, 0);
});

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

  const event = logs
    .map((entry) => entry[1])
    .find((value) => value && value.event === 'ADD_NOTE_SCAN');
  assert.equal(event.frameRole, 'top');
  assert.equal(event.retriesRemaining, 0);
  assert.equal(event.modalOutletCount, 1);
  assert.equal(event.dialogCount, 1);
  assert.equal(event.modalCount, 1);
  assert.equal(event.addNoteButtonCount, 0);
  assert.equal(event.iframeCount, 0);
});

test('fillCustomMessage fills the invitation textarea inside the preload frame', () => {
  const textarea = makeElement();
  const preloadDocument = makeDocument({
    querySelectorMap: {
      'textarea#custom-message': textarea,
    },
  });
  const document = makeDocument({
    querySelectorAllMap: {
      iframe: [makeElement({ contentDocument: preloadDocument })],
    },
  });
  const sandbox = loadDetect(document, undefined, {
    settings: {
      hasInitializedSettings: true,
      messageTemplate: 'Hi {{firstName}}',
    },
  });

  sandbox.fillCustomMessage(false);

  assert.equal(textarea.value, 'Hi Yoojin');
});

test('fillCustomMessage fills the invitation textarea inside the interop shadow root', () => {
  const textarea = makeElement();
  const shadowRoot = makeDocument({
    querySelectorMap: {
      'textarea#custom-message': textarea,
    },
  });
  const document = makeDocument({
    querySelectorAllMap: {
      '#interop-outlet, [data-testid="interop-shadowdom"]': [
        makeElement({ shadowRoot }),
      ],
    },
  });
  const sandbox = loadDetect(document, undefined, {
    settings: {
      hasInitializedSettings: true,
      messageTemplate: 'Hi {{firstName}}',
    },
  });

  sandbox.fillCustomMessage(false);

  assert.equal(textarea.value, 'Hi Yoojin');
});

test('fillCustomMessage finds the Send button inside the preload frame', () => {
  const timers = [];
  const textarea = makeElement();
  const sendButton = makeElement({
    textContent: 'Send',
    ariaLabel: 'Send invitation',
  });
  const preloadDocument = makeDocument({
    querySelectorMap: {
      'textarea#custom-message': textarea,
    },
    querySelectorAllMap: {
      'button[aria-label="Send invitation"]': [sendButton],
    },
  });
  const document = makeDocument({
    querySelectorAllMap: {
      iframe: [makeElement({ contentDocument: preloadDocument })],
    },
  });
  const sandbox = loadDetect(document, undefined, {
    setTimeout(callback) {
      timers.push(callback);
    },
    settings: {
      hasInitializedSettings: true,
      messageTemplate: 'Hi {{firstName}}',
    },
  });

  sandbox.fillCustomMessage(true);
  timers.shift()();

  assert.equal(sendButton.clicked, true);
});

test('fillCustomMessage finds the Send button inside the interop shadow root', () => {
  const timers = [];
  const textarea = makeElement();
  const sendButton = makeElement({
    textContent: 'Send',
    ariaLabel: 'Send invitation',
  });
  const shadowRoot = makeDocument({
    querySelectorMap: {
      'textarea#custom-message': textarea,
    },
    querySelectorAllMap: {
      'button[aria-label="Send invitation"]': [sendButton],
    },
  });
  const document = makeDocument({
    querySelectorAllMap: {
      '#interop-outlet, [data-testid="interop-shadowdom"]': [
        makeElement({ shadowRoot }),
      ],
    },
  });
  const sandbox = loadDetect(document, undefined, {
    setTimeout(callback) {
      timers.push(callback);
    },
    settings: {
      hasInitializedSettings: true,
      messageTemplate: 'Hi {{firstName}}',
    },
  });

  sandbox.fillCustomMessage(true);
  timers.shift()();

  assert.equal(sendButton.clicked, true);
});

test('fillCustomMessage confirms a successful batch send to the background worker', () => {
  const timers = [];
  const textarea = makeElement();
  const sendButton = makeElement({
    textContent: 'Send',
    ariaLabel: 'Send invitation',
  });
  const document = makeDocument({
    querySelectorMap: {
      'textarea#custom-message': textarea,
    },
    querySelectorAllMap: {
      'button[aria-label="Send invitation"]': [sendButton],
    },
  });
  const sandbox = loadDetect(document, undefined, {
    setTimeout(callback) {
      timers.push(callback);
    },
    settings: {
      hasInitializedSettings: true,
      messageTemplate: 'Hi {{firstName}}',
    },
  });
  vm.runInContext(
    "activeBatchAutomationRequestId = 'batch-1'; activeBatchAutomationSourceTabId = 7",
    sandbox,
  );

  sandbox.fillCustomMessage(true);
  timers.shift()();

  assert.equal(sendButton.clicked, true);
  assert.equal(sandbox.__runtimeMessages.length, 1);
  assert.equal(sandbox.__runtimeMessages[0].source, 'linkedin-invite-extension');
  assert.equal(sandbox.__runtimeMessages[0].action, 'batchProfileResult');
  assert.equal(sandbox.__runtimeMessages[0].requestId, 'batch-1');
  assert.equal(sandbox.__runtimeMessages[0].sourceTabId, 7);
  assert.equal(sandbox.__runtimeMessages[0].status, 'completed');
});

test('a child frame handles an invite-modal command from its parent', () => {
  const timers = [];
  const logs = [];
  const addNoteButton = makeElement({
    textContent: 'Add a note',
    ariaLabel: 'Add a note',
  });
  const textarea = makeElement();
  const document = makeDocument({
    title: 'LinkedIn',
    querySelectorMap: {
      'textarea#custom-message': textarea,
    },
    querySelectorAllMap: {
      'button[aria-label="Add a note"]': [addNoteButton],
    },
  });
  const sandbox = loadDetect(
    document,
    'https://www.linkedin.com/preload/custom-invite/?vanityName=yoojin-lim',
    {
      isTopFrame: false,
      logs,
      setTimeout(callback) {
        timers.push(callback);
      },
      settings: {
        hasInitializedSettings: true,
        messageTemplate: 'Hi {{firstName}}',
      },
    },
  );

  for (const listener of sandbox.__windowListeners.message || []) {
    listener({
      data: {
        source: 'linkedin-invite-extension',
        action: 'handleInviteModal',
        shouldSend: false,
        profileName: 'Yoojin L.',
      },
      source: sandbox.window.parent,
      origin: 'https://www.linkedin.com',
    });
  }

  assert.equal(addNoteButton.clicked, true);
  timers.shift()();
  assert.equal(textarea.value, 'Hi Yoojin');

  const receivedEvent = logs
    .map((entry) => entry[1])
    .find((value) => value && value.event === 'FRAME_MESSAGE_RECEIVED');
  assert.equal(receivedEvent.origin, 'https://www.linkedin.com');
  assert.equal(receivedEvent.sourceIsParent, true);
  assert.equal(receivedEvent.action, 'handleInviteModal');
});

test('the parent frame broadcasts invite-modal commands to child frames', () => {
  const postedMessages = [];
  const logs = [];
  const frame = makeElement({
    src: 'https://www.linkedin.com/preload/?_bprMode=vanilla',
    contentWindow: {
      postMessage(message, targetOrigin) {
        postedMessages.push({ message, targetOrigin });
      },
    },
  });
  const thirdPartyFrame = makeElement({
    src: 'https://example.com/embedded',
    contentWindow: {
      postMessage(message, targetOrigin) {
        postedMessages.push({ message, targetOrigin });
      },
    },
  });
  const document = makeDocument({
    querySelectorAllMap: {
      iframe: [frame, thirdPartyFrame],
    },
  });
  const sandbox = loadDetect(document, undefined, { logs });

  sandbox.broadcastInviteModalCommand(false, 'Yoojin L.');

  assert.equal(postedMessages.length, 1);
  assert.equal(postedMessages[0].targetOrigin, 'https://www.linkedin.com');
  assert.equal(postedMessages[0].message.source, 'linkedin-invite-extension');
  assert.equal(postedMessages[0].message.action, 'handleInviteModal');
  assert.equal(postedMessages[0].message.shouldSend, false);
  assert.equal(postedMessages[0].message.profileName, 'Yoojin L.');

  const diagnosticEvents = logs
    .map((entry) => entry[1])
    .filter((value) => value && value.event);
  assert.equal(
    diagnosticEvents.filter((event) => event.event === 'FRAME_DISCOVERY').length,
    2,
  );
  assert.equal(
    diagnosticEvents.filter((event) => event.event === 'FRAME_MESSAGE_SENT').length,
    1,
  );
  assert.equal(
    diagnosticEvents.filter((event) => event.event === 'FRAME_MESSAGE_SKIPPED').length,
    1,
  );
  const skippedEvent = diagnosticEvents.find(
    (event) => event.event === 'FRAME_MESSAGE_SKIPPED',
  );
  assert.equal(skippedEvent.reason, 'not-linkedin-frame');
  const delegatedEvent = diagnosticEvents.find(
    (event) => event.event === 'INVITE_DELEGATED',
  );
  assert.equal(delegatedEvent.frameCount, 2);
  assert.equal(delegatedEvent.recipients, 1);
});

test('the top frame keeps polling after delegating to a child frame', () => {
  const timers = [];
  const postedMessages = [];
  let modalRendered = false;
  const addNoteButton = makeElement({
    textContent: 'Add a note',
    ariaLabel: 'Add a note',
  });
  const frame = makeElement({
    src: 'https://www.linkedin.com/preload/?_bprMode=vanilla',
    contentWindow: {
      postMessage(message) {
        postedMessages.push(message);
      },
    },
  });
  const document = makeDocument();
  document.querySelectorAll = (selector) => {
    if (selector === 'iframe') return [frame];
    if (selector === 'button[aria-label="Add a note"]') {
      return modalRendered ? [addNoteButton] : [];
    }
    return [];
  };
  const sandbox = loadDetect(document, undefined, {
    setTimeout(callback) {
      timers.push(() => {
        modalRendered = true;
        callback();
      });
    },
  });

  sandbox.handleAddNote(false);

  assert.equal(postedMessages.length, 1);
  assert.equal(timers.length, 1);
  timers.shift()();
  assert.equal(addNoteButton.clicked, true);
});

test('a child frame polls locally without delegating to nested LinkedIn frames', () => {
  const timers = [];
  const postedMessages = [];
  const nestedFrame = makeElement({
    src: 'https://merchantpool1.linkedin.com/',
    contentWindow: {
      postMessage(message) {
        postedMessages.push(message);
      },
    },
  });
  const document = makeDocument({
    querySelectorAllMap: {
      iframe: [nestedFrame],
    },
  });
  const sandbox = loadDetect(document, undefined, {
    isTopFrame: false,
    setTimeout(callback) {
      timers.push(callback);
    },
  });

  sandbox.handleAddNote(false);

  assert.equal(postedMessages.length, 0);
  assert.equal(timers.length, 1);
});

test('clicking Connect starts the child-frame flow and keeps top-frame polling', () => {
  const timers = [];
  const postedMessages = [];
  const connectLink = makeElement({
    textContent: 'Connect',
    href: '/preload/custom-invite/?vanityName=yoojin-lim',
    ariaLabel: 'Invite Yoojin L. to connect',
  });
  const frame = makeElement({
    src: 'https://www.linkedin.com/preload/?_bprMode=vanilla',
    contentWindow: {
      postMessage(message) {
        postedMessages.push(message);
      },
    },
  });
  const document = makeDocument({
    querySelectorAllMap: {
      'button[aria-label*="connect" i], button[aria-label*="invite" i]': [],
      'a[aria-label*="connect" i], a[aria-label*="invite" i], a[href*="/preload/custom-invite/"]': [
        connectLink,
      ],
      button: [],
      iframe: [frame],
    },
  });
  const sandbox = loadDetect(document, undefined, {
    setTimeout(callback) {
      timers.push(callback);
    },
  });

  sandbox.findAndClickConnect(false, 'Yoojin L.');
  timers.shift()();

  assert.equal(postedMessages.length, 1);
  assert.equal(postedMessages[0].action, 'handleInviteModal');
  assert.equal(postedMessages[0].shouldSend, false);
  assert.equal(postedMessages[0].profileName, 'Yoojin L.');
  assert.equal(timers.length, 1);
});

test('Alt+W invokes automation once per keydown', () => {
  const listeners = {};
  const document = makeDocument({ listeners });
  const sandbox = loadDetect(document);
  let calls = 0;
  sandbox.automateLinkedInConnect = (shouldSend) => {
    calls += 1;
    assert.equal(shouldSend, true);
  };

  listeners.keydown({
    altKey: true,
    code: 'KeyW',
    ctrlKey: false,
    key: '∑',
    keyCode: 87,
    location: 0,
    metaKey: false,
    preventDefault() {},
    stopPropagation() {},
    which: 87,
  });

  assert.equal(calls, 1);
});

test('Alt+W does not start profile automation inside a child frame', () => {
  const listeners = {};
  const document = makeDocument({ listeners });
  const sandbox = loadDetect(
    document,
    'https://www.linkedin.com/preload/?_bprMode=vanilla',
    { isTopFrame: false },
  );
  let calls = 0;
  sandbox.automateLinkedInConnect = () => {
    calls += 1;
  };

  listeners.keydown({
    altKey: true,
    code: 'KeyW',
    ctrlKey: false,
    key: 'w',
    keyCode: 87,
    location: 0,
    metaKey: false,
    preventDefault() {},
    stopPropagation() {},
    which: 87,
  });

  assert.equal(calls, 0);
});
