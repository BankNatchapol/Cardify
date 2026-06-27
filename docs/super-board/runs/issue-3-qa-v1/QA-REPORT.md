# QA Report — Issue #3 (v1)
## Implement Claude API integration to generate context-aware flashcards

**Date:** 2026-06-27
**Branch:** issue-3-implement-claude-api
**PR:** #8
**QA version:** v1

## Test plan

One observable test per AC:

| AC | Description | Method | Result |
|----|-------------|--------|--------|
| AC1 | Generate click triggers IPC + loading spinner | Source inspection + unit test coverage | PASS |
| AC2 | Main process calls claude-sonnet-4-6, parses to typed arrays | Unit tests in claude.test.js | PASS |
| AC3 | Text >8000 tokens chunked, results concatenated | Unit tests in claude.test.js | PASS |
| AC4 | Auth error (401) -> { error: 'invalid-api-key' } + renderer banner | Unit tests + source inspection | PASS |
| AC5 | npm test passes (18 new unit tests) | npm test | PASS |

## Test execution

Command: `npm test`
Output: 46 tests passed (3 suites: parser.test.js, claude.test.js, ac-verification.test.js)

### AC1 — IPC invocation + loading spinner
- `handleGenerate` in `src/screens/Upload.jsx` line 97 calls `window.ipc.invoke('generate-cards', { parsedText, contextPrompt, cardFormat })`
- `setGenerating(true)` at line 95 shows spinner + "Generating..." text (line 242)
- `aria-busy={generating}` set for accessibility (line 239)
- Button disabled while generating via `!isGenerateEnabled` which includes `!generating` (line 31)

### AC2 — Claude API model + response parsing
- `callClaude()` in `src/lib/claude.js` line 154 specifies `model: 'claude-sonnet-4-6'`
- `buildPrompt()` generates system prompt with format-specific JSON schema instructions
- Response parsed into typed arrays: basic `{front, back, type: 'basic'}`, cloze `{text, type: 'cloze'}`
- Markdown code fences stripped before JSON.parse (line 176-177)
- Test coverage: 8 tests in `generateCards` describe block

### AC3 — Text chunking
- `chunkText()` splits at ~32000 chars (≈8000 tokens at 4 chars/token)
- Splits at sentence boundaries (`.`, `!`, `?` + space + uppercase), falls back to hard cut
- `generateCards()` loops over chunks, concatenates results
- Test "makes multiple API calls for long text" verifies 3+ API calls for 3x chunk text

### AC4 — Auth error handling
- SDK 401 detection: `err.status === 401 || err.message.includes('authentication')` (line 163-164)
- `ApiKeyError` thrown with `code: 'invalid-api-key'`
- IPC handler in `electron/main.js` line 99 catches `ApiKeyError` and returns `{ error: 'invalid-api-key' }`
- Upload.jsx line 103 checks `result.error === 'invalid-api-key'` and sets error banner text "Invalid API key — check Settings"
- `data-testid="generate-error"` on error banner (line 228)

### AC5 — npm test passes
```
PASS tests/parser.test.js
PASS tests/claude.test.js
PASS tests/ac-verification.test.js

Test Suites: 3 passed, 3 total
Tests:       46 passed, 46 total
```

## Verdict

ALL 5 ACs PASS. This implementation is ready for Review.

Note: This is an Electron app — visual UI screenshots require a display server and are not captured in
this headless CI environment. All ACs are verified through unit tests and source inspection per the
implementation spec. The non-visual nature of AC1 loading spinner, AC2 model call, AC3 chunking,
and AC4 error banner are all covered by mocked unit tests that verify the behavior at the
function/IPC level.
