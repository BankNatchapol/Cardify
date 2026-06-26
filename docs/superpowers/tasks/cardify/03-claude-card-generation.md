---
title: Implement Claude API integration to generate context-aware flashcards
order: 3
depends_on_task: 02-settings-api-key
feature: cardify
design: docs/superpowers/specs/cardify-design.md
plan:
plan_task: Requirements 5–6
skills: test-driven-development, verification-before-completion
---

## Goal

The app calls the Claude API (claude-sonnet-4-6) with the parsed file text and user context prompt, and returns a structured array of flashcard objects to the renderer; long text is chunked to stay within token limits and results are merged.

## Acceptance Criteria

- [ ] Clicking Generate on the Upload screen triggers `window.ipc.invoke('generate-cards', { parsedText, contextPrompt, cardFormat })` and the UI shows a loading spinner while waiting
- [ ] The main process calls `claude-sonnet-4-6` with the system prompt from spec (context-tuned generation, JSON output); response is parsed into `Array<{front: string, back: string, type: 'basic'}>` for Basic or `Array<{text: string, type: 'cloze'}>` for Cloze
- [ ] Text longer than 8000 tokens is split into chunks; each chunk is sent in a separate Claude call and results are concatenated before returning to renderer
- [ ] If the Claude API returns an auth error (401), the IPC response is `{ error: 'invalid-api-key' }` and the renderer shows "Invalid API key — check Settings"
- [ ] `npm test` passes (unit tests for `src/lib/claude.js`: prompt builder produces correct system/user messages for both Basic and Cloze format, chunker splits text at ~8000 tokens without cutting mid-sentence)

## Implementation notes

**Files:**
- Create: `src/lib/claude.js` — runs in main process only; exports `generateCards(parsedText, contextPrompt, cardFormat, apiKey)`: builds prompt, chunks text if needed, calls `@anthropic-ai/sdk` `messages.create`, parses JSON response, merges chunks; throws typed errors for auth failures and malformed JSON responses
- Modify: `electron/main.js` — `generate-cards` IPC handler: retrieves API key via internal `safeStorage` decrypt, calls `generateCards`, returns result or `{ error }` object to renderer
- Modify: `src/screens/Upload.jsx` — on Generate click: show loading state, call `generate-cards` IPC, on success navigate to Review screen with cards array; on `error: 'invalid-api-key'` show inline error banner
- Create: `tests/claude.test.js` — unit tests for `generateCards` prompt builder and text chunker (mock `@anthropic-ai/sdk` client)

**Interfaces:**
- Consumes: `get-api-key` internal decrypt from Task 2; `parsedText` string from Task 1 `parse-file` IPC
- Produces: `window.ipc.invoke('generate-cards', ...) → Array<{front, back, type} | {text, type}>` — consumed by Task 4 Review screen

**Claude prompt:**
```
System: You are a flashcard generation expert. Generate {format} flashcards from the provided text.
Tune the cards specifically to the user's context — emphasize what matters for their stated goal,
omit or deprioritize what doesn't.
Return ONLY a JSON array, no explanation:
- Basic: [{"front": "...", "back": "..."}]
- Cloze: [{"text": "{{c1::term}} is ..."}]

User: Context: {contextPrompt}
Text: {parsedTextChunk}
```

## Out of scope

- Streaming responses (use non-streaming messages.create)
- Per-card regeneration (Task 4 handles manual editing only)
- Cloze validation against Anki's exact syntax (best-effort generation)
- Rate limiting / retry logic beyond what the SDK provides by default
