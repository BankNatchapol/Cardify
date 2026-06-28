# Claude Subscription Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Claude Account" auth option to Cardify so users can sign in via their claude.ai Pro or Max subscription instead of (or in addition to) an Anthropic API key.

**Architecture:** Two mutually exclusive auth modes — `api-key` (unchanged) and `claude-account` (new). Saving one clears the other. On first use the app probes `api.anthropic.com` with the session key to detect Max vs Pro and caches the result. Max users route through the Anthropic SDK with Bearer token; Pro users route through the claude.ai internal web API (`src/lib/claudeWeb.js`). Session expiry surfaces as `{ error: 'session-expired' }`.

**Tech Stack:** Electron 31, React 18, `@anthropic-ai/sdk@0.27`, native `fetch` (Node 18+ / Chromium), Electron `safeStorage`, Electron `BrowserWindow`, Jest 29

## Global Constraints
- No new npm packages — use Node.js built-ins and existing dependencies only
- `sessionKey` never sent back to the renderer; main process only
- Session file permissions: `0o600`
- Electron `safeStorage` for all sensitive storage
- All new IPC channels must be whitelisted in `preload.js`
- `generate-cards` error shape: `{ error: 'invalid-api-key' }` or `{ error: 'session-expired' }`
- Saving either auth mode clears the other

---

### Task 1: `src/lib/claudeWeb.js` — claude.ai internal API client

**Files:**
- Create: `src/lib/claudeWeb.js`
- Create: `tests/claude-web.test.js`

**Interfaces:**
- Produces: `generateCardsWeb(parsedText, contextPrompt, cardFormat, sessionKey)` → `Promise<Array<{front,back,type}|{text,type}>>`
- Produces: `SessionExpiredError` class with `.code === 'session-expired'`

- [ ] **Step 1: Write the failing tests**

Create `tests/claude-web.test.js`:

```javascript
'use strict'

let fetchMock
beforeEach(() => {
  fetchMock = jest.fn()
  global.fetch = fetchMock
})

const { generateCardsWeb, SessionExpiredError } = require('../src/lib/claudeWeb')

describe('SessionExpiredError', () => {
  it('has code session-expired', () => {
    const err = new SessionExpiredError()
    expect(err.code).toBe('session-expired')
    expect(err.name).toBe('SessionExpiredError')
  })
})

describe('generateCardsWeb', () => {
  const SESSION = 'test-session-key'

  function makeOrgResponse () {
    return { ok: true, status: 200, json: async () => [{ uuid: 'org-123' }] }
  }

  function makeConvResponse () {
    return { ok: true, status: 200, json: async () => ({ uuid: 'conv-456' }) }
  }

  function makeCompletionResponse (cards) {
    const escaped = JSON.stringify(cards).replace(/"/g, '\\"')
    const sseBody = `data: {"completion":""}\ndata: {"completion":"${escaped}"}\n`
    return { ok: true, status: 200, text: async () => sseBody }
  }

  it('returns basic cards from a successful Pro response', async () => {
    const cards = [{ front: 'Q', back: 'A', type: 'basic' }]
    fetchMock
      .mockResolvedValueOnce(makeOrgResponse())
      .mockResolvedValueOnce(makeConvResponse())
      .mockResolvedValueOnce(makeCompletionResponse(cards))

    const result = await generateCardsWeb('some text', 'context here yes', 'basic', SESSION)
    expect(result).toEqual(cards)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('throws SessionExpiredError when org fetch returns 401', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) })
    await expect(generateCardsWeb('text', 'context here yes', 'basic', SESSION))
      .rejects.toThrow(SessionExpiredError)
  })

  it('throws SessionExpiredError when completion returns 401', async () => {
    fetchMock
      .mockResolvedValueOnce(makeOrgResponse())
      .mockResolvedValueOnce(makeConvResponse())
      .mockResolvedValueOnce({ ok: false, status: 401, text: async () => '' })
    await expect(generateCardsWeb('text', 'context here yes', 'basic', SESSION))
      .rejects.toThrow(SessionExpiredError)
  })

  it('handles new-format SSE (content_block_delta)', async () => {
    const cards = [{ text: '{{c1::Paris}} is the capital of France', type: 'cloze' }]
    const escaped = JSON.stringify(cards).replace(/"/g, '\\"')
    const sseBody = `data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"${escaped}"}}\n`
    fetchMock
      .mockResolvedValueOnce(makeOrgResponse())
      .mockResolvedValueOnce(makeConvResponse())
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => sseBody })

    const result = await generateCardsWeb('text', 'context here yes', 'cloze', SESSION)
    expect(result).toEqual(cards)
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- tests/claude-web.test.js
```
Expected: `Cannot find module '../src/lib/claudeWeb'`

- [ ] **Step 3: Implement `src/lib/claudeWeb.js`**

```javascript
'use strict'
const crypto = require('crypto')
const { chunkText, ParseError } = require('./claude')

const CLAUDE_WEB_BASE = 'https://claude.ai'

class SessionExpiredError extends Error {
  constructor () {
    super('Claude session expired — please reconnect in Settings')
    this.name = 'SessionExpiredError'
    this.code = 'session-expired'
  }
}

class ClaudeWebError extends Error {
  constructor (message) {
    super(message)
    this.name = 'ClaudeWebError'
    this.code = 'claude-web-error'
  }
}

function makeHeaders (sessionKey) {
  return {
    Cookie: `sessionKey=${sessionKey}`,
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: 'text/event-stream, application/json'
  }
}

async function getOrgId (sessionKey) {
  const res = await fetch(`${CLAUDE_WEB_BASE}/api/organizations`, {
    headers: makeHeaders(sessionKey)
  })
  if (res.status === 401 || res.status === 403) throw new SessionExpiredError()
  if (!res.ok) throw new ClaudeWebError(`Failed to fetch organizations: HTTP ${res.status}`)
  const orgs = await res.json()
  if (!Array.isArray(orgs) || orgs.length === 0) {
    throw new ClaudeWebError('No Claude organizations found for this account')
  }
  return orgs[0].uuid
}

async function createConversation (orgId, sessionKey) {
  const uuid = crypto.randomUUID()
  const res = await fetch(
    `${CLAUDE_WEB_BASE}/api/organizations/${orgId}/chat_conversations`,
    {
      method: 'POST',
      headers: makeHeaders(sessionKey),
      body: JSON.stringify({ uuid, name: '' })
    }
  )
  if (res.status === 401 || res.status === 403) throw new SessionExpiredError()
  if (!res.ok) throw new ClaudeWebError(`Failed to create conversation: HTTP ${res.status}`)
  const data = await res.json()
  return data.uuid || uuid
}

function buildWebPrompt (cardFormat, contextPrompt, textChunk) {
  const formatInstruction =
    cardFormat === 'basic'
      ? 'Basic: [{"front": "...", "back": "..."}]'
      : 'Cloze: [{"text": "{{c1::term}} is ..."}]'

  const instruction =
    `You are a flashcard generation expert. Generate ${cardFormat} flashcards from the text below.\n` +
    `Tune the cards to the user's context. Return ONLY a JSON array, no explanation:\n` +
    `- ${formatInstruction}\n\n` +
    `Context: ${contextPrompt}\nText: ${textChunk}`

  return `\n\nHuman: ${instruction}\n\nAssistant:`
}

async function collectSSE (response) {
  const text = await response.text()
  let fullText = ''

  for (const line of text.split('\n')) {
    if (!line.startsWith('data:')) continue
    const data = line.slice(5).trim()
    if (!data || data === '[DONE]') continue
    try {
      const event = JSON.parse(data)
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        fullText += event.delta.text
      } else if (typeof event.completion === 'string') {
        fullText += event.completion
      }
    } catch { /* skip non-JSON lines */ }
  }
  return fullText
}

async function callClaudeWeb (orgId, convId, cardFormat, contextPrompt, textChunk, sessionKey) {
  const prompt = buildWebPrompt(cardFormat, contextPrompt, textChunk)
  const res = await fetch(
    `${CLAUDE_WEB_BASE}/api/organizations/${orgId}/chat_conversations/${convId}/completion`,
    {
      method: 'POST',
      headers: makeHeaders(sessionKey),
      body: JSON.stringify({
        prompt,
        model: 'claude-sonnet-4-5',
        timezone: 'UTC',
        max_tokens_to_sample: 4096,
        attachments: [],
        files: []
      })
    }
  )
  if (res.status === 401 || res.status === 403) throw new SessionExpiredError()
  if (!res.ok) throw new ClaudeWebError(`Completion request failed: HTTP ${res.status}`)

  const rawText = await collectSSE(res)
  const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()

  let cards
  try {
    cards = JSON.parse(cleaned)
  } catch {
    throw new ParseError(rawText)
  }
  if (!Array.isArray(cards)) throw new ParseError(rawText)

  return cards.map(card =>
    cardFormat === 'basic'
      ? { front: String(card.front ?? ''), back: String(card.back ?? ''), type: 'basic' }
      : { text: String(card.text ?? ''), type: 'cloze' }
  )
}

async function generateCardsWeb (parsedText, contextPrompt, cardFormat, sessionKey) {
  const orgId = await getOrgId(sessionKey)
  const chunks = chunkText(parsedText)
  const results = []

  for (const chunk of chunks) {
    const convId = await createConversation(orgId, sessionKey)
    const cards = await callClaudeWeb(orgId, convId, cardFormat, contextPrompt, chunk, sessionKey)
    results.push(...cards)
  }

  return results
}

module.exports = { generateCardsWeb, SessionExpiredError, ClaudeWebError }
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test -- tests/claude-web.test.js
```
Expected: 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/claudeWeb.js tests/claude-web.test.js
git commit -m "feat: add claude.ai web API client for Pro subscription path"
```

---

### Task 2: Session storage + login IPC handlers in `electron/main.js`

**Files:**
- Modify: `electron/main.js`
- Create: `tests/session-storage.test.js`

**Interfaces:**
- Produces (internal helpers): `getSessionFilePath()`, `getPlanCacheFilePath()`, `readSession()`, `writeSession(data)`, `writePlanCache(planType)`, `clearSession()`
- Produces IPC handlers: `start-claude-login` → `{ ok: true } | { error: 'login-cancelled' }`, `get-claude-session-set` → `boolean`, `clear-claude-session` → `{ ok: true }`
- Modified: `save-api-key` now calls `clearSession()` on success

- [ ] **Step 1: Write the failing tests**

Create `tests/session-storage.test.js`:

```javascript
'use strict'
const path = require('path')
const os = require('os')
const fs = require('fs')

const XOR_KEY = [0xa5, 0x3c, 0x77, 0x1f]
const HEADER = [0x00, 0x53, 0x42, 0x02]

function makeFakeSafeStorage (available = true) {
  return {
    isEncryptionAvailable: () => available,
    encryptString (str) {
      const buf = Buffer.from(str, 'utf8')
      const out = Buffer.alloc(HEADER.length + buf.length)
      HEADER.forEach((b, i) => out.writeUInt8(b, i))
      buf.forEach((b, i) => out.writeUInt8(b ^ XOR_KEY[i % 4], HEADER.length + i))
      return out
    },
    decryptString (buf) {
      if (buf.length < HEADER.length) throw new Error('Too short')
      const out = Buffer.alloc(buf.length - HEADER.length)
      for (let i = 0; i < out.length; i++) {
        out.writeUInt8(buf.readUInt8(HEADER.length + i) ^ XOR_KEY[i % 4], i)
      }
      return out.toString('utf8')
    }
  }
}

function makeStore (tmpDir, fakeSS) {
  const getSessionFilePath = () => path.join(tmpDir, 'claude-session.enc')
  const getPlanCacheFilePath = () => path.join(tmpDir, 'claude-plan-cache.json')

  const readSession = () => {
    const file = getSessionFilePath()
    if (!fs.existsSync(file)) return null
    if (!fakeSS.isEncryptionAvailable()) throw new Error('Encryption unavailable')
    const encrypted = fs.readFileSync(file)
    if (!encrypted || encrypted.length === 0) return null
    const plain = fakeSS.decryptString(encrypted)
    return plain ? JSON.parse(plain) : null
  }

  const writeSession = (data) => {
    if (!fakeSS.isEncryptionAvailable()) throw new Error('Encryption unavailable')
    const encrypted = fakeSS.encryptString(JSON.stringify(data))
    fs.writeFileSync(getSessionFilePath(), encrypted, { mode: 0o600 })
  }

  const writePlanCache = (planType) => {
    fs.writeFileSync(getPlanCacheFilePath(), JSON.stringify({ planType }))
  }

  const clearSession = () => {
    const s = getSessionFilePath()
    if (fs.existsSync(s)) fs.unlinkSync(s)
    const c = getPlanCacheFilePath()
    if (fs.existsSync(c)) fs.unlinkSync(c)
  }

  return { readSession, writeSession, writePlanCache, clearSession, getSessionFilePath, getPlanCacheFilePath }
}

describe('session storage helpers', () => {
  let tmpDir, store

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cardify-session-test-'))
    store = makeStore(tmpDir, makeFakeSafeStorage())
  })

  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }))

  it('readSession returns null when no file exists', () => {
    expect(store.readSession()).toBeNull()
  })

  it('writeSession + readSession round-trips session data', () => {
    store.writeSession({ sessionKey: 'abc123', planType: 'pro' })
    expect(store.readSession()).toEqual({ sessionKey: 'abc123', planType: 'pro' })
  })

  it('session file does not contain the plaintext key', () => {
    store.writeSession({ sessionKey: 'my-secret-key' })
    const raw = fs.readFileSync(store.getSessionFilePath()).toString('utf8')
    expect(raw).not.toContain('my-secret-key')
  })

  it('clearSession removes session file and plan cache', () => {
    store.writeSession({ sessionKey: 'abc' })
    store.writePlanCache('pro')
    store.clearSession()
    expect(store.readSession()).toBeNull()
    expect(fs.existsSync(store.getPlanCacheFilePath())).toBe(false)
  })

  it('clearSession is no-op when no files exist', () => {
    expect(() => store.clearSession()).not.toThrow()
  })

  it('writePlanCache stores planType as JSON', () => {
    store.writePlanCache('max')
    const data = JSON.parse(fs.readFileSync(store.getPlanCacheFilePath(), 'utf8'))
    expect(data.planType).toBe('max')
  })
})
```

- [ ] **Step 2: Run tests to confirm they pass** (these test the pattern logic independently)

```bash
npm test -- tests/session-storage.test.js
```
Expected: 6 tests PASS

- [ ] **Step 3: Add session storage helpers to `electron/main.js`**

Add the following block after the existing `readApiKey()` function (around line 70), before the first `ipcMain.handle`:

```javascript
// ─────────────────────────────────────────────────────────────────────────────
// Claude session storage — encrypted at rest via Electron safeStorage.
// Stores { sessionKey: string } as JSON. Plan type cached separately (plaintext).
// ─────────────────────────────────────────────────────────────────────────────

function getSessionFilePath () {
  return path.join(app.getPath('userData'), 'claude-session.enc')
}

function getPlanCacheFilePath () {
  return path.join(app.getPath('userData'), 'claude-plan-cache.json')
}

function readSession () {
  const file = getSessionFilePath()
  if (!fs.existsSync(file)) return null
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Encryption is not available on this system')
  }
  const encrypted = fs.readFileSync(file)
  if (!encrypted || encrypted.length === 0) return null
  const plain = safeStorage.decryptString(encrypted)
  return plain && plain.length > 0 ? JSON.parse(plain) : null
}

function writeSession (data) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Encryption is not available on this system')
  }
  const encrypted = safeStorage.encryptString(JSON.stringify(data))
  fs.writeFileSync(getSessionFilePath(), encrypted, { mode: 0o600 })
}

function writePlanCache (planType) {
  fs.writeFileSync(getPlanCacheFilePath(), JSON.stringify({ planType }))
}

function clearSession () {
  const sessionFile = getSessionFilePath()
  if (fs.existsSync(sessionFile)) fs.unlinkSync(sessionFile)
  const cacheFile = getPlanCacheFilePath()
  if (fs.existsSync(cacheFile)) fs.unlinkSync(cacheFile)
}
```

- [ ] **Step 4: Update the `save-api-key` handler to clear session on save**

In `electron/main.js`, in the existing `save-api-key` handler, add `clearSession()` after `fs.writeFileSync(...)`:

```javascript
ipcMain.handle('save-api-key', async (_event, key) => {
  if (typeof key !== 'string' || key.trim().length === 0) {
    throw new Error('API key must be a non-empty string')
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Encryption is not available on this system')
  }
  const encrypted = safeStorage.encryptString(key.trim())
  fs.writeFileSync(getApiKeyFilePath(), encrypted, { mode: 0o600 })
  clearSession()   // ← add this line
  return { ok: true }
})
```

- [ ] **Step 5: Add the three new IPC handlers to `electron/main.js`**

Add after the existing `clear-api-key` handler:

```javascript
// ─────────────────────────────────────────────────────────────────────────────
// IPC: Claude Account login and session management
// ─────────────────────────────────────────────────────────────────────────────
ipcMain.handle('start-claude-login', async () => {
  return new Promise((resolve) => {
    let resolved = false
    let pollInterval = null

    const finish = (result) => {
      if (resolved) return
      resolved = true
      if (pollInterval) clearInterval(pollInterval)
      resolve(result)
    }

    const loginWindow = new BrowserWindow({
      width: 800,
      height: 700,
      title: 'Sign in to Claude',
      webPreferences: {
        partition: 'persist:claude-login',
        nodeIntegration: false,
        contextIsolation: true
      }
    })

    loginWindow.loadURL('https://claude.ai/login')

    const checkForSession = async () => {
      try {
        const cookies = await loginWindow.webContents.session.cookies.get({
          url: 'https://claude.ai',
          name: 'sessionKey'
        })
        if (cookies.length > 0 && cookies[0].value) {
          const sessionKey = cookies[0].value
          // Activating Claude Account clears any saved API key
          const apiKeyFile = getApiKeyFilePath()
          if (fs.existsSync(apiKeyFile)) fs.unlinkSync(apiKeyFile)
          writeSession({ sessionKey })
          finish({ ok: true })
          loginWindow.close()
        }
      } catch { /* window may be closing; ignore */ }
    }

    loginWindow.webContents.on('did-navigate', () => {
      if (pollInterval) clearInterval(pollInterval)
      pollInterval = setInterval(checkForSession, 500)
    })

    loginWindow.on('closed', () => {
      finish({ error: 'login-cancelled' })
    })
  })
})

ipcMain.handle('get-claude-session-set', async () => {
  try {
    const data = readSession()
    return Boolean(data && data.sessionKey)
  } catch {
    return false
  }
})

ipcMain.handle('clear-claude-session', async () => {
  clearSession()
  return { ok: true }
})
```

- [ ] **Step 6: Run existing tests to confirm nothing broke**

```bash
npm test
```
Expected: All existing tests PASS

- [ ] **Step 7: Commit**

```bash
git add electron/main.js tests/session-storage.test.js
git commit -m "feat: add Claude session storage and login/session IPC handlers"
```

---

### Task 3: Plan detection + `generate-cards` routing in `electron/main.js`

**Files:**
- Modify: `electron/main.js`
- Modify: `src/lib/claude.js`

**Interfaces:**
- Consumes: `readSession()`, `readApiKey()`, `writePlanCache()`, `clearSession()` (all from Task 2)
- Consumes: `generateCardsWeb` from `../src/lib/claudeWeb` (lazy require inside handler)
- Produces: modified `generateCards(parsedText, contextPrompt, cardFormat, apiKey, authToken?)` — `authToken` optional for Max Bearer path
- Produces: modified `generate-cards` IPC handler routing through both paths

- [ ] **Step 1: Add `authToken` support to `src/lib/claude.js`**

In `src/lib/claude.js`, modify the `generateCards` function to accept an optional fifth parameter:

```javascript
async function generateCards (parsedText, contextPrompt, cardFormat, apiKey, authToken = null) {
  const Anthropic = require('@anthropic-ai/sdk')
  let client
  if (authToken) {
    client = new Anthropic({
      apiKey: '_',
      defaultHeaders: { Authorization: `Bearer ${authToken}` }
    })
  } else {
    client = new Anthropic({ apiKey })
  }

  const chunks = chunkText(parsedText)
  const results = []

  for (const chunk of chunks) {
    const cards = await callClaude(client, cardFormat, contextPrompt, chunk)
    results.push(...cards)
  }

  return results
}
```

- [ ] **Step 2: Add `detectPlanType` helper to `electron/main.js`**

Add the following after `clearSession()` and before the first `ipcMain.handle(...)`:

```javascript
async function detectPlanType (sessionKey) {
  const cacheFile = getPlanCacheFilePath()
  if (fs.existsSync(cacheFile)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'))
      if (cached.planType === 'max' || cached.planType === 'pro') return cached.planType
    } catch { /* ignore corrupt cache */ }
  }

  // Probe api.anthropic.com — 200 → Max, 4xx → Pro
  let planType = 'pro'
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${sessionKey}`,
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }]
      }),
      signal: AbortSignal.timeout(5000)
    })
    if (res.status === 200) planType = 'max'
  } catch { /* network error — assume pro */ }

  writePlanCache(planType)
  return planType
}
```

- [ ] **Step 3: Replace the `generate-cards` IPC handler in `electron/main.js`**

Replace the entire existing `generate-cards` handler with:

```javascript
ipcMain.handle('generate-cards', async (_event, { parsedText, contextPrompt, cardFormat }) => {
  // ── API key path (existing behaviour, unchanged) ───────────────────────────
  let apiKey = null
  try { apiKey = readApiKey() } catch { /* ignore */ }

  if (apiKey) {
    try {
      const cards = await generateCards(parsedText, contextPrompt, cardFormat, apiKey)
      return cards
    } catch (err) {
      if (err instanceof ApiKeyError || err.code === 'invalid-api-key') {
        return { error: 'invalid-api-key' }
      }
      throw err
    }
  }

  // ── Claude Account path ────────────────────────────────────────────────────
  let sessionData = null
  try { sessionData = readSession() } catch { /* ignore */ }

  if (!sessionData || !sessionData.sessionKey) {
    return { error: 'invalid-api-key' }
  }

  const { sessionKey } = sessionData
  const planType = await detectPlanType(sessionKey)

  if (planType === 'max') {
    try {
      const cards = await generateCards(parsedText, contextPrompt, cardFormat, null, sessionKey)
      return cards
    } catch (err) {
      if (err.code === 'invalid-api-key' || err.status === 401) {
        // Bearer token rejected — downgrade to Pro and fall through
        writePlanCache('pro')
      } else {
        throw err
      }
    }
  }

  // Pro path: claude.ai internal API
  const { generateCardsWeb } = require('../src/lib/claudeWeb')
  try {
    const cards = await generateCardsWeb(parsedText, contextPrompt, cardFormat, sessionKey)
    return cards
  } catch (err) {
    if (err.code === 'session-expired') return { error: 'session-expired' }
    throw err
  }
})
```

- [ ] **Step 4: Run all tests to confirm nothing broke**

```bash
npm test
```
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add electron/main.js src/lib/claude.js
git commit -m "feat: add plan detection and generate-cards routing for Claude Account"
```

---

### Task 4: `electron/preload.js` — expose new IPC channels

**Files:**
- Modify: `electron/preload.js`

**Interfaces:**
- Produces: `window.ipc.invoke('start-claude-login')`, `window.ipc.invoke('get-claude-session-set')`, `window.ipc.invoke('clear-claude-session')` available in renderer

- [ ] **Step 1: Add three channels to the `allowedChannels` array**

In `electron/preload.js`, replace the `allowedChannels` array with:

```javascript
const allowedChannels = [
  'parse-file',
  'generate-cards',
  'push-to-anki',
  'test-anki-connection',
  'save-api-key',
  'get-api-key-set',
  'clear-api-key',
  'start-claude-login',
  'get-claude-session-set',
  'clear-claude-session'
]
```

- [ ] **Step 2: Run tests**

```bash
npm test
```
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add electron/preload.js
git commit -m "feat: expose Claude login IPC channels in preload whitelist"
```

---

### Task 5: `src/screens/Settings.jsx` — radio toggle + Claude Account section

**Files:**
- Modify: `src/screens/Settings.jsx`

- [ ] **Step 1: Replace `src/screens/Settings.jsx` with the new implementation**

```jsx
import React, { useEffect, useState } from 'react'

export default function Settings ({ onBack }) {
  const [authMode, setAuthMode] = useState('api-key')
  const [apiKey, setApiKey] = useState('')
  const [keySaved, setKeySaved] = useState(false)
  const [sessionSet, setSessionSet] = useState(false)
  const [saving, setSaving] = useState(false)
  const [loggingIn, setLoggingIn] = useState(false)
  const [statusMessage, setStatusMessage] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [keySavedResult, sessionSetResult] = await Promise.all([
          window.ipc.invoke('get-api-key-set'),
          window.ipc.invoke('get-claude-session-set')
        ])
        if (cancelled) return
        setKeySaved(Boolean(keySavedResult))
        setSessionSet(Boolean(sessionSetResult))
        if (sessionSetResult) setAuthMode('claude-account')
      } catch (err) {
        if (!cancelled) setError(`Could not check auth status: ${err.message}`)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const handleModeChange = (mode) => {
    setAuthMode(mode)
    setError(null)
    setStatusMessage(null)
  }

  const handleSave = async () => {
    setError(null)
    setStatusMessage(null)
    const trimmed = apiKey.trim()
    if (!trimmed) { setError('Please enter an API key before saving.'); return }
    setSaving(true)
    try {
      await window.ipc.invoke('save-api-key', trimmed)
      setApiKey('')
      setKeySaved(true)
      setSessionSet(false)
      setStatusMessage('Key saved')
    } catch (err) {
      setError(`Failed to save API key: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  const handleClear = async () => {
    setError(null)
    setStatusMessage(null)
    try {
      await window.ipc.invoke('clear-api-key')
      setApiKey('')
      setKeySaved(false)
      setStatusMessage('No key saved')
    } catch (err) {
      setError(`Failed to clear API key: ${err.message}`)
    }
  }

  const handleLogin = async () => {
    setError(null)
    setStatusMessage(null)
    setLoggingIn(true)
    try {
      const result = await window.ipc.invoke('start-claude-login')
      if (result && result.ok) {
        setSessionSet(true)
        setKeySaved(false)
        setStatusMessage('Account connected')
      } else {
        setError('Login was cancelled. Please try again.')
      }
    } catch (err) {
      setError(`Login failed: ${err.message}`)
    } finally {
      setLoggingIn(false)
    }
  }

  const handleDisconnect = async () => {
    setError(null)
    setStatusMessage(null)
    try {
      await window.ipc.invoke('clear-claude-session')
      setSessionSet(false)
      setStatusMessage('Disconnected')
    } catch (err) {
      setError(`Failed to disconnect: ${err.message}`)
    }
  }

  return (
    <div className="settings-screen">
      <header className="settings-header">
        <button type="button" className="back-btn" onClick={onBack} aria-label="Back to Upload">
          ← Back
        </button>
        <h1>Settings</h1>
      </header>

      <main className="settings-main">
        <div className="auth-mode-toggle" role="radiogroup" aria-label="Authentication method">
          <label className="radio-label">
            <input
              type="radio"
              name="auth-mode"
              value="api-key"
              checked={authMode === 'api-key'}
              onChange={() => handleModeChange('api-key')}
            />
            <span>API Key</span>
          </label>
          <label className="radio-label">
            <input
              type="radio"
              name="auth-mode"
              value="claude-account"
              checked={authMode === 'claude-account'}
              onChange={() => handleModeChange('claude-account')}
            />
            <span>Claude Account</span>
          </label>
        </div>

        {authMode === 'api-key' && (
          <section className="field-group">
            <label htmlFor="api-key-input" className="field-label">
              Claude API key
            </label>
            <input
              id="api-key-input"
              type="password"
              className="api-key-input"
              placeholder="sk-ant-..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
            <p className="field-hint">
              Stored encrypted on this device via Electron safeStorage. The key
              is never displayed back in this window after saving.
            </p>
            <div className="settings-actions">
              <button
                type="button"
                className="primary-btn"
                onClick={handleSave}
                disabled={saving || apiKey.trim().length === 0}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                className="secondary-btn"
                onClick={handleClear}
                disabled={!keySaved && !statusMessage}
              >
                Clear
              </button>
            </div>
            <section
              className={`status-indicator ${keySaved ? 'status-saved' : 'status-empty'}`}
              role="status"
              aria-live="polite"
            >
              <p>
                <span
                  className={`status-dot ${keySaved ? 'status-dot-ok' : 'status-dot-empty'}`}
                  aria-hidden="true"
                />
                {keySaved ? 'API key is saved' : 'No key saved'}
              </p>
              {statusMessage && <p className="status-message">{statusMessage}</p>}
            </section>
          </section>
        )}

        {authMode === 'claude-account' && (
          <section className="field-group">
            <p className="field-hint">
              Sign in with your Claude account (Pro or Max). Your session is
              stored encrypted on this device and never shared.
            </p>

            {sessionSet ? (
              <>
                <section
                  className="status-indicator status-saved"
                  role="status"
                  aria-live="polite"
                >
                  <p>
                    <span className="status-dot status-dot-ok" aria-hidden="true" />
                    Account connected
                  </p>
                  {statusMessage && <p className="status-message">{statusMessage}</p>}
                </section>
                <div className="settings-actions">
                  <button type="button" className="secondary-btn" onClick={handleDisconnect}>
                    Disconnect
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="settings-actions">
                  <button
                    type="button"
                    className="primary-btn"
                    onClick={handleLogin}
                    disabled={loggingIn}
                  >
                    {loggingIn ? 'Opening browser…' : 'Sign in with Claude'}
                  </button>
                </div>
                <section
                  className="status-indicator status-empty"
                  role="status"
                  aria-live="polite"
                >
                  <p>
                    <span className="status-dot status-dot-empty" aria-hidden="true" />
                    Not connected
                  </p>
                  {statusMessage && <p className="status-message">{statusMessage}</p>}
                </section>
              </>
            )}
          </section>
        )}

        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
      </main>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/screens/Settings.jsx
git commit -m "feat: add Claude Account auth mode to Settings screen"
```

---

### Task 6: `src/screens/Upload.jsx` — handle session-expired error

**Files:**
- Modify: `src/screens/Upload.jsx`

- [ ] **Step 1: Add `session-expired` handling in `handleGenerate`**

In `Upload.jsx`, in `handleGenerate`, after the `invalid-api-key` check add:

```javascript
if (result && result.error === 'invalid-api-key') {
  setGenerateError('Invalid API key — check Settings')
  return
}

if (result && result.error === 'session-expired') {
  setGenerateError('Claude session expired — reconnect your account in Settings')
  return
}
```

- [ ] **Step 2: Update the no-auth warning in the JSX**

Replace the existing `{!apiKeySet && ...}` block with:

```jsx
{!apiKeySet && (
  <p className="api-key-warning" role="status">
    Add your Claude API key or connect a Claude account in Settings first
  </p>
)}
```

- [ ] **Step 3: Commit**

```bash
git add src/screens/Upload.jsx
git commit -m "feat: handle session-expired error and update auth warning in Upload"
```

---

### Task 7: `src/App.jsx` — check both auth methods

**Files:**
- Modify: `src/App.jsx`

- [ ] **Step 1: Update `refreshApiKeyStatus` to check both API key and session**

In `App.jsx`, replace the body of `refreshApiKeyStatus`:

```javascript
const refreshApiKeyStatus = useCallback(async () => {
  try {
    const [keySaved, sessionSaved] = await Promise.all([
      window.ipc.invoke('get-api-key-set'),
      window.ipc.invoke('get-claude-session-set')
    ])
    setApiKeySet(Boolean(keySaved) || Boolean(sessionSaved))
  } catch {
    setApiKeySet(false)
  }
}, [])
```

- [ ] **Step 2: Run all tests**

```bash
npm test
```
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add src/App.jsx
git commit -m "feat: check both API key and Claude session for auth status"
```

---

## Verification

1. **Test suite:** `npm test` — all tests pass including the two new test files.

2. **Start dev app:** `npm run dev`

3. **API key path unchanged:** Settings → API Key tab → enter key → Save → back to Upload → Generate works as before.

4. **Claude Account login:** Settings → Claude Account tab → "Sign in with Claude" → log in to claude.ai in the popup → popup closes automatically → status shows "● Account connected".

5. **Mutual exclusivity:** With account connected, go to Settings → API Key → save a key → Claude Account tab → status shows "○ Not connected". And vice versa.

6. **Generate with Claude Account:** Upload a file → fill context → Generate → cards appear in Review.

7. **Session expiry simulation:** In `electron/main.js`, temporarily return `{ error: 'session-expired' }` from `generate-cards` — Upload should show "Claude session expired — reconnect your account in Settings".

8. **Disconnect:** Settings → Claude Account → Disconnect → status clears → Upload shows the auth warning.
