# Claude Subscription Auth — Design Spec
Date: 2026-06-28

## Problem
Cardify requires an Anthropic API key (paid per-token). Users with a Claude Pro or Max subscription have no way to use their existing subscription for card generation.

## Goal
Add a "Claude Account" auth option alongside the existing API key path. Users sign in via an in-app browser window (claude.ai login), the session cookie is stored encrypted, and card generation routes through whichever auth method is active. Both methods coexist; saving one clears the other.

---

## Architecture

### Auth Modes
Two mutually exclusive modes stored on disk:
- `api-key` — existing path, unchanged
- `claude-account` — new path using claude.ai session cookie

### Plan Auto-Detection (Claude Account path)
On first use after login, the app probes which API to use:
1. Try `api.anthropic.com/v1/messages` with `Authorization: Bearer <sessionKey>`
2. If HTTP 200 → **Claude Max** → use Anthropic SDK with Bearer token (same response shape as API key path)
3. If HTTP 4xx → **Claude Pro** → use claude.ai internal web API

Detected plan type is cached alongside the session so the probe only runs once.

---

## Components

### New: `src/lib/claudeWeb.js`
Implements card generation via the claude.ai internal API (Pro path).

Key steps:
1. `GET https://claude.ai/api/organizations` — fetch org ID
2. `POST https://claude.ai/api/organizations/{orgId}/chat_conversations` — create ephemeral conversation
3. `POST .../completion` — send message, consume SSE stream
4. Parse accumulated text as JSON card array (same normalisation as `claude.js`)

Exports `generateCardsWeb(parsedText, contextPrompt, cardFormat, sessionKey)` with the same return shape as `generateCards()`.

Throws `SessionExpiredError` (code `session-expired`) on 401/403.

### Modified: `electron/main.js`

**New storage helpers** (mirror of existing API key pattern):
- `getSessionFilePath()` — `userData/claude-session.enc`
- `getPlanCacheFilePath()` — `userData/claude-plan-cache.json` (plaintext, not sensitive)
- `readSession()` — decrypt and return `{ sessionKey, planType? }`
- `writeSession(data)` — encrypt and persist

**New IPC handlers:**
- `start-claude-login` — open BrowserWindow to `https://claude.ai`, poll cookies for `sessionKey`, close window, store encrypted; return `{ ok: true }` or `{ error: 'login-cancelled' }`
- `get-claude-session-set` — return boolean
- `clear-claude-session` — delete session file + plan cache

**Modified: `generate-cards` handler**
```
if api-key configured → existing path (no change)
if claude-session configured:
  detect plan (cached or probe)
  if Max → generateCards(..., sessionKey used as Bearer)
  if Pro → generateCardsWeb(..., sessionKey)
  on SessionExpiredError → return { error: 'session-expired' }
```

Saving either auth mode clears the other (enforced in `save-api-key` and `start-claude-login` handlers).

### Modified: `electron/preload.js`
Add three new whitelisted channels: `start-claude-login`, `get-claude-session-set`, `clear-claude-session`.

### Modified: `src/screens/Settings.jsx`
- Radio toggle at top: `○ API Key  ○ Claude Account`
- API Key section (existing UI, shown when API Key selected)
- Claude Account section (shown when Claude Account selected):
  - "Sign in with Claude" button → calls `start-claude-login`
  - Loading state during login window
  - Status: "● Account connected" or "○ Not signed in"
  - "Disconnect" button → calls `clear-claude-session`
- On mount: check both `get-api-key-set` and `get-claude-session-set` to set initial radio value

### Modified: `src/screens/Upload.jsx`
Handle new error code `session-expired` the same way `invalid-api-key` is handled — inline error banner: "Claude session expired — reconnect in Settings."

### Modified: `src/App.jsx`
Pass `authMode` ('api-key' | 'claude-account' | null) down to Upload so it can show the right warning when no auth is configured.

---

## Session Expiry
- `generate-cards` returns `{ error: 'session-expired' }` on 401
- Upload screen shows banner with link to Settings
- User clicks "Sign in with Claude" again in Settings to refresh

---

## Security
- `sessionKey` stored encrypted via Electron `safeStorage` (same as API key)
- Session file permissions: `0o600`
- Session key never sent to renderer; main process uses it internally for API calls
- Plan cache (`claude-plan-cache.json`) stores only `'max'` or `'pro'` string — not sensitive

---

## Out of Scope
- Token refresh (not applicable — session cookie, re-auth on expiry)
- Multiple accounts
- Persisting conversation history
