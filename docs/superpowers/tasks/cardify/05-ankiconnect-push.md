---
title: Implement AnkiConnect integration to push confirmed deck to Anki
order: 5
depends_on_task: 04-card-review-ui
feature: cardify
design: docs/superpowers/specs/cardify-design.md
plan:
plan_task: Requirements 8, 10
skills: test-driven-development, verification-before-completion
---

## Goal

Clicking Push to Anki on the Review screen sends the confirmed card list to Anki via AnkiConnect, creates the deck if it doesn't exist, and surfaces actionable errors when AnkiConnect is unreachable or cards are rejected.

## Acceptance Criteria

- [ ] Clicking Push to Anki calls `window.ipc.invoke('push-to-anki', { deckName, cards })` and shows a loading spinner on the button; on success shows a "✓ N cards added to [deckName]" banner on the Review screen
- [ ] If the deck does not exist in Anki, the main process calls AnkiConnect `createDeck` before `addNotes`; the deck is created automatically without prompting the user
- [ ] If AnkiConnect is unreachable (connection refused on port 8765), the IPC response is `{ error: 'anki-not-running' }` and the renderer shows: "Anki isn't running. Open Anki and make sure the AnkiConnect plugin is installed, then try again."
- [ ] If AnkiConnect returns per-note errors (duplicate cards), the banner shows "N cards added, M duplicates skipped" without treating duplicates as a failure
- [ ] `npm test` passes (unit tests for `src/lib/ankiconnect.js`: `testConnection` returns `{ connected: false }` when fetch throws ECONNREFUSED, `buildNotes` correctly maps Basic `{front,back}` and Cloze `{text}` to AnkiConnect note format with correct `modelName`)

## Implementation notes

**Files:**
- Create: `src/lib/ankiconnect.js` — runs in main process only; exports:
  - `testConnection()` → `{ connected: bool }` — GET to `http://localhost:8765` with 2 s timeout
  - `createDeck(deckName)` — POST `{ action: 'createDeck', version: 6, params: { deck: deckName } }`
  - `addNotes(deckName, cards)` → `{ added: number, errors: string[] }` — POST `{ action: 'addNotes', version: 6, params: { notes: [...] } }`; maps Basic cards to `modelName: 'Basic'` with fields `{ Front, Back }`, Cloze cards to `modelName: 'Cloze'` with fields `{ Text }`
  - `buildNotes(deckName, cards)` — pure function mapping card array to AnkiConnect notes array (unit-testable)
- Modify: `electron/main.js` — `push-to-anki` IPC handler: calls `testConnection`, then `createDeck`, then `addNotes`; returns `{ success: true, added, errors }` or `{ error: 'anki-not-running' }`
- Modify: `electron/preload.js` — expose `push-to-anki` channel
- Modify: `src/screens/Review.jsx` — wire Push to Anki button to `window.ipc.invoke('push-to-anki', ...)` via `onPush` callback; show success banner or error message based on response; disable button during loading
- Create: `tests/ankiconnect.test.js` — unit tests for `testConnection` and `buildNotes`

**AnkiConnect note format:**
```json
Basic:  { "deckName": "...", "modelName": "Basic",  "fields": { "Front": "...", "Back": "..." }, "options": { "allowDuplicate": false }, "tags": [] }
Cloze:  { "deckName": "...", "modelName": "Cloze",  "fields": { "Text": "{{c1::...}}" },          "options": { "allowDuplicate": false }, "tags": [] }
```

**Interfaces:**
- Consumes: `{ deckName, cards }` from Task 4 Review screen `onPush` callback
- Produces: nothing downstream — this is the final step in the pipeline

## Out of scope

- Exporting .apkg files
- Editing cards after push (use Anki's UI)
- Syncing to AnkiWeb (handled by Anki itself)
- Support for custom Anki note types beyond Basic and Cloze
