// Track modifier key states
let altKeyPressed = false;
let optionKeyPressed = false;

// Store selected profiles
let selectedProfiles = [];

// Add a status property to track connection progress
// Possible status values: 'pending', 'processing', 'completed', 'failed'

// Add this at the top of the file with other state variables
let showFloatingPanel = true; // Set this to true to enable floating panel

const INVITE_MESSAGE_SOURCE = 'linkedin-invite-extension';
const ADD_NOTE_INITIAL_RETRIES = 60;
const BATCH_PROFILE_TIMEOUT_MS = 60000;
const AUTO_SELECT_TARGET = 10;
const AUTO_SELECT_MAX_LOADS = 2;
const AUTO_SELECT_LOAD_TIMEOUT_MS = 5000;
let activeAddNoteRequest = null;
let activeBatchAutomationRequestId = null;
let activeBatchAutomationSourceTabId = null;
let activeBatchProfileRequest = null;
let nextAddNoteRequestId = 1;
let nextBatchRequestId = 1;
let autoSelectRunning = false;

function notifyBatchController(status, reason = '') {
  if (!activeBatchAutomationRequestId) {
    return false;
  }

  const requestId = activeBatchAutomationRequestId;
  const sourceTabId = activeBatchAutomationSourceTabId;
  activeBatchAutomationRequestId = null;
  activeBatchAutomationSourceTabId = null;
  chrome.runtime.sendMessage({
    source: INVITE_MESSAGE_SOURCE,
    action: 'batchProfileResult',
    requestId,
    sourceTabId,
    profileUrl: window.location.href,
    status,
    reason
  });
  return true;
}

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

function summarizeElement(element) {
  return {
    tagName: element.tagName || '',
    text: (element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120),
    ariaLabel: element.getAttribute && element.getAttribute('aria-label') || '',
    id: element.id || '',
    disabled: Boolean(element.disabled)
  };
}

function getAddNoteAttempt(retriesRemaining) {
  return ADD_NOTE_INITIAL_RETRIES - retriesRemaining + 1;
}

function logAddNoteScan(retriesRemaining) {
  const shouldIncludeSnapshot = retriesRemaining === ADD_NOTE_INITIAL_RETRIES ||
    retriesRemaining % 5 === 0;
  if (!shouldIncludeSnapshot) return;

  const searchRoots = getAccessibleRoots();
  const countAcrossRoots = (selector) => searchRoots.reduce((count, root) => {
    try {
      return count + root.querySelectorAll(selector).length;
    } catch (e) {
      return count;
    }
  }, 0);
  const details = {
    attempt: getAddNoteAttempt(retriesRemaining),
    retriesRemaining,
    modalOutletCount: countAcrossRoots('#artdeco-modal-outlet'),
    dialogCount: countAcrossRoots('[data-test-modal-id="send-invite-modal"]'),
    modalCount: countAcrossRoots('[data-test-modal]'),
    addNoteButtonCount: countAcrossRoots('button[aria-label="Add a note"]'),
    accessibleDocumentCount: getAccessibleDocuments().length,
    searchRootCount: searchRoots.length,
    shadowRootCount: searchRoots.filter((root) => root.host).length,
    iframeCount: document.querySelectorAll('iframe').length,
    activeElement: document.activeElement ? summarizeElement(document.activeElement) : null
  };

  if (retriesRemaining === 0) {
    details.buttonSamples = Array.from(document.querySelectorAll('button'))
      .slice(0, 20)
      .map(summarizeElement);
  }

  logDiagnostic('ADD_NOTE_SCAN', details);
}

// Default settings and initialization
const DEFAULT_SETTINGS = {
  myName: 'Sunny',
  myRole: 'Sr. Data Engineer',
  myCompany: 'American Airlines',
  targetRole: 'Data',
  messageTemplate: `Hi {{firstName}},

Hope you are doing well!
I'm {{myName}}, currently a {{myRole}} at {{myCompany}}. Impressed by your background, I'd like to connect and seek your referral for {{targetRole}} opportunities. Please let me share my resume once we connect on LinkedIn. Thanks!`,
  hasInitializedSettings: false
};

// Initialize settings
const userSettings = { ...DEFAULT_SETTINGS };

// Load settings from chrome.storage
chrome.storage.sync.get(DEFAULT_SETTINGS, function(items) {
  Object.assign(userSettings, items);
});

logDiagnostic('SCRIPT_INIT', {
  referrer: document.referrer || ''
});

// Listen for keydown events
document.addEventListener('keydown', function(event) {
  if (window !== window.top) {
    return;
  }

  // Log all key events for debugging
  console.log('Key Event:', {
    key: event.key,
    code: event.code,
    altKey: event.altKey,
    metaKey: event.metaKey,
    ctrlKey: event.ctrlKey,
    location: event.location,
    keyCode: event.keyCode,
    which: event.which
  });

  // Update modifier key states
  if (event.key === 'Alt' || event.key === 'Meta' || event.altKey || event.metaKey) {
    altKeyPressed = true;
    console.log('Modifier key pressed:', event.key);
  }

  // Check for hotkey combinations
  // We'll check both direct key state and event properties
  const isModifierPressed = altKeyPressed || event.altKey || event.metaKey;

  if (isModifierPressed) {
    let handled = true;

    switch (event.code) {
      case 'KeyW':
        console.log('%c HOTKEY "Option+W" DETECTED! (Fill and Send)', 'background: #ff0000; color: #ffffff; font-size: 16px; font-weight: bold;');
        automateLinkedInConnect(true);
        break;
      case 'KeyQ':
        console.log('%c HOTKEY "Option+Q" DETECTED! (Fill Only)', 'background: #ff0000; color: #ffffff; font-size: 16px; font-weight: bold;');
        automateLinkedInConnect(false);
        break;
      case 'KeyS':
        console.log('%c HOTKEY "Option+S" DETECTED! (Open Settings)', 'background: #ff0000; color: #ffffff; font-size: 16px; font-weight: bold;');
        showSettingsDialog();
        break;
      case 'KeyO':
        showFloatingPanel = !showFloatingPanel; // Toggle the floating panel
        console.log(`%c HOTKEY "Alt+O" DETECTED! (Floating Panel ${showFloatingPanel ? 'Enabled' : 'Disabled'})`, 'background: #ff0000; color: #ffffff; font-size: 16px; font-weight: bold;');
        
        if (showFloatingPanel) {
          createFloatingPanel();
          updateFloatingPanel();
        } else {
          const panel = document.getElementById('selected-profiles-panel');
          if (panel) {
            panel.remove();
          }
        }
        break;
      default:
        handled = false;
    }

    if (handled) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
  }

  // Update Alt key state
  if (event.key === 'Alt') {
    altKeyPressed = true;
    console.log('Alt key pressed');
  }
  
  // Check for hotkey combinations
  if (altKeyPressed) {
    if (event.code === 'KeyW') {
      console.log('%c HOTKEY "Alt+W" DETECTED! (Fill and Send)', 'background: #ff0000; color: #ffffff; font-size: 16px; font-weight: bold;');
      automateLinkedInConnect(true); // true means fill and send
    } else if (event.code === 'KeyQ') {
      console.log('%c HOTKEY "Alt+Q" DETECTED! (Fill Only)', 'background: #ff0000; color: #ffffff; font-size: 16px; font-weight: bold;');
      automateLinkedInConnect(false); // false means fill only
    } else if (event.code === 'KeyS') {
      console.log('%c HOTKEY "Alt+S" DETECTED! (Open Settings)', 'background: #ff0000; color: #ffffff; font-size: 16px; font-weight: bold;');
      showSettingsDialog();
    } else if (event.code === 'KeyO') {
      showFloatingPanel = !showFloatingPanel; // Toggle the floating panel
      console.log(`%c HOTKEY "Alt+O" DETECTED! (Floating Panel ${showFloatingPanel ? 'Enabled' : 'Disabled'})`, 'background: #ff0000; color: #ffffff; font-size: 16px; font-weight: bold;');
      
      if (showFloatingPanel) {
        createFloatingPanel();
        updateFloatingPanel();
      } else {
        const panel = document.getElementById('selected-profiles-panel');
        if (panel) {
          panel.remove();
        }
      }
    }
  }
  
  // Log the key pressed
  const timestamp = new Date().toLocaleTimeString();
  console.log(`[${timestamp}] Key: "${event.key}" (code: ${event.code}) | Alt: ${altKeyPressed}`);
});

// Listen for keyup events
document.addEventListener('keyup', function(event) {
  if (event.key === 'Alt' || event.key === 'Meta' || !event.altKey) {
    altKeyPressed = false;
    console.log('Modifier key released:', event.key);
  }
});

// Reset modifier keys when window loses focus
window.addEventListener('blur', function() {
  altKeyPressed = false;
  console.log('Window lost focus - reset modifier keys');
});

// Function to determine if we're on a company people page
function isCompanyPeoplePage() {
  return window.location.href.includes('/company/') && window.location.href.includes('/people/');
}

function getCurrentProfileSlug() {
  const match = window.location.href.match(/\/in\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function isCurrentProfileInviteHref(href) {
  const currentSlug = getCurrentProfileSlug();
  if (!currentSlug || !href.includes('/preload/custom-invite/')) {
    return true;
  }

  const vanityMatch = href.match(/[?&]vanityName=([^&#]+)/);
  return vanityMatch ? decodeURIComponent(vanityMatch[1]) === currentSlug : true;
}

function getProfileCards() {
  return Array.from(document.querySelectorAll(
    'li.org-people-profile-card__profile-card-spacing'
  ));
}

function extractProfileCandidate(card) {
  const link = card.querySelector(
    'a[data-test-app-aware-link][href*="/in/"], a[href*="/in/"]'
  );
  const nameElement = card.querySelector('.artdeco-entity-lockup__title');
  const titleElement = card.querySelector(
    '.artdeco-entity-lockup__subtitle, .org-people-profile-card__profile-title'
  );
  const url = link && (link.href || link.getAttribute('href'));
  const name = nameElement && nameElement.textContent.trim();
  if (!url || !name) return null;

  return {
    name,
    title: titleElement ? titleElement.textContent.trim() : '',
    url,
    card
  };
}

function getProfileUrlSet() {
  return new Set(
    getProfileCards()
      .map(extractProfileCandidate)
      .filter(Boolean)
      .map((candidate) => candidate.url)
  );
}

function findShowMoreResultsButton() {
  return Array.from(document.querySelectorAll('button, [role="button"]'))
    .find((element) => {
      const text = (element.textContent || '').replace(/\s+/g, ' ').trim();
      const label = (element.getAttribute('aria-label') || '')
        .replace(/\s+/g, ' ')
        .trim();
      return !element.disabled &&
        element.getAttribute('aria-disabled') !== 'true' &&
        (text === 'Show more results' || label === 'Show more results');
    }) || null;
}

function waitForAdditionalProfileCards(
  previousUrls,
  timeoutMs = AUTO_SELECT_LOAD_TIMEOUT_MS
) {
  return new Promise((resolve) => {
    let settled = false;
    let timeoutId = null;
    const hasNewProfile = () => {
      for (const url of getProfileUrlSet()) {
        if (!previousUrls.has(url)) return true;
      }
      return false;
    };
    const finish = (didLoad) => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      clearTimeout(timeoutId);
      resolve(didLoad);
    };
    const observer = new MutationObserver(() => {
      if (hasNewProfile()) finish(true);
    });

    observer.observe(document.body, { childList: true, subtree: true });
    timeoutId = setTimeout(() => finish(hasNewProfile()), timeoutMs);
    if (hasNewProfile()) finish(true);
  });
}

async function loadAdditionalPeople() {
  let attempts = 0;
  while (attempts < AUTO_SELECT_MAX_LOADS) {
    const button = findShowMoreResultsButton();
    if (!button) break;
    updateAutoSelectStatus(
      `Loading people ${attempts + 1}/${AUTO_SELECT_MAX_LOADS}…`
    );
    const previousUrls = getProfileUrlSet();
    button.click();
    attempts += 1;
    const didLoad = await waitForAdditionalProfileCards(previousUrls);
    if (!didLoad) break;
  }
  return attempts;
}

function setProfileSelectButtonState(button, isSelected) {
  if (!button) return;
  button.innerHTML = isSelected
    ? '<span class="artdeco-button__text">Selected ✓</span>'
    : '<span class="artdeco-button__text">Select</span>';
  button.classList.toggle('artdeco-button--primary', isSelected);
  button.classList.toggle('artdeco-button--tertiary', !isSelected);
}

function syncProfileSelectButton(candidate, isSelected = true) {
  const button = candidate.card &&
    candidate.card.querySelector('.profile-select-button');
  setProfileSelectButtonState(button, isSelected);
}

function updateAutoSelectStatus(message) {
  const status = document.getElementById('auto-select-status');
  if (status) status.textContent = message;
}

function setAutoSelectButtonRunning(isRunning) {
  const button = document.getElementById('auto-select-profiles');
  if (!button) return;
  button.disabled = isRunning;
  button.setAttribute('aria-busy', String(isRunning));
}

async function autoSelectProfiles() {
  if (autoSelectRunning) return false;
  if (selectedProfiles.length >= AUTO_SELECT_TARGET) {
    updateAutoSelectStatus(
      `Selected ${selectedProfiles.length}/${AUTO_SELECT_TARGET} profiles`
    );
    return true;
  }

  autoSelectRunning = true;
  setAutoSelectButtonRunning(true);
  try {
    await loadAdditionalPeople();
    const candidates = getProfileCards()
      .map(extractProfileCandidate)
      .filter(Boolean);
    updateAutoSelectStatus(`Reviewing ${candidates.length} profiles…`);
    const selectedUrls = new Set(
      selectedProfiles.map((profile) => profile.url)
    );
    const ranked = CandidateRules.rankCandidates(candidates, selectedUrls);
    const slots = Math.max(
      0,
      AUTO_SELECT_TARGET - selectedProfiles.length
    );

    for (const candidate of ranked.slice(0, slots)) {
      selectedProfiles.push({
        name: candidate.name,
        url: candidate.url,
        status: 'pending'
      });
      syncProfileSelectButton(candidate, true);
    }

    updateFloatingPanel();
    const message = selectedProfiles.length >= AUTO_SELECT_TARGET
      ? `Selected ${AUTO_SELECT_TARGET}/${AUTO_SELECT_TARGET} profiles`
      : `Only found ${selectedProfiles.length}/${AUTO_SELECT_TARGET} matching profiles`;
    updateAutoSelectStatus(message);
    return true;
  } catch (error) {
    updateAutoSelectStatus(
      `Auto-select failed: ${error.message || String(error)}`
    );
    return false;
  } finally {
    autoSelectRunning = false;
    setAutoSelectButtonRunning(false);
  }
}

// Function to create "Select" buttons on profile cards
function addSelectButtonsToProfiles() {
  if (!isCompanyPeoplePage()) return;
  
  console.log('Adding select buttons to profiles on company people page');
  
  // Update selector to be more specific and match the actual HTML structure
  const profileCards = getProfileCards();
  
  profileCards.forEach((card) => {
    // Check if we already added a select button to this card
    if (card.querySelector('.profile-select-button')) return;
    
    const candidate = extractProfileCandidate(card);
    if (!candidate) return;
    const profileUrl = candidate.url;
    const name = candidate.name;
    
    // Find the footer where the Connect button is
    const footer = card.querySelector('footer.ph3.pb3');
    if (!footer) return;
    
    // Create a Select button
    const selectButton = document.createElement('button');
    selectButton.className = 'artdeco-button artdeco-button--2 artdeco-button--tertiary profile-select-button';
    selectButton.style.marginTop = '8px';
    setProfileSelectButtonState(
      selectButton,
      selectedProfiles.some((profile) => profile.url === profileUrl)
    );
    
    // Add click handler
    selectButton.addEventListener('click', function() {
      const isSelected = selectedProfiles.some(profile => profile.url === profileUrl);
      
      if (isSelected) {
        // Deselect
        selectedProfiles = selectedProfiles.filter(profile => profile.url !== profileUrl);
        setProfileSelectButtonState(selectButton, false);
      } else {
        // Select with initial pending status
        selectedProfiles.push({ name, url: profileUrl, status: 'pending' });
        setProfileSelectButtonState(selectButton, true);
      }
      
      if (showFloatingPanel) {
        updateFloatingPanel();
      }
    });
    
    // Add the button to the footer
    footer.appendChild(selectButton);
  });
}

// Function to create and update the floating panel
function createFloatingPanel() {
  if (!showFloatingPanel) return; // Early return if floating panel is disabled
  
  // Check if panel already exists
  if (document.getElementById('selected-profiles-panel')) return;
  
  // Create the panel
  const panel = document.createElement('div');
  panel.id = 'selected-profiles-panel';
  panel.style.position = 'fixed';
  panel.style.bottom = '20px';
  panel.style.left = '20px';
  panel.style.width = '300px';
  panel.style.maxHeight = '400px';
  panel.style.backgroundColor = 'white';
  panel.style.boxShadow = '0 0 10px rgba(0, 0, 0, 0.3)';
  panel.style.borderRadius = '8px';
  panel.style.zIndex = '9999';
  panel.style.display = 'flex';
  panel.style.flexDirection = 'column';
  panel.style.overflow = 'hidden';
  
  // Create header
  const header = document.createElement('div');
  header.style.padding = '12px';
  header.style.borderBottom = '1px solid #e0e0e0';
  header.style.display = 'flex';
  header.style.justifyContent = 'space-between';
  header.style.alignItems = 'center';
  header.style.backgroundColor = '#0a66c2';
  header.style.color = 'white';
  header.style.fontWeight = 'bold';
  header.innerHTML = '<span>Selected Profiles (0)</span>';
  
  // Add minimize button to header
  const minimizeButton = document.createElement('button');
  minimizeButton.innerHTML = '−';
  minimizeButton.style.background = 'none';
  minimizeButton.style.border = 'none';
  minimizeButton.style.color = 'white';
  minimizeButton.style.fontSize = '20px';
  minimizeButton.style.cursor = 'pointer';
  minimizeButton.style.marginLeft = '10px';
  minimizeButton.onclick = function() {
    const content = document.getElementById('panel-content');
    const footer = document.getElementById('panel-footer');
    
    if (content.style.display === 'none') {
      content.style.display = 'block';
      footer.style.display = 'flex';
      minimizeButton.innerHTML = '−';
    } else {
      content.style.display = 'none';
      footer.style.display = 'none';
      minimizeButton.innerHTML = '+';
    }
  };
  header.appendChild(minimizeButton);
  
  // Create content area
  const content = document.createElement('div');
  content.id = 'panel-content';
  content.style.padding = '12px';
  content.style.maxHeight = '300px';
  content.style.overflowY = 'auto';

  const autoSelectStatus = document.createElement('div');
  autoSelectStatus.id = 'auto-select-status';
  autoSelectStatus.textContent = 'Ready to auto-select';
  autoSelectStatus.style.padding = '8px 12px';
  autoSelectStatus.style.fontSize = '12px';
  autoSelectStatus.style.color = '#666';
  autoSelectStatus.style.borderTop = '1px solid #e0e0e0';
  
  // Create footer
  const footer = document.createElement('div');
  footer.id = 'panel-footer';
  footer.style.padding = '12px';
  footer.style.borderTop = '1px solid #e0e0e0';
  footer.style.display = 'flex';
  footer.style.justifyContent = 'space-between';
  footer.style.flexWrap = 'wrap';
  footer.style.gap = '8px';

  const autoSelectButton = document.createElement('button');
  autoSelectButton.id = 'auto-select-profiles';
  autoSelectButton.className = 'artdeco-button artdeco-button--2 artdeco-button--secondary';
  autoSelectButton.innerHTML = '<span class="artdeco-button__text">Auto-select 10</span>';
  autoSelectButton.onclick = autoSelectProfiles;
  
  // Create Connect All button
  const connectAllButton = document.createElement('button');
  connectAllButton.className = 'artdeco-button artdeco-button--2 artdeco-button--primary';
  connectAllButton.innerHTML = '<span class="artdeco-button__text">Connect to All</span>';
  connectAllButton.onclick = function() {
    connectToAllSelected();
  };
  
  // Create Clear All button
  const clearAllButton = document.createElement('button');
  clearAllButton.className = 'artdeco-button artdeco-button--2 artdeco-button--tertiary';
  clearAllButton.innerHTML = '<span class="artdeco-button__text">Clear All</span>';
  clearAllButton.onclick = function() {
    selectedProfiles = [];
    updateFloatingPanel();
    
    // Update all select buttons to deselected state
    const selectButtons = document.querySelectorAll('.profile-select-button');
    selectButtons.forEach(button => {
      setProfileSelectButtonState(button, false);
    });
  };
  
  // Add buttons to footer
  footer.appendChild(autoSelectButton);
  footer.appendChild(clearAllButton);
  footer.appendChild(connectAllButton);
  
  // Assemble the panel
  panel.appendChild(header);
  panel.appendChild(content);
  panel.appendChild(autoSelectStatus);
  panel.appendChild(footer);
  
  // Add to the page
  document.body.appendChild(panel);
}

// Update the floating panel with selected profiles
function updateFloatingPanel() {
  if (!showFloatingPanel) return; // Early return if floating panel is disabled
  
  const panel = document.getElementById('selected-profiles-panel');
  if (!panel) return;
  
  // Update header count
  const header = panel.querySelector('div:first-child span');
  header.textContent = `Selected Profiles (${selectedProfiles.length})`;
  
  // Update content
  const content = document.getElementById('panel-content');
  content.innerHTML = '';
  
  if (selectedProfiles.length === 0) {
    content.innerHTML = '<p style="color: #666; text-align: center;">No profiles selected</p>';
    return;
  }
  
  // Create list of selected profiles
  selectedProfiles.forEach((profile, index) => {
    const profileItem = document.createElement('div');
    profileItem.style.display = 'flex';
    profileItem.style.justifyContent = 'space-between';
    profileItem.style.alignItems = 'center';
    profileItem.style.padding = '8px 0';
    profileItem.style.borderBottom = index < selectedProfiles.length - 1 ? '1px solid #e0e0e0' : 'none';
    
    // Profile name with link
    const nameLink = document.createElement('a');
    nameLink.href = profile.url;
    nameLink.target = '_blank';
    nameLink.textContent = profile.name;
    nameLink.style.color = '#0a66c2';
    nameLink.style.textDecoration = 'none';
    nameLink.style.fontWeight = 'bold';
    
    // Create status indicator
    const statusContainer = document.createElement('div');
    statusContainer.style.display = 'flex';
    statusContainer.style.alignItems = 'center';
    
    if (profile.status) {
      const statusBadge = document.createElement('span');
      statusBadge.style.padding = '2px 6px';
      statusBadge.style.borderRadius = '10px';
      statusBadge.style.fontSize = '11px';
      statusBadge.style.marginRight = '8px';
      
      // Set badge style based on status
      switch(profile.status) {
        case 'pending':
          statusBadge.textContent = 'Pending';
          statusBadge.style.backgroundColor = '#f0f0f0';
          statusBadge.style.color = '#666';
          break;
        case 'processing':
          statusBadge.textContent = 'Processing';
          statusBadge.style.backgroundColor = '#fff8e1';
          statusBadge.style.color = '#ff9800';
          break;
        case 'completed':
          statusBadge.textContent = 'Completed';
          statusBadge.style.backgroundColor = '#e8f5e9';
          statusBadge.style.color = '#4caf50';
          break;
        case 'failed':
          statusBadge.textContent = 'Failed';
          statusBadge.style.backgroundColor = '#ffebee';
          statusBadge.style.color = '#f44336';
          break;
        case 'timeout':
          statusBadge.textContent = 'Timeout';
          statusBadge.style.backgroundColor = '#ffebee';
          statusBadge.style.color = '#f44336';
          break;
      }
      
      statusContainer.appendChild(statusBadge);
    }
    
    // Remove button
    const removeButton = document.createElement('button');
    removeButton.innerHTML = '✕';
    removeButton.style.background = 'none';
    removeButton.style.border = 'none';
    removeButton.style.color = '#666';
    removeButton.style.cursor = 'pointer';
    removeButton.onclick = function() {
      selectedProfiles = selectedProfiles.filter(p => p.url !== profile.url);
      updateFloatingPanel();
      
      // Find and update the corresponding select button
      for (const card of getProfileCards()) {
        const candidate = extractProfileCandidate(card);
        if (candidate && candidate.url === profile.url) {
          syncProfileSelectButton(candidate, false);
          break;
        }
      }
    };
    
    statusContainer.appendChild(removeButton);
    profileItem.appendChild(nameLink);
    profileItem.appendChild(statusContainer);
    content.appendChild(profileItem);
  });
}

function broadcastInviteModalCommand(shouldSend, profileName) {
  const command = {
    source: INVITE_MESSAGE_SOURCE,
    action: 'handleInviteModal',
    shouldSend,
    profileName
  };
  let recipients = 0;
  const frames = Array.from(document.querySelectorAll('iframe'));

  for (const [frameIndex, frame] of frames.entries()) {
    const frameSource = frame.src || frame.getAttribute('src') || '';
    const hasContentWindow = Boolean(frame.contentWindow);
    let contentDocumentAccessible = false;

    try {
      contentDocumentAccessible = Boolean(frame.contentDocument);
    } catch (e) {
      // Cross-origin frames cannot expose their document to the parent.
    }

    try {
      const frameUrl = new URL(frameSource, window.location.href);
      const isLinkedInFrame = frameUrl.hostname === 'linkedin.com' ||
        frameUrl.hostname.endsWith('.linkedin.com');

      logDiagnostic('FRAME_DISCOVERY', {
        frameIndex,
        source: frameSource,
        origin: frameUrl.origin,
        isLinkedInFrame,
        hasContentWindow,
        contentDocumentAccessible
      });

      if (!isLinkedInFrame) {
        logDiagnostic('FRAME_MESSAGE_SKIPPED', {
          frameIndex,
          source: frameSource,
          reason: 'not-linkedin-frame'
        });
        continue;
      }

      if (!hasContentWindow) {
        logDiagnostic('FRAME_MESSAGE_SKIPPED', {
          frameIndex,
          source: frameSource,
          reason: 'missing-content-window'
        });
        continue;
      }

      frame.contentWindow.postMessage(command, frameUrl.origin);
      recipients += 1;
      logDiagnostic('FRAME_MESSAGE_SENT', {
        frameIndex,
        source: frameSource,
        origin: frameUrl.origin,
        action: command.action
      });
    } catch (e) {
      logDiagnostic('FRAME_MESSAGE_ERROR', {
        frameIndex,
        source: frameSource,
        errorName: e && e.name || 'Error',
        errorMessage: e && e.message || String(e)
      });
    }
  }

  logDiagnostic('INVITE_DELEGATED', {
    frameCount: frames.length,
    recipients
  });

  return recipients;
}

// Listen for messages from other tabs
window.addEventListener('message', function(event) {
  const isInviteModalMessage = event.data &&
    event.data.source === INVITE_MESSAGE_SOURCE &&
    event.data.action === 'handleInviteModal';

  if (isInviteModalMessage) {
    logDiagnostic('FRAME_MESSAGE_RECEIVED', {
      origin: event.origin || '',
      sourceIsParent: event.source === window.parent,
      action: event.data.action
    });
  }

  if (window !== window.top &&
      event.source === window.parent &&
      isInviteModalMessage) {
    console.log('%c HANDLING INVITE MODAL IN CHILD FRAME', 'background: #8e44ad; color: #ffffff; font-size: 12px; font-weight: bold;');
    handleAddNote(
      event.data.shouldSend,
      ADD_NOTE_INITIAL_RETRIES,
      event.data.profileName
    );
    return;
  }
  
});

chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
  if (window !== window.top ||
      !message ||
      message.source !== INVITE_MESSAGE_SOURCE) {
    return false;
  }

  if (message.action === 'autoConnect') {
    activeBatchAutomationRequestId = message.requestId;
    activeBatchAutomationSourceTabId = message.sourceTabId;
    console.log('%c EXECUTING AUTO-CONNECT FROM BACKGROUND', 'background: #8e44ad; color: #ffffff; font-size: 14px; font-weight: bold;');
    sendResponse({ accepted: true });
    setTimeout(() => {
      automateLinkedInConnect(message.shouldSend);
    }, 2000);
    return false;
  }

  if (message.action === 'batchProfileResult') {
    finishActiveBatchProfile(message.requestId, message.status, message.reason || '');
  }

  return false;
});

// Connect to all selected profiles
function connectToAllSelected() {
  if (selectedProfiles.length === 0) {
    console.log('%c NO PROFILES SELECTED TO CONNECT TO', 'background: #e74c3c; color: #ffffff; font-size: 14px; font-weight: bold;');
    alert('Please select at least one profile to connect to.');
    return;
  }
  
  console.log(`%c STARTING TO CONNECT TO ${selectedProfiles.length} SELECTED PROFILES`, 'background: #2ecc71; color: #ffffff; font-size: 14px; font-weight: bold;');
  
  // Set all profiles to pending status
  selectedProfiles.forEach(profile => {
    profile.status = 'pending';
  });
  
  if (showFloatingPanel) {
    updateFloatingPanel();
  }
  
  // Process the first profile
  processNextProfile(0);
}

function finishActiveBatchProfile(requestId, status, reason = '') {
  if (!activeBatchProfileRequest ||
      activeBatchProfileRequest.requestId !== requestId) {
    return false;
  }

  const request = activeBatchProfileRequest;
  activeBatchProfileRequest = null;
  clearTimeout(request.timeoutId);
  request.profile.status = ['completed', 'failed', 'timeout'].includes(status)
    ? status
    : 'failed';
  updateFloatingPanel();

  if (reason) {
    console.log('Batch profile result:', reason);
  }
  setTimeout(() => processNextProfile(request.index + 1), 1000);
  return true;
}

// Process profiles sequentially through the extension background worker.
function processNextProfile(index) {
  if (index >= selectedProfiles.length) {
    console.log('%c FINISHED CONNECTING TO ALL PROFILES', 'background: #4CAF50; color: #ffffff; font-size: 14px; font-weight: bold;');
    return;
  }
  
  const profile = selectedProfiles[index];
  console.log(`%c PROCESSING PROFILE ${index + 1}/${selectedProfiles.length}: ${profile.name}`, 'background: #3498db; color: #ffffff; font-size: 12px; font-weight: bold;');
  
  // Update status to processing
  profile.status = 'processing';
  updateFloatingPanel();
  
  const requestId = `batch-${Date.now()}-${nextBatchRequestId}`;
  nextBatchRequestId += 1;
  activeBatchProfileRequest = {
    index,
    profile,
    requestId,
    timeoutId: null
  };
  activeBatchProfileRequest.timeoutId = setTimeout(() => {
    console.log('%c CONNECTION TIMEOUT FOR: ' + profile.name, 'background: #e74c3c; color: #ffffff; font-size: 14px; font-weight: bold;');
    finishActiveBatchProfile(requestId, 'timeout');
  }, BATCH_PROFILE_TIMEOUT_MS);

  chrome.runtime.sendMessage({
    source: INVITE_MESSAGE_SOURCE,
    action: 'openBatchProfile',
    requestId,
    profileUrl: profile.url,
    shouldSend: true
  }, (response) => {
    if (!activeBatchProfileRequest ||
        activeBatchProfileRequest.requestId !== requestId) {
      return;
    }

    if (chrome.runtime.lastError || !response || !response.accepted) {
      const reason = chrome.runtime.lastError
        ? chrome.runtime.lastError.message
        : response && response.error || 'Background worker rejected the profile';
      console.log('%c FAILED TO START PROFILE AUTOMATION: ' + reason, 'background: #e74c3c; color: #ffffff; font-size: 12px;');
      finishActiveBatchProfile(requestId, 'failed', reason);
    }
  });
}

// Function to automate LinkedIn connection
function automateLinkedInConnect(shouldSend = true) {
  console.log('%c AUTOMATION STARTED', 'background: #f39c12; color: #ffffff; font-size: 14px; font-weight: bold;');
  
  // Find profile name first
  const name = findProfileName();
  if (!name) {
    console.log('%c NO PROFILE NAME FOUND', 'background: #FFC107; color: #000000; font-size: 16px; font-weight: bold;');
    notifyBatchController('failed', 'profile-name-not-found');
    return;
  }
  
  console.log('%c PROFILE NAME: ' + name, 'background: #4CAF50; color: #ffffff; font-size: 16px; font-weight: bold;');
  
  // Step 1: Find and click the Connect button in main profile
  findAndClickConnect(shouldSend, name);
}

// Check if on company people page and initialize UI
function initializeCompanyPeoplePageFeatures() {
  if (isCompanyPeoplePage()) {
    console.log('Detected company people page, initializing features');
    if (showFloatingPanel) {
      createFloatingPanel();
    }
    addSelectButtonsToProfiles();
  }
}

// Call initialization on page load
window.addEventListener('load', function() {
  initializeCompanyPeoplePageFeatures();
});

// Also check when page content changes
const observer = new MutationObserver(function(mutations) {
  // Check if any profiles were added
  const shouldAddButtons = mutations.some(mutation => {
    return Array.from(mutation.addedNodes).some(node => {
      if (node.nodeType === 1) { // Element node
        return node.querySelector('li.org-people-profile-card__profile-card-spacing') ||
               node.classList.contains('org-people-profile-card__profile-card-spacing');
      }
      return false;
    });
  });
  
  if (shouldAddButtons) {
    addSelectButtonsToProfiles();
  }

  observeLinkedInShadowRoots(observer);

  if (activeAddNoteRequest) {
    const addNoteButton = findAddNoteButton();
    if (addNoteButton) {
      logDiagnostic('ADD_NOTE_MUTATION_MATCH', {
        requestId: activeAddNoteRequest.id
      });
      completeAddNoteRequest(addNoteButton, activeAddNoteRequest.id);
    }
  }
});

// Start observing the document
observer.observe(document.body, { childList: true, subtree: true });
observeLinkedInShadowRoots(observer);

// Function to find profile name using multiple methods
function findProfileName() {
  console.log("Searching for profile name...");
  
  // Method 1: Try specific LinkedIn selectors (most common)
  const selectors = [
    '.text-heading-xlarge', 
    'h1.inline.t-24',
    'h1.text-heading-xlarge',
    '.pv-text-details__left-panel h1'
  ];
  
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element) {
      console.log("Found name with selector:", selector);
      return element.textContent.trim();
    }
  }
  
  // Method 2: Get from page title (fallback)
  const title = document.title;
  const titleMatch = title.match(/^(?:\([0-9]+\)\s*)?([^|]+)\s*\|/);
  if (titleMatch && titleMatch[1]) {
    console.log("Found name from page title");
    return titleMatch[1].trim();
  }
  
  // Method 3: New LinkedIn profile header uses an h2 inside the profile link.
  const currentProfileMatch = window.location.href.match(/\/in\/([^/?#]+)/);
  const currentProfileSlug = currentProfileMatch ? currentProfileMatch[1] : null;
  const profileLinks = document.querySelectorAll('a[href*="/in/"]');
  for (const link of profileLinks) {
    const href = link.href || link.getAttribute('href') || '';
    if (currentProfileSlug && !href.includes(`/in/${currentProfileSlug}`)) {
      continue;
    }

    const heading = link.querySelector('h1, h2') || link.querySelector('h1') || link.querySelector('h2');
    const text = heading ? heading.textContent.trim() : '';
    if (text && text.split(' ').length <= 5) {
      console.log("Found name from profile link heading");
      return text;
    }
  }

  // Method 4: Get any h1 or h2 with short text (last resort)
  const headingElements = document.querySelectorAll('h1, h2');
  for (const heading of headingElements) {
    const text = heading.textContent.trim();
    if (text && text.split(' ').length <= 5) { // Likely a name
      console.log("Found name from heading element");
      return text;
    }
  }
  
  // Method 5: Debug - print all h1/h2 contents to console
  console.log("DEBUG - All h1/h2 elements on page:");
  document.querySelectorAll('h1, h2').forEach((el, i) => {
    console.log(`heading #${i}:`, el.textContent.trim());
  });
  
  // Nothing found
  return null;
}

// Helper function to find the main profile Connect button
function findConnectButton() {
  console.log("Finding connect button in main profile section...");
  
  // Look for the main profile container first
  const mainProfileContainers = [
    '.ph5.pb5',
    '.pv-top-card',
    '.core-rail'
  ];
  
  let mainProfile = null;
  for (const selector of mainProfileContainers) {
    const container = document.querySelector(selector);
    if (container) {
      mainProfile = container;
      console.log("Found main profile container:", selector);
      break;
    }
  }
  
  if (!mainProfile) {
    console.log("Main profile container not found - falling back to document search");
    mainProfile = document;
  }
  
  // Method 1: Look specifically for the primary connect button in the main profile
  // Primary buttons are usually the main action buttons, while secondary/muted are for sidebars
  const connectButton = mainProfile.querySelector('button.artdeco-button--primary');
  if (connectButton && 
      (connectButton.textContent.includes('Connect') || 
       connectButton.querySelector('.artdeco-button__text')?.textContent.includes('Connect'))) {
    console.log("Found primary Connect button in main profile");
    return connectButton;
  }
  
  // Method 2: Look for buttons with connect in aria-label in the main profile
  // Also check that it's not inside a list item (which would likely be a sidebar recommendation)
  const buttons = mainProfile.querySelectorAll('button[aria-label*="connect" i], button[aria-label*="invite" i]');
  for (const button of buttons) {
    // Skip buttons that are in list items (likely sidebar "People also viewed" sections)
    if (button.closest('li.xZBbbHTmMdEiOVSJfbHsnkxeORHQLUI') || 
        button.closest('li.pv-browsemap-section__member-container')) {
      console.log("Skipping Connect button in sidebar recommendation");
      continue;
    }
    
    // Skip buttons with muted/secondary classes as they're likely sidebar buttons
    if (button.classList.contains('artdeco-button--muted')) {
      console.log("Skipping muted Connect button (likely sidebar)");
      continue;
    }
    
    console.log("Found connect button by aria-label in main profile");
    return button;
  }

  // Method 3: New LinkedIn layouts render the primary Connect action as a styled link.
  const connectLinks = mainProfile.querySelectorAll('a[aria-label*="connect" i], a[aria-label*="invite" i], a[href*="/preload/custom-invite/"]');
  for (const link of connectLinks) {
    const label = link.getAttribute('aria-label') || '';
    const href = link.href || link.getAttribute('href') || '';
    const text = link.textContent.trim();

    if (!isCurrentProfileInviteHref(href)) {
      console.log("Skipping Connect link for another profile");
      continue;
    }

    if ((label.includes('connect') || label.includes('Invite') || href.includes('/preload/custom-invite/') || text.includes('Connect')) &&
        !label.includes('Remove') &&
        !label.includes('Cancel') &&
        !link.closest('li.xZBbbHTmMdEiOVSJfbHsnkxeORHQLUI') &&
        !link.closest('li.pv-browsemap-section__member-container')) {
      console.log("Found connect link in main profile");
      return link;
    }
  }
  
  // Method 4: Look for buttons with SVG connect-small icon in main profile
  const allButtons = mainProfile.querySelectorAll('button');
  for (const button of allButtons) {
    const hasConnectIcon = button.querySelector('use[href="#connect-small"]');
    // Skip buttons in list items or with muted class
    if (button.closest('li.xZBbbHTmMdEiOVSJfbHsnkxeORHQLUI') || 
        button.closest('li.pv-browsemap-section__member-container') ||
        button.classList.contains('artdeco-button--muted')) {
      continue;
    }
    
    if (hasConnectIcon && button.textContent.trim().includes('Connect')) {
      console.log("Found connect button by icon in main profile");
      return button;
    }
  }
  
  console.log("No connect button found in main profile section");
  return null;
}

function startInviteModalFlow(shouldSend, profileName) {
  handleAddNote(shouldSend, ADD_NOTE_INITIAL_RETRIES, profileName);
}

// Function to find and click Connect in main profile
function findAndClickConnect(shouldSend = true, profileName = null) {
  console.log("Looking for Connect button in main profile...");
  
  // Find direct Connect button in main profile
  const connectButton = findConnectButton();
  
  if (connectButton) {
    console.log("Found Connect button in main profile, clicking...");
    // Try both click methods for better reliability
    connectButton.click();
    
    try {
      // Also dispatch a MouseEvent for more reliable clicking
      connectButton.dispatchEvent(new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        view: window
      }));
    } catch (e) {
      console.log("MouseEvent dispatch failed, but continuing...");
    }
    
    console.log("Connect button clicked");
    
    // Wait for the modal and continue with Add note
    setTimeout(() => startInviteModalFlow(shouldSend, profileName), 1000);
    return;
  }
  
  console.log("No direct Connect button found, looking for More button...");
  
  // Try to find the More button if direct Connect not found
  const moreButton = findMoreButton();
  if (moreButton) {
    console.log("Found More button, clicking...");
    moreButton.click();
    
    // Wait for dropdown to appear, then find Connect option
    setTimeout(function() {
      const connectOption = findConnectInDropdown();
      if (connectOption) {
        console.log("Found Connect option in dropdown, clicking...");
        connectOption.click();
        
        // Wait for the modal and continue with Add note
        setTimeout(() => startInviteModalFlow(shouldSend, profileName), 1000);
      } else {
        console.log("Connect option not found in dropdown");
        notifyBatchController('failed', 'connect-option-not-found');
      }
    }, 1000);
  } else {
    console.log("More button not found");
    notifyBatchController('failed', 'connect-control-not-found');
  }
}

// Helper function to find the More button
function findMoreButton() {
  // Look for More button by various attributes
  const moreSelectors = [
    'button[aria-label="More actions"]',
    'button.artdeco-dropdown__trigger'
  ];
  
  for (const selector of moreSelectors) {
    const buttons = document.querySelectorAll(selector);
    for (const button of buttons) {
      // Check if it's the More button (contain text "More" and not in a sidebar)
      if (button.textContent.trim().includes('More') &&
          !button.closest('li.xZBbbHTmMdEiOVSJfbHsnkxeORHQLUI') &&
          !button.closest('li.pv-browsemap-section__member-container')) {
        return button;
      }
    }
  }
  
  // Fallback: look for any button with "More" text in the main profile
  const mainProfile = document.querySelector('.ph5.pb5, .pv-top-card, .core-rail');
  if (mainProfile) {
    const buttons = mainProfile.querySelectorAll('button');
    for (const button of buttons) {
      if (button.textContent.trim() === 'More') {
        return button;
      }
    }
  }
  
  return null;
}

// Helper function to find Connect option in dropdown
function findConnectInDropdown() {
  // Look for dropdown items that mention "Connect"
  const dropdownItems = document.querySelectorAll('.artdeco-dropdown__item, [role="button"], .artdeco-dropdown__content li > div');
  
  for (const item of dropdownItems) {
    const text = item.textContent.trim();
    if ((text.includes('Connect') || text.includes('connect') || text.includes('Invite')) && 
        !text.includes('Remove') && !text.includes('Cancel')) {
      return item;
    }
  }
  
  // Debug: log all dropdown items to console
  console.log("All dropdown items found:");
  document.querySelectorAll('.artdeco-dropdown__item, [role="button"], .artdeco-dropdown__content li > div')
    .forEach((item, i) => {
      console.log(`Item ${i}:`, item.textContent.trim());
    });
  
  return null;
}

// Function to handle the Add Note flow
function completeAddNoteRequest(addNoteButton, requestId) {
  if (!activeAddNoteRequest || activeAddNoteRequest.id !== requestId) {
    return;
  }

  const request = activeAddNoteRequest;
  activeAddNoteRequest = null;
  logDiagnostic('ADD_NOTE_CLICK', {
    requestId,
    button: summarizeElement(addNoteButton)
  });
  addNoteButton.click();

  setTimeout(() => {
    fillCustomMessage(request.shouldSend, request.profileName);
  }, 500);
}

function handleAddNote(
  shouldSend = true,
  retriesRemaining = ADD_NOTE_INITIAL_RETRIES,
  profileName = null,
  requestId = null
) {
  if (requestId === null) {
    const replacedRequestId = activeAddNoteRequest && activeAddNoteRequest.id;
    requestId = nextAddNoteRequestId;
    nextAddNoteRequestId += 1;
    activeAddNoteRequest = {
      id: requestId,
      shouldSend,
      profileName
    };
    logDiagnostic('ADD_NOTE_REQUEST_STARTED', {
      requestId,
      replacedRequestId: replacedRequestId || null
    });
  }

  if (!activeAddNoteRequest || activeAddNoteRequest.id !== requestId) {
    return;
  }

  logAddNoteScan(retriesRemaining);
  const addNoteButton = findAddNoteButton();
  if (!addNoteButton) {
    if (window === window.top && retriesRemaining === ADD_NOTE_INITIAL_RETRIES) {
      const delegatedFrames = broadcastInviteModalCommand(shouldSend, profileName);
      if (delegatedFrames > 0) {
        console.log('Invite modal handling also delegated to child frame');
      }
    }

    if (retriesRemaining > 0) {
      logDiagnostic('ADD_NOTE_WAIT', {
        requestId,
        attempt: getAddNoteAttempt(retriesRemaining),
        retriesRemaining
      });
      setTimeout(() => handleAddNote(
        shouldSend,
        retriesRemaining - 1,
        profileName,
        requestId
      ), 250);
      return;
    }

    activeAddNoteRequest = null;
    console.log('%c ADD NOTE BUTTON NOT FOUND', 'background: #FFC107; color: #000000; font-size: 16px; font-weight: bold;');
    notifyBatchController('failed', 'add-note-button-not-found');
    return;
  }

  completeAddNoteRequest(addNoteButton, requestId);
}

// Function to fill the custom message - update to notify parent window
function fillCustomMessage(shouldSend = true, profileName = null) {
  // Different selectors for the textarea
  const textareaSelectors = [
    'textarea#custom-message',
    '.artdeco-modal textarea',
    'textarea[name="message"]',
    'textarea.ember-text-area'
  ];
  
  let textarea = null;
  for (const searchDocument of getAccessibleRoots()) {
    for (const selector of textareaSelectors) {
      textarea = searchDocument.querySelector(selector);
      if (textarea) break;
    }
    if (textarea) break;
  }
  
  if (!textarea) {
    console.log('%c TEXTAREA NOT FOUND', 'background: #FFC107; color: #000000; font-size: 16px; font-weight: bold;');
    notifyBatchController('failed', 'textarea-not-found');
    return;
  }
  
  // Check if settings need to be initialized
  if (!userSettings.hasInitializedSettings) {
    showSettingsDialog();
    notifyBatchController('failed', 'settings-not-initialized');
    return;
  }
  
  // Use settings from chrome.storage
  const name = profileName || findProfileName();
  const firstName = getFirstName(name);
  
  // Use saved message template or default if somehow missing
  let message = userSettings.messageTemplate || DEFAULT_SETTINGS.messageTemplate;
  
  // Replace all placeholders
  const replacements = {
    '{{firstName}}': firstName,
    '{{myName}}': userSettings.myName || DEFAULT_SETTINGS.myName,
    '{{myRole}}': userSettings.myRole || DEFAULT_SETTINGS.myRole,
    '{{myCompany}}': userSettings.myCompany || DEFAULT_SETTINGS.myCompany,
    '{{targetRole}}': userSettings.targetRole || DEFAULT_SETTINGS.targetRole
  };

  // Replace all placeholders in one go
  message = message.replace(/{{[^}]+}}/g, match => replacements[match] || match);
  
  // Fill in the textarea
  textarea.value = message;
  
  // Trigger input event to ensure LinkedIn recognizes the change
  const inputEvent = new Event('input', { bubbles: true });
  textarea.dispatchEvent(inputEvent);
  
  if (shouldSend) {
    // Add delay before clicking Send button to ensure message is filled
    setTimeout(() => {
      // Find the Send button using multiple selectors
      const sendButtonSelectors = [
        'button[aria-label="Send invitation"]',
        '.artdeco-button--primary',
        'button.artdeco-button--primary'
      ];

      let sendButton = null;
      for (const searchDocument of getAccessibleRoots()) {
        for (const selector of sendButtonSelectors) {
          const buttons = searchDocument.querySelectorAll(selector);
          for (const button of buttons) {
            if (button.textContent.trim() === 'Send') {
              sendButton = button;
              break;
            }
          }
          if (sendButton) break;
        }
        if (sendButton) break;
      }

      if (sendButton) {
        console.log('Clicking Send button...');
        sendButton.click();
        console.log('%c CONNECTION REQUEST SENT!', 'background: #4CAF50; color: #ffffff; font-size: 16px; font-weight: bold;');
        
        notifyBatchController('completed');
        
        // Wait a brief moment to ensure the send action is completed, then close the tab
        setTimeout(() => {
          console.log('Closing tab...');
          window.close();
        }, 1000); // Wait 1 second before closing
      } else {
        console.log('%c SEND BUTTON NOT FOUND', 'background: #FFC107; color: #000000; font-size: 16px; font-weight: bold;');
        
        notifyBatchController('failed', 'send-button-not-found');
      }
    }, 500);
  } else {
    console.log('%c MESSAGE FILLED (NOT SENDING)', 'background: #4CAF50; color: #ffffff; font-size: 16px; font-weight: bold;');
  }
}

function getAccessibleDocuments(rootDocument = document) {
  const documents = [rootDocument];
  const visited = new Set(documents);

  for (const currentDocument of documents) {
    let frames = [];
    try {
      frames = currentDocument.querySelectorAll('iframe');
    } catch (e) {
      continue;
    }

    for (const frame of frames) {
      try {
        const frameDocument = frame.contentDocument;
        if (frameDocument && !visited.has(frameDocument)) {
          visited.add(frameDocument);
          documents.push(frameDocument);
        }
      } catch (e) {
        // Cross-origin frames cannot be inspected.
      }
    }
  }

  return documents;
}

function getAccessibleRoots(rootDocument = document) {
  const roots = getAccessibleDocuments(rootDocument);
  const visited = new Set(roots);

  for (const currentRoot of roots) {
    let shadowHosts = [];
    try {
      shadowHosts = currentRoot.querySelectorAll(
        '#interop-outlet, [data-testid="interop-shadowdom"]'
      );
    } catch (e) {
      continue;
    }

    for (const host of shadowHosts) {
      if (host.shadowRoot && !visited.has(host.shadowRoot)) {
        visited.add(host.shadowRoot);
        roots.push(host.shadowRoot);
      }
    }
  }

  return roots;
}

const observedLinkedInShadowRoots = new WeakSet();

function observeLinkedInShadowRoots(mutationObserver) {
  for (const root of getAccessibleRoots()) {
    if (!root.host || observedLinkedInShadowRoots.has(root)) {
      continue;
    }

    observedLinkedInShadowRoots.add(root);
    mutationObserver.observe(root, { childList: true, subtree: true });
    logDiagnostic('SHADOW_ROOT_OBSERVED', {
      hostId: root.host.id || '',
      hostTestId: root.host.getAttribute('data-testid') || ''
    });
  }
}

// Helper function to find Add a note button
function findAddNoteButton() {
  // Different ways LinkedIn might implement the Add a note button
  const addNoteSelectors = [
    'button.artdeco-modal__confirm-dialog-btn',
    'button.artdeco-button--secondary',
    'button:has(span:contains("Add a note"))',
    'button[aria-label="Add a note"]'
  ];
  
  const searchDocuments = getAccessibleRoots();
  for (const [documentIndex, searchDocument] of searchDocuments.entries()) {
    for (const selector of addNoteSelectors) {
      try {
        const buttons = searchDocument.querySelectorAll(selector);
        for (const button of buttons) {
          if (button.textContent.includes('Add a note')) {
            logDiagnostic('ADD_NOTE_FOUND', {
              documentIndex,
              selector,
              button: summarizeElement(button)
            });
            return button;
          }
        }
      } catch (e) {
        // Skip invalid selectors
      }
    }
  }

  // Fallback: find by text content
  for (const [documentIndex, searchDocument] of searchDocuments.entries()) {
    const allButtons = searchDocument.querySelectorAll('button');
    for (const button of allButtons) {
      if (button.textContent.trim() === 'Add a note') {
        logDiagnostic('ADD_NOTE_FOUND', {
          documentIndex,
          selector: 'button (text fallback)',
          button: summarizeElement(button)
        });
        return button;
      }
    }
  }

  return null;
}

// Helper function to get first name
function getFirstName(fullName) {
  return fullName.split(' ')[0];
}

// Log when the script is loaded
console.log('LinkedIn Connect Automation extension activated - press Alt/Option+W to connect and send, Alt/Option+Q to fill only');

// Function to show settings dialog
function showSettingsDialog() {
  // Load current settings
  const currentSettings = {
    myName: userSettings.myName || DEFAULT_SETTINGS.myName,
    myRole: userSettings.myRole || DEFAULT_SETTINGS.myRole,
    myCompany: userSettings.myCompany || DEFAULT_SETTINGS.myCompany,
    targetRole: userSettings.targetRole || DEFAULT_SETTINGS.targetRole,
    messageTemplate: userSettings.messageTemplate || DEFAULT_SETTINGS.messageTemplate
  };

  // Create the modal container
  const modal = document.createElement('div');
  modal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 10000;
  `;

  // Create the modal content
  const content = document.createElement('div');
  content.style.cssText = `
    background: white;
    padding: 20px;
    border-radius: 8px;
    width: 600px;
    max-width: 90%;
    max-height: 90vh;
    overflow-y: auto;
  `;

  // Create the header
  const header = document.createElement('div');
  header.style.cssText = `
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 20px;
  `;
  header.innerHTML = `
    <h2 style="margin: 0; color: #0a66c2;">LinkedIn Automation Settings</h2>
    <button class="close-button" style="
      border: none;
      background: none;
      font-size: 20px;
      cursor: pointer;
      padding: 5px;
    ">×</button>
  `;

  // Create the form with current values
  const form = document.createElement('div');
  form.innerHTML = `
    <div style="margin-bottom: 20px;">
      <h3 style="margin-bottom: 10px;">Your Information</h3>
      <div style="margin-bottom: 10px;">
        <label style="display: block; margin-bottom: 5px;">Your Name:</label>
        <input type="text" id="myName" value="${currentSettings.myName}" style="
          width: 100%;
          padding: 8px;
          border: 1px solid #ccc;
          border-radius: 4px;
        ">
      </div>
      <div style="margin-bottom: 10px;">
        <label style="display: block; margin-bottom: 5px;">Your Role:</label>
        <input type="text" id="myRole" value="${currentSettings.myRole}" style="
          width: 100%;
          padding: 8px;
          border: 1px solid #ccc;
          border-radius: 4px;
        ">
      </div>
      <div style="margin-bottom: 10px;">
        <label style="display: block; margin-bottom: 5px;">Your Company:</label>
        <input type="text" id="myCompany" value="${currentSettings.myCompany}" style="
          width: 100%;
          padding: 8px;
          border: 1px solid #ccc;
          border-radius: 4px;
        ">
      </div>
      <div style="margin-bottom: 20px;">
        <label style="display: block; margin-bottom: 5px;">Target Role:</label>
        <input type="text" id="targetRole" value="${currentSettings.targetRole}" style="
          width: 100%;
          padding: 8px;
          border: 1px solid #ccc;
          border-radius: 4px;
        ">
      </div>
    </div>
    <div style="margin-bottom: 20px;">
      <h3 style="margin-bottom: 10px;">Message Template</h3>
      <p style="margin-bottom: 10px; color: #666;">
        Available placeholders:
        <code>{{firstName}}</code> - Connection's first name
        <code>{{myName}}</code> - Your name
        <code>{{myRole}}</code> - Your role
        <code>{{myCompany}}</code> - Your company
        <code>{{targetRole}}</code> - Target role
      </p>
      <textarea id="messageTemplate" style="
        width: 100%;
        height: 200px;
        padding: 8px;
        border: 1px solid #ccc;
        border-radius: 4px;
        font-family: monospace;
        resize: vertical;
      ">${currentSettings.messageTemplate}</textarea>
    </div>
    <div style="margin-bottom: 20px;">
      <h3 style="margin-bottom: 10px;">Preview</h3>
      <div id="messagePreview" style="
        padding: 10px;
        border: 1px solid #eee;
        border-radius: 4px;
        background: #f9f9f9;
        white-space: pre-wrap;
      "></div>
    </div>
    <div style="text-align: right;">
      <button id="saveSettings" class="artdeco-button artdeco-button--2 artdeco-button--primary">Save Settings</button>
    </div>
  `;

  // Append everything to the modal
  content.appendChild(header);
  content.appendChild(form);
  modal.appendChild(content);
  document.body.appendChild(modal);

  // Add event listeners
  const closeButton = modal.querySelector('.close-button');
  closeButton.onclick = () => modal.remove();

  const saveButton = modal.querySelector('#saveSettings');
  saveButton.onclick = () => {
    const newSettings = {
      messageTemplate: modal.querySelector('#messageTemplate').value,
      myName: modal.querySelector('#myName').value,
      myRole: modal.querySelector('#myRole').value,
      myCompany: modal.querySelector('#myCompany').value,
      targetRole: modal.querySelector('#targetRole').value,
      hasInitializedSettings: true
    };
    
    // Update userSettings instead of reassigning
    Object.assign(userSettings, newSettings);
    
    // Save to chrome.storage
    chrome.storage.sync.set(newSettings);
    
    modal.remove();
  };

  // Add live preview
  const messageTemplate = modal.querySelector('#messageTemplate');
  const messagePreview = modal.querySelector('#messagePreview');
  const updatePreview = () => {
    let preview = messageTemplate.value;
    preview = preview.replace('{{firstName}}', 'John');
    preview = preview.replace('{{myName}}', modal.querySelector('#myName').value);
    preview = preview.replace('{{myRole}}', modal.querySelector('#myRole').value);
    preview = preview.replace('{{myCompany}}', modal.querySelector('#myCompany').value);
    preview = preview.replace('{{targetRole}}', modal.querySelector('#targetRole').value);
    messagePreview.textContent = preview;
  };
  
  messageTemplate.oninput = updatePreview;
  modal.querySelectorAll('input').forEach(input => {
    input.oninput = updatePreview;
  });
  updatePreview();
}
