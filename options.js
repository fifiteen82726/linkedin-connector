// Default settings
const DEFAULT_SETTINGS = {
  myName: 'Alan',
  myRole: 'Software Engineer',
  myCompany: 'Google',
  targetRole: 'data',
  messageTemplate: `Hi {{firstName}},

Hope you are doing well!
I'm {{myName}}, currently a {{myRole}} at {{myCompany}}. Impressed by your background, I'd like to connect and seek your referral for {{targetRole}} opportunities. Please let me share my resume once we connect on LinkedIn. Thanks!`
};

// Load saved settings when the page loads
document.addEventListener('DOMContentLoaded', function() {
  // Load settings from storage
  chrome.storage.sync.get(DEFAULT_SETTINGS, function(items) {
    // Fill in the form with saved values
    document.getElementById('myName').value = items.myName;
    document.getElementById('myRole').value = items.myRole;
    document.getElementById('myCompany').value = items.myCompany;
    document.getElementById('targetRole').value = items.targetRole;
    document.getElementById('messageTemplate').value = items.messageTemplate;
  });
});

// Save settings when the save button is clicked
document.getElementById('saveSettings').addEventListener('click', function() {
  const settings = {
    myName: document.getElementById('myName').value,
    myRole: document.getElementById('myRole').value,
    myCompany: document.getElementById('myCompany').value,
    targetRole: document.getElementById('targetRole').value,
    messageTemplate: document.getElementById('messageTemplate').value
  };

  // Save to chrome.storage
  chrome.storage.sync.set(settings, function() {
    // Show success message
    const status = document.getElementById('status');
    status.textContent = 'Settings saved successfully!';
    status.className = 'status success';
    status.style.display = 'block';
    
    // Hide the message after 3 seconds
    setTimeout(function() {
      status.style.display = 'none';
    }, 3000);
  });
}); 