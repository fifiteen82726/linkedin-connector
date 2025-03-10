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

// Function to automate LinkedIn connection
function automateLinkedInConnect() {
  // Find profile name first
  const name = findProfileName();
  if (!name) {
    console.log('%c NO PROFILE NAME FOUND', 'background: #FFC107; color: #000000; font-size: 16px; font-weight: bold;');
    return;
  }
  
  console.log('%c PROFILE NAME: ' + name, 'background: #4CAF50; color: #ffffff; font-size: 16px; font-weight: bold;');
  
  // Step 1: Find and click the Connect button
  const connectButton = findConnectButton();
  if (!connectButton) {
    console.log('%c CONNECT BUTTON NOT FOUND', 'background: #FFC107; color: #000000; font-size: 16px; font-weight: bold;');
    return;
  }
  
  console.log('Clicking Connect button...');
  connectButton.click();
  
  // Step 2: Wait for the modal to appear, then find and click "Add a note" button
  setTimeout(() => {
    const addNoteButton = findAddNoteButton();
    if (!addNoteButton) {
      console.log('%c ADD NOTE BUTTON NOT FOUND', 'background: #FFC107; color: #000000; font-size: 16px; font-weight: bold;');
      return;
    }
    
    console.log('Clicking Add a note button...');
    addNoteButton.click();
    
    // Step 3: Wait for the textarea to appear and fill it with the name
    setTimeout(() => {
      const textarea = document.querySelector('textarea#custom-message');
      if (!textarea) {
        console.log('%c TEXTAREA NOT FOUND', 'background: #FFC107; color: #000000; font-size: 16px; font-weight: bold;');
        return;
      }
      
      // Use the first name for personalization
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
      
      console.log('%c AUTOMATION COMPLETE', 'background: #4CAF50; color: #ffffff; font-size: 16px; font-weight: bold;');
    }, 500); // Wait for textarea to be available
  }, 500); // Wait for modal to appear
}

// Helper function to find the Connect button
function findConnectButton() {
  // Look for the connect button by different means
  const connectButtons = Array.from(document.querySelectorAll('button, a')).filter(el => {
    const span = el.querySelector('span.artdeco-button__text');
    return span && span.textContent.trim() === 'Connect';
  });
  
  return connectButtons.length > 0 ? connectButtons[0] : null;
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