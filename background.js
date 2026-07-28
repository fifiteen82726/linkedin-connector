const INVITE_MESSAGE_SOURCE = 'linkedin-invite-extension';
const MAX_AUTOMATION_DELIVERY_ATTEMPTS = 20;
const BATCH_JOB_STORAGE_PREFIX = 'linkedin-invite-batch-job:';
const batchJobsByTargetTab = new Map();

function getBatchJobStorageKey(targetTabId) {
  return `${BATCH_JOB_STORAGE_PREFIX}${targetTabId}`;
}

function persistBatchJob(targetTabId, job, callback = () => {}) {
  batchJobsByTargetTab.set(targetTabId, job);
  chrome.storage.session.set({
    [getBatchJobStorageKey(targetTabId)]: {
      ...job,
      sending: false
    }
  }, callback);
}

function getBatchJob(targetTabId, callback) {
  const cachedJob = batchJobsByTargetTab.get(targetTabId);
  if (cachedJob) {
    callback(cachedJob);
    return;
  }

  const storageKey = getBatchJobStorageKey(targetTabId);
  chrome.storage.session.get(storageKey, (items) => {
    const storedJob = items[storageKey];
    if (!storedJob) {
      callback(null);
      return;
    }

    const restoredJob = {
      ...storedJob,
      sending: false
    };
    batchJobsByTargetTab.set(targetTabId, restoredJob);
    callback(restoredJob);
  });
}

function forgetBatchJob(targetTabId, callback = () => {}) {
  batchJobsByTargetTab.delete(targetTabId);
  chrome.storage.session.remove(
    getBatchJobStorageKey(targetTabId),
    callback
  );
}

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

function removeBatchTargetTab(targetTabId) {
  chrome.tabs.remove(targetTabId, () => {
    if (chrome.runtime.lastError) {
      console.warn('Could not close batch profile tab:', chrome.runtime.lastError.message);
    }
  });
}

function closeBatchTarget(targetTabId) {
  forgetBatchJob(targetTabId, () => removeBatchTargetTab(targetTabId));
}

function startBatchAutomation(targetTabId) {
  getBatchJob(targetTabId, (job) => {
    if (!job || job.started || job.sending) return;
    job.sending = true;
    job.deliveryAttempts += 1;

    persistBatchJob(targetTabId, job, () => {
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
          persistBatchJob(targetTabId, job);
          return;
        }

        const reason = chrome.runtime.lastError
          ? chrome.runtime.lastError.message
          : 'Profile content script did not accept the automation command';
        if (job.deliveryAttempts < MAX_AUTOMATION_DELIVERY_ATTEMPTS) {
          persistBatchJob(targetTabId, job, () => {
            setTimeout(() => startBatchAutomation(targetTabId), 500);
          });
          return;
        }

        relayBatchResult(job, 'failed', reason);
        closeBatchTarget(targetTabId);
      });
    });
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

      const job = {
        profileUrl: message.profileUrl,
        requestId: message.requestId,
        shouldSend: message.shouldSend,
        sourceTabId: sender.tab.id,
        started: false,
        sending: false,
        deliveryAttempts: 0
      };
      persistBatchJob(tab.id, job, () => {
        sendResponse({ accepted: true, tabId: tab.id });

        if (tab.status === 'complete') {
          startBatchAutomation(tab.id);
        }
      });
    });
    return true;
  }

  if (message.action === 'batchProfileResult' && sender.tab) {
    getBatchJob(sender.tab.id, (storedJob) => {
      const sourceTabId = storedJob
        ? storedJob.sourceTabId
        : message.sourceTabId;
      if (!Number.isInteger(sourceTabId) ||
          (!storedJob && sender.frameId !== 0) ||
          (storedJob && storedJob.requestId !== message.requestId)) {
        return;
      }

      if (sender.frameId !== 0 && message.status !== 'completed') {
        sendResponse({ accepted: true, ignored: true });
        return;
      }

      const job = storedJob || {
        profileUrl: message.profileUrl,
        requestId: message.requestId,
        sourceTabId
      };
      relayBatchResult(job, message.status, message.reason || '');
      if (message.status === 'completed') {
        forgetBatchJob(sender.tab.id);
        setTimeout(() => removeBatchTargetTab(sender.tab.id), 1500);
      } else {
        closeBatchTarget(sender.tab.id);
      }
      sendResponse({ accepted: true });
    });
    return true;
  }

  return false;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    getBatchJob(tabId, (job) => {
      if (!job) return;
      job.started = false;
      persistBatchJob(tabId, job);
    });
    return;
  }

  if (changeInfo.status === 'complete') {
    startBatchAutomation(tabId);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  getBatchJob(tabId, (job) => {
    if (!job) return;

    forgetBatchJob(tabId);
    relayBatchResult(job, 'failed', 'Profile tab was closed before automation completed');
  });
});
