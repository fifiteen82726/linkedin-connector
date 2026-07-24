# LinkedIn Connection Automator

A browser extension that simplifies and automates the LinkedIn connection process with personalized messages.

## Features

- **One-Click Automation**: Send personalized connection requests with a single keyboard shortcut
- **Personalized Messages**: Automatically inserts the recipient's first name in your connection message
- **Multiple Hotkey Options**:
  - `Alt+W`: Fill the message and automatically send the connection request
  - `Alt+Q`: Fill the message only (without sending, for review)
- **Automatic Tab Closing**: After sending a connection request, the tab closes automatically
- **Robust Detection**: Works with different LinkedIn layouts and UI variations
- **Canvass Candidate Selection**: On a LinkedIn company People page, loads up to two additional result batches and fills the review list to ten candidates, prioritizing configured Asian surname romanizations and then Engineer/Data titles while excluding high-seniority roles

## How It Works

1. The extension activates when you visit a LinkedIn profile
2. When you press `Alt+W` or `Alt+Q`, the extension:
   - Extracts the profile name from the page
   - Finds and clicks the Connect button (even if it's hidden in a dropdown menu)
   - Clicks "Add a note" to personalize the invitation
   - Fills in a personalized message template with the person's first name
   - Either sends the request automatically (with `Alt+W`) or leaves it for you to review (with `Alt+Q`)
   - Closes the tab after sending (if using `Alt+W`)

## Auto-Selecting Canvass Candidates

1. Open a LinkedIn company `People` page.
2. Click `Auto-select 10` in the extension's floating panel.
3. The extension preserves profiles already selected, clicks `Show more results` at most twice, and fills the list to ten.
4. Review the selected profiles.
5. Click `Connect to All` only when you are ready to send invitations.

The surname rule is a text heuristic based on the displayed name. It can produce false positives or miss uncommon names and does not determine a person's actual identity or ethnicity.

## Installation

1. Download the extension files
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" (toggle switch in the top-right corner)
4. Click "Load unpacked" and select the extension folder
5. The extension is now installed and active

## Customizing Your Message

To customize the message template, edit the `customMessage` variable in the `detect.js` file:

```javascript
const customMessage = `Hi ${firstName},

Hope you are doing well!
I'm Sunny, currently a Data Engineer at American Airlines. Impressed by your background, I'd like to connect and seek your referral for data job opportunities. Please let me share my resume once we connect on LinkedIn. Thanks!`;
```

Replace the text with your own personalized message. The `${firstName}` variable will be automatically replaced with the recipient's first name.

## Troubleshooting

If the extension doesn't work as expected:

1. **Connection button not found**: The extension tries multiple methods to find the Connect button, but LinkedIn's UI changes frequently. Check the console logs for debugging information.

2. **Profile name not detected**: The extension uses multiple selectors to find the profile name. If none work, it will log "NO PROFILE NAME FOUND" in the console.

3. **Add note button not found**: LinkedIn sometimes changes the implementation of the "Add a note" button. The extension tries multiple selectors but may need updating if LinkedIn's UI changes significantly.

## Privacy & Security

- This extension only runs on LinkedIn pages
- No data is collected or sent to external servers
- The extension only automates UI interactions you would normally do manually

## License

MIT License
