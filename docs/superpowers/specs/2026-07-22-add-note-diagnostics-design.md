# Add Note Diagnostics Design

## Context

The invitation modal is visible and contains `button[aria-label="Add a note"]`, but the active automation context continues polling and eventually reports that the button was not found. The current logs do not identify which frame produced each message, what document that frame can inspect, or why delegation selected a child frame.

## Goal

Add structured diagnostics that reveal where the invite-modal flow is running and what each frame can observe. This change must not alter selectors, delegation, click behavior, retry timing, message filling, or sending behavior.

## Log Format

All new diagnostics use the prefix `[LinkedIn Invite]` and structured objects rather than long formatted strings. Every event includes:

- `event`: stable event name.
- `frameRole`: `top` or `child`.
- `url`: the current frame URL.
- `readyState` and `visibilityState` when document state matters.

## Events

### Script initialization

`SCRIPT_INIT` logs once per injected frame with frame role, URL, referrer, ready state, and visibility state. This confirms whether `all_frames` injection reached the modal frame.

### Add-note scan

`ADD_NOTE_SCAN` logs on the first attempt, every fifth remaining retry, and the final attempt. It includes:

- Attempt number and retries remaining.
- Counts for `#artdeco-modal-outlet`, `[data-test-modal-id="send-invite-modal"]`, `[data-test-modal]`, and `button[aria-label="Add a note"]` in the current document.
- Number of accessible documents and iframe elements.
- Active element tag, id, and aria-label.

The final failed scan also includes a bounded list of up to 20 visible button summaries containing text, aria-label, id, and disabled state.

### Frame delegation

`FRAME_DISCOVERY` logs one entry per iframe considered for delegation, including index, source URL, parsed origin, whether it is a LinkedIn frame, whether `contentWindow` exists, and whether `contentDocument` is readable.

`FRAME_MESSAGE_SENT`, `FRAME_MESSAGE_SKIPPED`, and `FRAME_MESSAGE_ERROR` record the outcome for each frame. `INVITE_DELEGATED` records the total recipient count.

### Frame message reception

`FRAME_MESSAGE_RECEIVED` logs only extension invite-modal messages. It includes event origin, whether the sender equals `window.parent`, action, and frame role. Unrelated page, MetaMask, and `setImmediate` messages are not logged by the new diagnostic path.

### Selector success

`ADD_NOTE_FOUND` records which document index and selector matched, plus the matched button summary. `ADD_NOTE_CLICK` records the same frame context immediately before clicking.

## Privacy And Noise Limits

Diagnostics must not log the saved message template, textarea contents, user settings, storage values, or arbitrary page HTML. Button summaries are capped at 20 entries, whitespace-normalized, and text-truncated to 120 characters.

## Testing

Tests will capture console calls and verify that:

- A failed scan reports frame role, modal counts, and retry state.
- Delegation reports sent and skipped frame outcomes.
- Child-frame reception reports origin and parent-source validation.
- Successful selector matching reports the selector and document index.
- Existing automation tests remain unchanged and pass.

