# QA Report — Issue #5: Implement AnkiConnect Integration

**Date:** 2026-06-27
**QA version:** v1
**Branch:** issue-5-implement-ankiconnect-integration-to-push-confirmed-deck-to-anki
**PR:** #10
**Test suite:** tests/ac-verification-issue-5.test.js (17 new tests)

## Summary

All 5 Acceptance Criteria PASS. No bugs found.

Total test run: **96 tests / 6 suites — all green.**

## AC Results

| AC  | Description | Result | Evidence |
|-----|-------------|--------|----------|
| AC1 | Push to Anki calls IPC, shows spinner, shows success banner | PASS | Source inspection + unit tests |
| AC2 | createDeck called before addNotes (auto-creates deck) | PASS | Source inspection (position in main.js verified) |
| AC3 | Unreachable AnkiConnect → `{ error: 'anki-not-running' }` + correct renderer message | PASS | Unit test + source inspection |
| AC4 | Duplicate cards → "N cards added, M duplicates skipped" without failure | PASS | Unit test + source inspection |
| AC5 | npm test passes (testConnection + buildNotes unit tests) | PASS | 96/96 tests green |

## AC1 Detail

- `Review.jsx` calls `window.ipc.invoke('push-to-anki', { deckName: deckName.trim(), cards })` (source verified)
- Button renders `<span className="spinner">` + "Pushing to Anki..." while `pushing=true`
- Button has `disabled={pushing || !deckName.trim()}` and `aria-busy={pushing}`
- Success banner: `✓ ${msg}` where `msg = "${result.added} cards added to ${deckName}"` (no duplicates) or `"${added} cards added, ${duplicateCount} duplicates skipped"` (with duplicates)
- `data-testid="push-to-anki-btn"` and `data-testid="push-success-banner"` present

## AC2 Detail

- `electron/main.js` IPC handler for `push-to-anki`:
  1. `testConnection()` → if not connected, return `{ error: 'anki-not-running' }`
  2. `createDeck(deckName)` — idempotent, creates deck if missing
  3. `addNotes(deckName, cards)` — adds notes
  4. Returns `{ success: true, added, errors }`
- Source position verified: `createDeck` appears at index < `addNotes` in handler body

## AC3 Detail

- `testConnection()` returns `{ connected: false }` on any network error (ECONNREFUSED, timeout, TypeError)
- IPC handler returns `{ error: 'anki-not-running' }` when `connected === false`
- `Review.jsx` checks `result.error === 'anki-not-running'` and renders:
  `"Anki isn't running. Open Anki and make sure the AnkiConnect plugin is installed, then try again."`
- Error banner has `data-testid="anki-error-banner"` and `role="alert"`

## AC4 Detail

- `addNotes` in `ankiconnect.js`: null entries in AnkiConnect result array are pushed as `duplicate:${idx}` into `errors[]`, not counted in `added`
- `Review.jsx` counts `(pushResult.errors || []).filter(e => e.startsWith('duplicate:'))` → `duplicateCount`
- Banner text: `"${pushResult.added} cards added, ${duplicateCount} duplicates skipped"` (rendered in success banner, not error banner)

## AC5 Detail

- `tests/ankiconnect.test.js` — 19 unit tests: testConnection (4), buildNotes (9), createDeck (2), addNotes (4)
- This QA suite adds 17 more tests covering all ACs
- `npm test` result: 96 tests / 6 suites — all green

## Files Verified

- `src/lib/ankiconnect.js` — testConnection, createDeck, addNotes, buildNotes
- `electron/main.js` — push-to-anki and test-anki-connection IPC handlers
- `electron/preload.js` — push-to-anki and test-anki-connection in allowedChannels
- `src/screens/Review.jsx` — Push to Anki button, spinner, success/error banners, duplicate handling
- `tests/ankiconnect.test.js` — 19 unit tests

## Non-visual ACs note

This is a desktop Electron app. UI screenshots require a running Electron process
(not available in headless CI). AC1, AC3, AC4 renderer behavior was verified via
source-code inspection of Review.jsx and unit tests covering the underlying logic.
No screenshot capture was performed; this is intentional and documented.

## Test command

```
npm test
```

Result: 96 passed, 0 failed, 0 skipped
