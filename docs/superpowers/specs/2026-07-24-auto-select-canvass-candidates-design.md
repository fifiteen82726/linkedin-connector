# Auto-Select Canvass Candidates Design

**Date:** 2026-07-24

**Goal:** Add an explicit `Auto-select 10` action to the LinkedIn company People page that preserves the current selection, loads at most two additional result batches, and fills the selection to ten eligible canvassing candidates.

## Product Decisions

- The feature runs only after the user clicks `Auto-select 10` in the existing floating panel.
- It adds profiles to `Selected Profiles`; it never starts `Connect to All` or sends an invitation.
- Existing manual selections are preserved. Automation fills the list until it contains ten profiles.
- If more than ten profiles are already selected, automation removes nothing.
- High-level titles are always excluded, including when the profile has a matching Asian surname.
- Asian surnames have first priority. Engineer and data-related titles provide the second-priority fallback.
- Before ranking, automation clicks LinkedIn's `Show more results` control at most twice, waiting for each result batch to load.
- If fewer than ten matching profiles are available after those attempts, all matches remain selected and the panel reports the actual count.

## Architecture

Create a small, pure rules module named `candidate-rules.js`. It owns name normalization, inferred surname extraction, title inclusion and exclusion, candidate classification, and stable priority ranking. The module exposes a browser global for `detect.js` and CommonJS-compatible behavior for the existing Node test harness.

Keep browser interaction in `detect.js`. It owns the floating-panel controls, LinkedIn DOM selectors, result loading, card extraction, selection state, button synchronization, and status reporting. `manifest.json` loads `candidate-rules.js` before `detect.js`.

This boundary keeps demographic-name and title rules independently testable while avoiding further growth of the already large page automation script.

## Candidate Data

Each parsed card produces:

```js
{
  name: 'Yoojin Lim',
  title: 'Senior Data Engineer',
  url: 'https://www.linkedin.com/in/yoojin-lim/',
  card: HTMLElement
}
```

The profile URL is the identity key for deduplication. Cards without a usable profile URL or display name are ignored. A missing title is allowed because an Asian surname can qualify independently.

## Name and Surname Rules

LinkedIn company People cards do not expose a reliable `lastName` field, so the extension infers a surname from the displayed full name:

1. Normalize Unicode, whitespace, apostrophes, periods, and letter case.
2. If the name contains a comma, treat the text before the comma as the surname.
3. Otherwise remove common honorifics and suffixes, then use the final remaining token.
4. For a hyphenated surname, compare both the complete surname and its component tokens.

The hard-coded surname set covers common romanizations from East Asia, Southeast Asia, and South Asia. It is curated with reference to the U.S. Census Bureau's [Decennial Census Surname Files](https://www.census.gov/data/developers/data-sets/surnames.html) and official romanization guidance where useful.

Surname-only classification is intentionally approximate. Cross-cultural surnames such as `Lee` and `Young` can match, while surname-first display order or uncommon romanizations can be missed. The feature makes no claim about a person's actual identity or ethnicity.

## Title Rules

Title matching is case-insensitive and uses token or phrase boundaries so short abbreviations do not match inside unrelated words.

### Exclusions

The following seniority markers exclude a profile before any positive rule is considered:

- `Founder`, `Co-Founder`, `Owner`
- `Chief`
- `CEO`, `CFO`, `COO`, `CTO`, `CIO`, `CMO`, `CRO`, `CPO`
- `President`, `Vice President`, `VP`
- `Director`, `Managing Director`, `Executive Director`
- `Head of`
- `Partner`, `Managing Partner`
- `Principal`
- `Manager`

`Senior`, `Staff`, `Lead`, and `Architect` do not exclude a profile by themselves.

### Positive Title Matches

The second-priority title group includes:

- `Engineer`, `Engineering`
- `Data`
- `Analytics`, `Analyst`
- `Data Science`, `Data Scientist`
- `Machine Learning`, `ML`
- `Artificial Intelligence`, `AI`
- `Business Intelligence`, `BI`
- `Database`, `DBA`

## Ranking and Selection

After extracting all currently loaded cards:

1. Remove profiles whose title matches an exclusion.
2. Remove profiles whose URL is already present in `selectedProfiles`.
3. Classify remaining profiles into:
   - priority 1: surname match;
   - priority 2: positive title match without a surname match;
   - ineligible.
4. Preserve LinkedIn DOM order within each priority group.
5. Concatenate priority 1 and priority 2.
6. Add only the number needed to bring `selectedProfiles.length` to ten.

A profile matching both positive categories appears once in priority 1.

## Loading Additional Results

The controller looks for a visible, enabled button whose normalized text or accessible label is `Show more results`. It does not depend only on unstable LinkedIn class names.

For each of at most two attempts:

1. Record the current number and URLs of profile cards.
2. Click `Show more results`.
3. Wait until at least one new profile URL appears or the card count increases.
4. Also observe disabled/loading state and DOM mutations.
5. Stop waiting after a bounded timeout.

If the control is absent, disabled without recovering, or times out, the controller stops loading and scans the cards currently available. Loading failure never clears an existing or newly made selection.

## Floating Panel UX

Add an `Auto-select 10` button to the existing panel footer and a small status line above the footer.

Status messages are:

- `Ready to auto-select`
- `Loading people 1/2…`
- `Loading people 2/2…`
- `Reviewing N profiles…`
- `Selected 10/10 profiles`
- `Only found N/10 matching profiles`
- `Auto-select failed: <short reason>`

The button is disabled while the controller is running. A second click cannot start a concurrent run. If ten or more profiles are already selected, the controller skips loading and reports completion without changing the list.

Manual Select, remove, Clear All, and Connect to All behavior remain available. Newly selected cards receive the same `Selected ✓` presentation as manually selected cards.

## Error Handling

- Malformed cards are skipped individually.
- A missing or exhausted `Show more results` control is treated as the end of available input, not as a fatal error.
- A loading timeout proceeds with the current cards.
- An unexpected controller exception restores the button to its enabled state, preserves all selected profiles, and displays a concise error.
- The run-state flag is reset in a `finally` block.

## Testing

Use the repository's Node `node:test`, `assert`, and `vm` pattern.

`candidate-rules.test.js` covers:

- surname parsing with commas, suffixes, punctuation, case, Unicode, and hyphens;
- representative East Asian, Southeast Asian, and South Asian surnames;
- all high-level exclusion terms and their precedence over surname matches;
- Engineer and data-related positive terms;
- abbreviation boundaries that avoid unrelated substring matches;
- stable priority ordering and URL deduplication.

`detect.test.js` covers:

- preserving existing selections and filling only to ten;
- synchronizing selected card buttons and the floating panel;
- zero loading attempts when already full;
- at most two sequential `Show more results` clicks;
- waiting for new cards after each click;
- missing controls and timeouts;
- fewer than ten matches;
- rejecting concurrent runs.

The final verification is:

```bash
node --test
git diff --check
```

Manual Chrome verification loads the unpacked extension, opens a LinkedIn company People page, runs `Auto-select 10`, confirms no more than two `Show more results` clicks, checks the selected order, and verifies that no invitation is sent until the user explicitly clicks `Connect to All`.
