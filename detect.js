// Track modifier key states
let altKeyPressed = false;

// Listen for keydown events
document.addEventListener('keydown', function(event) {
  // Update Alt key state
  if (event.key === 'Alt') {
    altKeyPressed = true;
    console.log('Alt key pressed');
  }
  
  // Check for hotkey combination (Alt+W) using the code which is consistent
  // regardless of the character produced
  if (altKeyPressed && event.code === 'KeyW') {
    console.log('%c HOTKEY "Alt+W" DETECTED! ', 'background: #ff0000; color: #ffffff; font-size: 16px; font-weight: bold;');
    
    // Call the function to find profile name and automate connection
    automateLinkedInConnect();
  }
  
  // Log the key pressed
  const timestamp = new Date().toLocaleTimeString();
  console.log(`[${timestamp}] Key: "${event.key}" (code: ${event.code}) | Alt: ${altKeyPressed}`);
});

// Listen for keyup events to track when Alt is released
document.addEventListener('keyup', function(event) {
  if (event.key === 'Alt') {
    altKeyPressed = false;
    console.log('Alt key released');
  }
});

// Reset modifier keys when window loses focus
window.addEventListener('blur', function() {
  altKeyPressed = false;
  console.log('Window lost focus - reset modifier keys');
});

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
function findAndClickConnect() {
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
    setTimeout(handleAddNote, 1000);
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
        setTimeout(handleAddNote, 1000);
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

// Function to automate LinkedIn connection
function automateLinkedInConnect() {
  // Find profile name first
  const name = findProfileName();
  if (!name) {
    console.log('%c NO PROFILE NAME FOUND', 'background: #FFC107; color: #000000; font-size: 16px; font-weight: bold;');
    return;
  }
  
  console.log('%c PROFILE NAME: ' + name, 'background: #4CAF50; color: #ffffff; font-size: 16px; font-weight: bold;');
  
  // Step 1: Find and click the Connect button in main profile
  findAndClickConnect();
}

// Function to handle the Add Note flow
function handleAddNote() {
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
      setTimeout(findAndClickConnect, 500);
    } else {
      // Just retry directly
      findAndClickConnect();
    }
    return;
  }
  
  console.log('Clicking Add a note button...');
  addNoteButton.click();
  
  // Step 3: Wait for the textarea to appear and fill it with the name
  setTimeout(() => {
    fillCustomMessage();
  }, 500); // Wait for textarea to be available
}

// Function to fill the custom message
function fillCustomMessage() {
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
    return;
  }
  
  // Use the first name for personalization
  const name = findProfileName();
  const firstName = getFirstName(name);
  
  // Custom message template
  const customMessage = `Hi ${firstName},

Hope you are doing well!
I'm Sunny, currently a Data Engineer at American Airlines. Impressed by your background, I'd like to connect and seek your referral for data job opportunities. Please let me share my resume once we connect on LinkedIn. Thanks!`;
  
  // Fill in the textarea
  textarea.value = customMessage;
  
  // Trigger input event to ensure LinkedIn recognizes the change
  const inputEvent = new Event('input', { bubbles: true });
  textarea.dispatchEvent(inputEvent);
  
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
    } else {
      console.log('%c SEND BUTTON NOT FOUND', 'background: #FFC107; color: #000000; font-size: 16px; font-weight: bold;');
    }
  }, 500); // Wait 500ms to ensure message is filled before clicking Send

  console.log('%c AUTOMATION COMPLETE', 'background: #4CAF50; color: #ffffff; font-size: 16px; font-weight: bold;');
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
console.log('LinkedIn Connect Automation extension activated - press Alt+W to connect');