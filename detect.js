// Track modifier key states
let altKeyPressed = false;
let optionKeyPressed = false;

// Store selected profiles
let selectedProfiles = [];

// Add a status property to track connection progress
// Possible status values: 'pending', 'processing', 'completed', 'failed'

// Add this at the top of the file with other state variables
let showFloatingPanel = true; // Set this to true to enable floating panel

// Default settings and initialization
const DEFAULT_SETTINGS = {
  myName: 'Sunny',
  myRole: 'Data Analyst Engineer',
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

// Listen for keydown events
document.addEventListener('keydown', function(event) {
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

// Function to create "Select" buttons on profile cards
function addSelectButtonsToProfiles() {
  if (!isCompanyPeoplePage()) return;
  
  console.log('Adding select buttons to profiles on company people page');
  
  // Update selector to be more specific and match the actual HTML structure
  const profileCards = document.querySelectorAll('li.org-people-profile-card__profile-card-spacing');
  
  profileCards.forEach((card, index) => {
    // Check if we already added a select button to this card
    if (card.querySelector('.profile-select-button')) return;
    
    // Update selector to match the actual link structure
    const profileLink = card.querySelector('a[data-test-app-aware-link]');
    if (!profileLink) return;
    
    const profileUrl = profileLink.href;
    // Update selector to match the actual name element
    const nameElement = card.querySelector('.artdeco-entity-lockup__title');
    const name = nameElement ? nameElement.textContent.trim() : `Profile ${index}`;
    
    // Find the footer where the Connect button is
    const footer = card.querySelector('footer.ph3.pb3');
    if (!footer) return;
    
    // Create a Select button
    const selectButton = document.createElement('button');
    selectButton.className = 'artdeco-button artdeco-button--2 artdeco-button--tertiary profile-select-button';
    selectButton.style.marginTop = '8px';
    selectButton.innerHTML = `<span class="artdeco-button__text">Select</span>`;
    
    // Add click handler
    selectButton.addEventListener('click', function() {
      const isSelected = selectedProfiles.some(profile => profile.url === profileUrl);
      
      if (isSelected) {
        // Deselect
        selectedProfiles = selectedProfiles.filter(profile => profile.url !== profileUrl);
        selectButton.innerHTML = `<span class="artdeco-button__text">Select</span>`;
        selectButton.classList.remove('artdeco-button--primary');
        selectButton.classList.add('artdeco-button--tertiary');
      } else {
        // Select with initial pending status
        selectedProfiles.push({ name, url: profileUrl, status: 'pending' });
        selectButton.innerHTML = `<span class="artdeco-button__text">Selected ✓</span>`;
        selectButton.classList.remove('artdeco-button--tertiary');
        selectButton.classList.add('artdeco-button--primary');
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
  
  // Create footer
  const footer = document.createElement('div');
  footer.id = 'panel-footer';
  footer.style.padding = '12px';
  footer.style.borderTop = '1px solid #e0e0e0';
  footer.style.display = 'flex';
  footer.style.justifyContent = 'space-between';
  
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
      button.innerHTML = `<span class="artdeco-button__text">Select</span>`;
      button.classList.remove('artdeco-button--primary');
      button.classList.add('artdeco-button--tertiary');
    });
  };
  
  // Add buttons to footer
  footer.appendChild(clearAllButton);
  footer.appendChild(connectAllButton);
  
  // Assemble the panel
  panel.appendChild(header);
  panel.appendChild(content);
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
      const profileCards = document.querySelectorAll('li.org-people-profile-card__profile-card-spacing');
      for (const card of profileCards) {
        const link = card.querySelector('a[data-test-app-aware-link]');
        if (link && link.href === profile.url) {
          const selectButton = card.querySelector('.profile-select-button');
          if (selectButton) {
            selectButton.innerHTML = `<span class="artdeco-button__text">Select</span>`;
            selectButton.classList.remove('artdeco-button--primary');
            selectButton.classList.add('artdeco-button--tertiary');
          }
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

// Listen for messages from other tabs
window.addEventListener('message', function(event) {
  console.log('%c RECEIVED MESSAGE FROM PARENT TAB', 'background: #8e44ad; color: #ffffff; font-size: 12px; font-weight: bold;', event.data);
  
  if (event.data && event.data.action === 'autoConnect') {
    console.log('%c EXECUTING AUTO-CONNECT FROM MESSAGE', 'background: #8e44ad; color: #ffffff; font-size: 14px; font-weight: bold;');
    // Add a slight delay to ensure the page is fully loaded
    setTimeout(() => {
      automateLinkedInConnect(event.data.shouldSend);
    }, 2000);
  }
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

// Process profiles sequentially
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
  
  // Open the profile in a new tab
  const profileTab = window.open(profile.url, '_blank');
  
  if (!profileTab) {
    console.log('%c FAILED TO OPEN NEW TAB - POPUP BLOCKER?', 'background: #e74c3c; color: #ffffff; font-size: 14px; font-weight: bold;');
    alert('Failed to open profile in new tab. Please check your popup blocker settings.');
    profile.status = 'failed';
    updateFloatingPanel();
    // Try next profile
    setTimeout(() => processNextProfile(index + 1), 1000);
    return;
  }
  
  console.log('%c NEW TAB OPENED, WAITING FOR PAGE LOAD', 'background: #3498db; color: #ffffff; font-size: 12px; font-weight: bold;');
  
  // Set a timeout to handle cases where the tab process hangs
  const timeoutId = setTimeout(() => {
    console.log('%c CONNECTION TIMEOUT FOR: ' + profile.name, 'background: #e74c3c; color: #ffffff; font-size: 14px; font-weight: bold;');
    profile.status = 'timeout';
    updateFloatingPanel();
    
    try { profileTab.close(); } catch (e) { /* ignore */ }
    processNextProfile(index + 1);
  }, 25000); // 25 second timeout
  
  // Create a content script to inject into the new tab
  const script = `
    // Listen for messages from parent window
    window.addEventListener('message', function(event) {
      console.log("Child tab received message:", event.data);
      if (event.data && event.data.action === 'autoConnect') {
        // Try to find the main window's automateLinkedInConnect function
        if (typeof automateLinkedInConnect === 'function') {
          console.log("Executing automateLinkedInConnect in child tab");
          automateLinkedInConnect(event.data.shouldSend);
        } else {
          console.log("automateLinkedInConnect function not found in child tab");
        }
      }
    });
    
    // Tell parent we're ready
    window.opener.postMessage({ action: 'tabReady' }, '*');
    console.log("Child tab sent ready message");
  `;
  
  // Listen for connection complete message
  window.addEventListener('message', function connectionListener(event) {
    if (event.data && event.data.action === 'connectionComplete' && event.data.profileUrl === profile.url) {
      console.log('%c RECEIVED CONNECTION COMPLETE MESSAGE FOR: ' + profile.name, 'background: #4CAF50; color: #ffffff; font-size: 14px; font-weight: bold;');
      
      clearTimeout(timeoutId);
      profile.status = 'completed';
      updateFloatingPanel();
      
      // Remove this listener
      window.removeEventListener('message', connectionListener);
    }
  });
  
  // Wait for tab to load
  setTimeout(() => {
    try {
      // Try to inject our listener script 
      profileTab.postMessage({ 
        action: 'autoConnect', 
        shouldSend: true,
        profileUrl: profile.url 
      }, '*');
      console.log('%c SENT CONNECT MESSAGE TO NEW TAB', 'background: #3498db; color: #ffffff; font-size: 12px; font-weight: bold;');
      
      // Also try to execute directly if we can
      try {
        profileTab.eval(`
          console.log("Direct execution in new tab");
          setTimeout(() => {
            if (typeof automateLinkedInConnect === 'function') {
              automateLinkedInConnect(true);
              
              // Notify parent window when complete
              setTimeout(() => {
                window.opener.postMessage({ 
                  action: 'connectionComplete',
                  profileUrl: '${profile.url}'
                }, '*');
              }, 2000);
            } else {
              console.log("Function not available via eval");
            }
          }, 2000);
        `);
      } catch (evalErr) {
        console.log('Eval execution failed:', evalErr);
      }
      
      // Move to the next profile after a longer delay to ensure completion
      setTimeout(() => {
        clearTimeout(timeoutId);
        
        // If status is still processing, mark as completed
        if (profile.status === 'processing') {
          profile.status = 'completed';
          updateFloatingPanel();
        }
        
        try { profileTab.close(); } catch (e) { /* ignore */ }
        processNextProfile(index + 1);
      }, 10000); // Increased to 10 seconds
    } catch (err) {
      console.log('%c ERROR COMMUNICATING WITH TAB:', 'background: #e74c3c; color: #ffffff; font-size: 12px;', err);
      clearTimeout(timeoutId);
      
      // Mark as failed
      profile.status = 'failed';
      updateFloatingPanel();
      
      // Still try to proceed to next profile
      setTimeout(() => {
        try { profileTab.close(); } catch (e) { /* ignore */ }
        processNextProfile(index + 1);
      }, 1000);
    }
  }, 3000); // 3 second delay to ensure page is loaded
}

// Function to automate LinkedIn connection
function automateLinkedInConnect(shouldSend = true) {
  console.log('%c AUTOMATION STARTED', 'background: #f39c12; color: #ffffff; font-size: 14px; font-weight: bold;');
  
  // Find profile name first
  const name = findProfileName();
  if (!name) {
    console.log('%c NO PROFILE NAME FOUND', 'background: #FFC107; color: #000000; font-size: 16px; font-weight: bold;');
    return;
  }
  
  console.log('%c PROFILE NAME: ' + name, 'background: #4CAF50; color: #ffffff; font-size: 16px; font-weight: bold;');
  
  // Step 1: Find and click the Connect button in main profile
  findAndClickConnect(shouldSend);
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
});

// Start observing the document
observer.observe(document.body, { childList: true, subtree: true });

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
  const titleMatch = title.match(/\([0-9]+\)\s*([^|]+)\s*\|/);
  if (titleMatch && titleMatch[1]) {
    console.log("Found name from page title");
    return titleMatch[1].trim();
  }
  
  // Method 3: Get any h1 with short text (last resort)
  const h1Elements = document.querySelectorAll('h1');
  for (const h1 of h1Elements) {
    const text = h1.textContent.trim();
    if (text && text.split(' ').length <= 5) { // Likely a name
      console.log("Found name from h1 element");
      return text;
    }
  }
  
  // Method 4: Debug - print all h1 contents to console
  console.log("DEBUG - All h1 elements on page:");
  document.querySelectorAll('h1').forEach((el, i) => {
    console.log(`h1 #${i}:`, el.textContent.trim());
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
    console.log("Main profile container not found");
    return null;
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
  
  // Method 3: Look for buttons with SVG connect-small icon in main profile
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

// Function to find and click Connect in main profile
function findAndClickConnect(shouldSend = true) {
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
    setTimeout(() => handleAddNote(shouldSend), 1000);
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
        setTimeout(() => handleAddNote(shouldSend), 1000);
      } else {
        console.log("Connect option not found in dropdown");
      }
    }, 1000);
  } else {
    console.log("More button not found");
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
function handleAddNote(shouldSend = true) {
  const addNoteButton = findAddNoteButton();
  if (!addNoteButton) {
    console.log('%c ADD NOTE BUTTON NOT FOUND', 'background: #FFC107; color: #000000; font-size: 16px; font-weight: bold;');
    
    // Try the More path again as a fallback
    console.log('Retrying with More button path...');
    // Check if any modal is open and close it first
    const closeButtons = document.querySelectorAll('button[aria-label="Dismiss"], button.artdeco-modal__dismiss');
    if (closeButtons.length > 0) {
      console.log('Closing open modal before retrying...');
      closeButtons[0].click();
      // Give it a moment to close
      setTimeout(() => findAndClickConnect(shouldSend), 500);
    } else {
      // Just retry directly
      findAndClickConnect(shouldSend);
    }
    return;
  }
  
  console.log('Clicking Add a note button...');
  addNoteButton.click();
  
  // Step 3: Wait for the textarea to appear and fill it with the name
  setTimeout(() => {
    fillCustomMessage(shouldSend);
  }, 500);
}

// Function to fill the custom message - update to notify parent window
function fillCustomMessage(shouldSend = true) {
  // Different selectors for the textarea
  const textareaSelectors = [
    'textarea#custom-message',
    '.artdeco-modal textarea',
    'textarea[name="message"]',
    'textarea.ember-text-area'
  ];
  
  let textarea = null;
  for (const selector of textareaSelectors) {
    textarea = document.querySelector(selector);
    if (textarea) break;
  }
  
  if (!textarea) {
    console.log('%c TEXTAREA NOT FOUND', 'background: #FFC107; color: #000000; font-size: 16px; font-weight: bold;');
    // Try to notify the parent window
    try {
      window.opener && window.opener.postMessage({ 
        action: 'connectionFailed',
        profileUrl: window.location.href
      }, '*');
    } catch (e) { /* ignore */ }
    return;
  }
  
  // Check if settings need to be initialized
  if (!userSettings.hasInitializedSettings) {
    showSettingsDialog();
    return;
  }
  
  // Use settings from chrome.storage
  const name = findProfileName();
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
      for (const selector of sendButtonSelectors) {
        const buttons = document.querySelectorAll(selector);
        for (const button of buttons) {
          if (button.textContent.trim() === 'Send') {
            sendButton = button;
            break;
          }
        }
        if (sendButton) break;
      }

      if (sendButton) {
        console.log('Clicking Send button...');
        sendButton.click();
        console.log('%c CONNECTION REQUEST SENT!', 'background: #4CAF50; color: #ffffff; font-size: 16px; font-weight: bold;');
        
        // Notify the parent window that connection is complete
        try {
          window.opener && window.opener.postMessage({ 
            action: 'connectionComplete',
            profileUrl: window.location.href
          }, '*');
        } catch (e) { /* ignore */ }
        
        // Wait a brief moment to ensure the send action is completed, then close the tab
        setTimeout(() => {
          console.log('Closing tab...');
          window.close();
        }, 1000); // Wait 1 second before closing
      } else {
        console.log('%c SEND BUTTON NOT FOUND', 'background: #FFC107; color: #000000; font-size: 16px; font-weight: bold;');
        
        // Notify the parent window that connection failed
        try {
          window.opener && window.opener.postMessage({ 
            action: 'connectionFailed',
            profileUrl: window.location.href
          }, '*');
        } catch (e) { /* ignore */ }
      }
    }, 500);
  } else {
    console.log('%c MESSAGE FILLED (NOT SENDING)', 'background: #4CAF50; color: #ffffff; font-size: 16px; font-weight: bold;');
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
  
  for (const selector of addNoteSelectors) {
    try {
      const buttons = document.querySelectorAll(selector);
      for (const button of buttons) {
        if (button.textContent.includes('Add a note')) {
          return button;
        }
      }
    } catch (e) {
      // Skip invalid selectors
    }
  }
  
  // Fallback: find by text content
  const allButtons = document.querySelectorAll('button');
  for (const button of allButtons) {
    if (button.textContent.trim() === 'Add a note') {
      return button;
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