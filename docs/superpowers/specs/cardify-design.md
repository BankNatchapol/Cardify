# Cardify

**Goal:** Build an Electron desktop app that takes a PDF or text file plus a user context prompt, generates context-aware flashcards via Claude API, lets the user review and edit them, then pushes the deck to Anki via AnkiConnect.

**Architecture:** Electron main process (Node.js) handles file parsing (pdf-parse), Claude API calls (@anthropic-ai/sdk), and AnkiConnect HTTP calls; the renderer (React + Vite) handles all UI including upload, context config, card preview, and inline editing. IPC bridges main ↔ renderer for all side-effectful operations. API key is stored in Electron safeStorage.

**Tech Stack:** Electron, React, Vite, @anthropic-ai/sdk, pdf-parse, AnkiConnect (localhost:8765)

## Global Constraints

- No existing codebase — greenfield Electron + React app
- AnkiConnect must be running locally (port 8765) for push to work; app should detect and surface this clearly
- Claude API key stored via Electron safeStorage (never hardcoded or in localStorage)
- PDF + plain text only for Phase 1; no images, video, or audio

## Current State

Greenfield. No application code exists. Only `docs/`, `CLAUDE.md`, and `.gitignore` are present.

## Requirements

1. User can upload a PDF or plain text file via drag-and-drop or file picker
2. User provides a free-text context prompt describing their study goal and level (e.g. "Med student, Step 1 pharmacology, focus on mechanisms not brand names")
3. User selects card format: Basic (front/back) or Cloze (`{{c1::text}}`) — applies to the whole generation run
4. App parses the file (pdf-parse for PDF, fs.readFile for .txt) in the main process
5. App calls Claude API (claude-sonnet-4-6) with the file content + context prompt to generate flashcards in the selected format
6. Claude prompt must instruct the model to tune card content and emphasis to the user's stated context — not just extract facts
7. Generated cards are shown in a review UI before any Anki interaction; user can edit front/back of each card inline and delete unwanted cards
8. User confirms the deck; app calls AnkiConnect `addNotes` action on localhost:8765 to push cards into a named deck
9. Deck name defaults to the uploaded filename (without extension); user can override it before pushing
10. App detects if AnkiConnect is unreachable and shows a clear error with fix instructions (open Anki, install AnkiConnect plugin)
11. Claude API key is entered once in a settings screen and stored via Electron safeStorage; never exposed in renderer

## Out of Scope

- Built-in spaced repetition or study sessions (use Anki for this)
- Image, video, or audio file input
- User accounts, cloud sync, or remote storage
- Multiple AI providers (Claude only)
- Deck editing after push (use Anki's UI)
- Exporting .apkg files (direct AnkiConnect push only)
- Auto-detection of optimal card format (user picks explicitly)

## Recommended Approach

**Project structure:**
```
electron/
  main.js          — app entry, IPC handlers, safeStorage
  preload.js       — contextBridge exposing ipc to renderer
src/
  App.jsx          — top-level React app, routing between screens
  screens/
    Upload.jsx     — file upload + context prompt + format picker
    Review.jsx     — card list with inline editing and delete
    Settings.jsx   — API key entry and storage
  components/
    CardEditor.jsx — single card front/back editor
    DeckNameInput.jsx
  lib/
    claude.js      — card generation prompt + API call (main process)
    ankiconnect.js — AnkiConnect wrapper (addNotes, testConnection)
    parser.js      — PDF and text file parsing
vite.config.js
electron-builder.config.js
```

**IPC surface (main ↔ renderer):**
- `parse-file` → returns extracted text
- `generate-cards` → returns array of `{front, back, type}` objects
- `push-to-anki` → returns `{success, errors[]}`
- `test-anki-connection` → returns `{connected: bool}`
- `save-api-key` / `get-api-key-set` → safeStorage ops

**Claude prompt pattern:**
```
System: You are a flashcard generation expert. Generate {format} flashcards from the provided text. 
Tune the cards specifically to the user's context — emphasize what matters for their stated goal, 
omit or deprioritize what doesn't. Return JSON array: [{front, back}] for Basic or [{text}] for Cloze.

User: Context: {contextPrompt}
Text: {parsedText}
```

**AnkiConnect call:**
```json
{
  "action": "addNotes",
  "version": 6,
  "params": {
    "notes": [{ "deckName": "...", "modelName": "Basic", "fields": { "Front": "...", "Back": "..." } }]
  }
}
```

## Open Questions

- Should the app support creating a new Anki deck if it doesn't exist, or require the user to pre-create it? (Recommend: auto-create via AnkiConnect `createDeck` action)
- Should long PDFs be chunked across multiple Claude API calls, or truncated? (Recommend: chunk at ~8k tokens per call, merge results)
- Should the review screen show a "regenerate" button per card, or only allow manual editing?

## Source

- Design: docs/gstack/designs/cardify-design.md
- Spec date: 2026-06-26
