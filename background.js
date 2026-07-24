const INVITE_MESSAGE_SOURCE = 'linkedin-invite-extension';
const MAX_AUTOMATION_DELIVERY_ATTEMPTS = 20;
const batchJobsByTargetTab = new Map();

function relayBatchResult(job, status, reason = '') {
  chrome.tabs.sendMessage(job.sourceTabId, {
    source: INVITE_MESSAGE_SOURCE,
    action: 'batchProfileResult',
    requestId: job.requestId,
    profileUrl: job.profileUrl,
    status,
    reason
  }, { frameId: 0 }, () => {
    if (chrome.runtime.lastError) {
      console.warn('Could not relay batch result:', chrome.runtime.lastError.message);
    }
  });
}

function closeBatchTarget(targetTabId) {
  batchJobsByTargetTab.delete(targetTabId);
  chrome.tabs.remove(targetTabId, () => {
    if (chrome.runtime.lastError) {
      console.warn('Could not close batch profile tab:', chrome.runtime.lastError.message);
    }
  });
}

function startBatchAutomation(targetTabId) {
  const job = batchJobsByTargetTab.get(targetTabId);
  if (!job || job.started || job.sending) return;
  job.sending = true;
  job.deliveryAttempts += 1;

  chrome.tabs.sendMessage(targetTabId, {
    source: INVITE_MESSAGE_SOURCE,
    action: 'autoConnect',
    requestId: job.requestId,
    sourceTabId: job.sourceTabId,
    profileUrl: job.profileUrl,
    shouldSend: job.shouldSend
  }, { frameId: 0 }, (response) => {
    job.sending = false;
    if (!chrome.runtime.lastError && response && response.accepted) {
      job.started = true;
      return;
    }

    const reason = chrome.runtime.lastError
      ? chrome.runtime.lastError.message
      : 'Profile content script did not accept the automation command';
    if (job.deliveryAttempts < MAX_AUTOMATION_DELIVERY_ATTEMPTS) {
      setTimeout(() => startBatchAutomation(targetTabId), 500);
      return;
    }

    relayBatchResult(job, 'failed', reason);
    closeBatchTarget(targetTabId);
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.source !== INVITE_MESSAGE_SOURCE) {
    return false;
  }

  if (message.action === 'openBatchProfile') {
    if (sender.frameId !== 0 || !sender.tab || !sender.tab.id) {
      sendResponse({ accepted: false, error: 'Batch requests require a top-frame tab' });
      return false;
    }

    chrome.tabs.create({
      active: false,
      url: message.profileUrl
    }, (tab) => {
      if (chrome.runtime.lastError || !tab || !tab.id) {
        sendResponse({
          accepted: false,
          error: chrome.runtime.lastError
            ? chrome.runtime.lastError.message
            : 'Could not create profile tab'
        });
        return;
      }

      batchJobsByTargetTab.set(tab.id, {
        profileUrl: message.profileUrl,
        requestId: message.requestId,
        shouldSend: message.shouldSend,
        sourceTabId: sender.tab.id,
        started: false,
        sending: false,
        deliveryAttempts: 0
      });
      sendResponse({ accepted: true, tabId: tab.id });

      if (tab.status === 'complete') {
        startBatchAutomation(tab.id);
      }
    });
    return true;
  }

  if (message.action === 'batchProfileResult' && sender.tab) {
    const storedJob = batchJobsByTargetTab.get(sender.tab.id);
    const sourceTabId = storedJob
      ? storedJob.sourceTabId
      : message.sourceTabId;
    if (!Number.isInteger(sourceTabId) ||
        (!storedJob && sender.frameId !== 0) ||
        (storedJob && storedJob.requestId !== message.requestId)) {
      return false;
    }

    const job = storedJob || {
      profileUrl: message.profileUrl,
      requestId: message.requestId,
      sourceTabId
    };
    relayBatchResult(job, message.status, message.reason || '');
    if (message.status === 'completed') {
      batchJobsByTargetTab.delete(sender.tab.id);
      setTimeout(() => closeBatchTarget(sender.tab.id), 1500);
    } else {
      closeBatchTarget(sender.tab.id);
    }
    sendResponse({ accepted: true });
  }

  return false;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    const job = batchJobsByTargetTab.get(tabId);
    if (job) {
      job.started = false;
    }
    return;
  }

  if (changeInfo.status === 'complete') {
    startBatchAutomation(tabId);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  const job = batchJobsByTargetTab.get(tabId);
  if (!job) return;

  batchJobsByTargetTab.delete(tabId);
  relayBatchResult(job, 'failed', 'Profile tab was closed before automation completed');
});
