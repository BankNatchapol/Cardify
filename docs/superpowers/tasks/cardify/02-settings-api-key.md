---
title: Build Settings screen with Claude API key storage via Electron safeStorage
order: 2
depends_on_task: 01-scaffold-upload-parsing
feature: cardify
design: docs/superpowers/specs/cardify-design.md
plan:
plan_task: Requirement 11
skills: test-driven-development, verification-before-completion
---

## Goal

A Settings screen exists where the user can enter their Claude API key; the key is stored via Electron safeStorage, never exposed in the renderer, and the app shows a persistent indicator when a key is saved.

## Acceptance Criteria

- [ ] A Settings icon/button is visible in the Upload screen header and navigates to `src/screens/Settings.jsx`
- [ ] The Settings screen has a password-type input for the API key, a Save button, and a "Key saved" status indicator that appears after a successful save
- [ ] Saving the key calls `window.ipc.invoke('save-api-key', key)` which stores it via `safeStorage.encryptString` in `electron/main.js`; the raw key string is never sent back to the renderer after saving
- [ ] On app relaunch, `window.ipc.invoke('get-api-key-set')` returns `true` and the Settings screen shows "API key is saved" without displaying the key
- [ ] Clearing the key (Clear button) calls `window.ipc.invoke('clear-api-key')` and resets the indicator to "No key saved"

## Implementation notes

**Files:**
- Create: `src/screens/Settings.jsx` — API key input (type="password"), Save / Clear buttons, status indicator; never stores key in component state after save
- Modify: `electron/main.js` — add IPC handlers: `save-api-key` (safeStorage.encryptString → write to userData path), `get-api-key-set` (check file exists + decrypt returns non-empty), `clear-api-key` (delete file), `get-api-key` (internal use only — decrypt for Claude calls, never sent to renderer via IPC)
- Modify: `src/App.jsx` — add Settings nav link in header; pass `apiKeySet` boolean from `get-api-key-set` to Upload screen to disable Generate button with message "Add your Claude API key in Settings first"
- Modify: `electron/preload.js` — expose `save-api-key`, `get-api-key-set`, `clear-api-key` channels

**Interfaces:**
- Consumes: `electron/main.js` IPC infrastructure from Task 1
- Produces: `get-api-key` internal IPC (used by Task 3 claude.js in main process only); `apiKeySet` boolean available to Upload screen

## Out of scope

- Validating the API key against the Claude API (Task 3 will surface auth errors during generation)
- Multiple API key profiles
- Any key exposure in renderer memory beyond the input field before save
