---
title: Scaffold Electron + React app with file upload screen and file parsing
order: 1
depends_on_task: null
feature: cardify
design: docs/superpowers/specs/cardify-design.md
plan:
plan_task: Requirements 1–4; Recommended Approach (scaffold)
skills: test-driven-development, verification-before-completion
---

## Goal

A runnable Electron + React app exists with a file upload screen where the user can select a PDF or .txt file, enter a context prompt, pick card format (Basic or Cloze), and see the parsed text returned from the main process.

## Acceptance Criteria

- [ ] `npm run dev` starts the Electron app with a visible Upload screen (no blank window, no console errors)
- [ ] User can drag-and-drop or use a file picker to select a `.pdf` or `.txt` file; other file types are rejected with an inline error message
- [ ] After file selection, the main process parses the file via `parse-file` IPC and returns extracted plain text to the renderer; the Upload screen shows a character count confirming parsing succeeded
- [ ] User can type a free-text context prompt (required field, min 10 characters) and select card format (Basic or Cloze) via radio buttons; the Generate button is disabled until both are filled
- [ ] `npm test` passes (unit tests for `src/lib/parser.js`: PDF extraction returns non-empty string, .txt read returns file contents, unsupported extension throws)

## Implementation notes

**Files:**
- Create: `package.json` — Electron + React + Vite + pdf-parse + @anthropic-ai/sdk + electron-builder deps
- Create: `vite.config.js` — Vite config for Electron renderer (base: `./`)
- Create: `electron-builder.config.js` — build config targeting macOS
- Create: `electron/main.js` — BrowserWindow setup, `parse-file` IPC handler (calls `src/lib/parser.js`), registers all IPC channels as stubs for later tasks
- Create: `electron/preload.js` — contextBridge exposing `window.ipc.invoke(channel, ...args)` to renderer
- Create: `src/App.jsx` — top-level React app; screen state: `upload | settings | review`; renders active screen
- Create: `src/screens/Upload.jsx` — drag-and-drop zone + file picker button, context prompt textarea, Basic/Cloze radio, Generate button; calls `window.ipc.invoke('parse-file', filePath)` on file select
- Create: `src/lib/parser.js` — `parseFile(filePath)`: uses `pdf-parse` for `.pdf`, `fs.readFile` for `.txt`, throws `UnsupportedFileTypeError` for anything else
- Create: `src/index.css` — minimal reset + layout styles
- Create: `src/main.jsx` — React DOM entry point
- Create: `index.html` — Vite HTML entry
- Create: `tests/parser.test.js` — unit tests for `parseFile`

**Interfaces:**
- Consumes: nothing (first task)
- Produces: `window.ipc.invoke('parse-file', filePath) → string` (extracted text); Upload screen state `{ filePath, parsedText, contextPrompt, cardFormat }` passed to later screens via App.jsx state

## Out of scope

- Claude API calls (Task 3)
- Settings screen or API key (Task 2)
- Card review UI (Task 4)
- AnkiConnect (Task 5)
- Long PDF chunking — parse full file, truncation handled in Task 3
