# QA Report — Issue #2 (v1)

**Issue:** [#2 — Build Settings screen with Claude API key storage via Electron safeStorage](https://github.com/BankNatchapol/Cardify/issues/2)
**PR:** [#7](https://github.com/BankNatchapol/Cardify/pull/7)
**Branch:** `issue-2-settings-api-key`
**Commit under test:** `d2529e2`
**Tester:** super-board QA worker
**Result:** ✅ PASS — all 5 ACs verified

## Scope

This is a non-visual ticket: Electron main-process IPC handlers, a React Settings
screen, and an encrypted-on-disk key file. The functional surface is fully
exercisable from Node/jest by inspecting the production sources for the required
wiring AND by running the storage primitives against a fake `safeStorage` that
mirrors the production contract. No browser/Electron window screenshots are
required by AC text; gating UI text (`"Add your Claude API key in Settings first"`)
is asserted as a literal in the source check.

## Test plan (one observable test per AC)

| AC  | Observable | Test | Result |
|-----|------------|------|--------|
| AC1 | Settings button in Upload header → opens `src/screens/Settings.jsx` | `tests/ac-verification-issue-2.test.js → AC1 block (3 tests)` | ✅ |
| AC2 | Password input + Save button + "API key is saved" indicator | `... → AC2 block (3 tests)` | ✅ |
| AC3 | Save invokes `save-api-key`, encrypts via `safeStorage.encryptString`, key never echoed back | `... → AC3 block (7 tests)` | ✅ |
| AC4 | After relaunch, `get-api-key-set` → true; UI shows "API key is saved" without displaying the key | `... → AC4 block (4 tests)` | ✅ |
| AC5 | Clear button calls `clear-api-key`, indicator resets to "No key saved" | `... → AC5 block (4 tests)` | ✅ |

Plus two cross-cutting tests that confirm Upload gating on `apiKeySet` and the
App-level refresh-on-navigation wiring required by the implementation notes in
the issue body.

## Test command + result

```
$ npm test
PASS tests/ac-verification-issue-2.test.js   (23 tests — new in this QA run)
PASS tests/api-key-storage.test.js           (10 tests — Builder's existing storage suite)
PASS tests/ac-verification.test.js           (24 tests — Task 1 ACs, unchanged)
PASS tests/parser.test.js                    ( 3 tests — unchanged)

Test Suites: 4 passed, 4 total
Tests:       60 passed, 60 total
```

Vite build sanity:

```
$ npx vite build
vite v5.4.21 building for production...
✓ 33 modules transformed.
✓ built in 505ms
```

## Key security checks (the heart of this ticket)

1. **No plaintext-readback channel exposed.** `electron/preload.js` whitelists
   `save-api-key`, `get-api-key-set`, `clear-api-key` — and **not** `get-api-key`.
   The Settings screen has no way to receive the raw key after saving. Asserted
   in AC3 tests.
2. **Save handler returns only `{ ok: true }`** — the test inspects the
   `ipcMain.handle('save-api-key', …)` body and asserts no `return key` / `key:
   key` leak. Asserted in AC3.
3. **Encrypted-at-rest behaviour matches the safeStorage contract.** The relaunch
   simulation writes via `safeStorage.encryptString` semantics and verifies the
   raw key string is **not** present in the on-disk bytes (existing Builder
   suite covers this directly; the new AC4 test re-runs the same primitive to
   keep this regression covered in the issue-scoped suite).
4. **Renderer-side state hygiene.** After a successful save, `Settings.jsx`
   resets `apiKey` state to `''` — so even renderer memory drops the plaintext
   after the IPC roundtrip. Asserted in AC3.

## Evidence

- This file: `docs/super-board/runs/issue-2-qa-v1/QA-REPORT.md`
- New test file added to the branch: `tests/ac-verification-issue-2.test.js`
- Existing storage suite (kept intact, re-run as part of the full suite): `tests/api-key-storage.test.js`

No screenshots: non-visual ACs (see super-board run.md §"For non-visual ACs …
skip the screenshot block but keep the evidence-path line").

## What "fixed should look like" (N/A — pass)

Not applicable; this is a pass-on-first-attempt QA exit. The Builder's
implementation already satisfies all five ACs as written.

## Local quota

`gh-quota-on-exit: graphql=unmeasured/5000 rest=unmeasured/5000`
(Worker did not burst gh calls; only the dispatcher and exit-time comment
posts touched the API.)
