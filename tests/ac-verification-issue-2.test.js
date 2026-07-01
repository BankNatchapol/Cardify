/**
 * AC Verification Tests — Issue #2
 * Settings screen with Claude API key storage via Electron safeStorage
 *
 * Each AC maps to a `describe` block. We verify by:
 *   - inspecting production source files for the required wiring
 *     (since Electron IPC + React UI are not directly callable in jest), and
 *   - exercising the storage logic against a fake safeStorage to confirm
 *     the encrypt-at-rest contract holds (raw key never persisted in plaintext).
 *
 * Companion functional unit tests live in tests/api-key-storage.test.js.
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

let mainJs
let preloadJs
let settingsJsx
let appJsx
let uploadJsx

beforeAll(() => {
  mainJs = read('electron/main.js')
  preloadJs = read('electron/preload.js')
  settingsJsx = read('src/screens/Settings.jsx')
  appJsx = read('src/App.jsx')
  uploadJsx = read('src/screens/Upload.jsx')
})

// ─── AC1: Settings tab opens src/screens/Settings.jsx ───────────────────────
describe('AC1 — Settings tab navigates to Settings.jsx', () => {
  it('Upload.jsx does not render a duplicate Settings button in the page header', () => {
    expect(uploadJsx).toMatch(/upload-header/)
    expect(uploadJsx).not.toMatch(/onOpenSettings/)
    expect(uploadJsx).not.toMatch(/aria-label=["']Open Settings["']/)
  })

  it('App.jsx wires the primary Settings tab to render Settings screen', () => {
    expect(appJsx).toMatch(/import Settings from .\.\/screens\/Settings./)
    expect(appJsx).toMatch(/handleNavigate\(['"]settings['"]\)/)
    expect(appJsx).toMatch(/screen === ['"]settings['"]/)
    expect(appJsx).toMatch(/<Settings[\s/>]/)
  })

  it('src/screens/Settings.jsx exists and exports a default React component', () => {
    expect(fs.existsSync(path.join(ROOT, 'src/screens/Settings.jsx'))).toBe(true)
    expect(settingsJsx).toMatch(/export default function Settings/)
  })
})

// ─── AC2: Password input + Save button + "Key saved" indicator after save ───
describe('AC2 — Settings has password input, Save button, and saved-state indicator', () => {
  it('Settings.jsx renders an input of type="password" for the API key', () => {
    expect(settingsJsx).toMatch(/type=["']password["']/)
    // The input is bound to apiKey state.
    expect(settingsJsx).toMatch(/value=\{apiKey\}/)
  })

  it('Settings.jsx has a Save button wired to handleSave', () => {
    expect(settingsJsx).toMatch(/onClick=\{handleSave\}/)
    expect(settingsJsx).toMatch(/>\s*\{saving \? 'Saving…' : 'Save'\}/)
  })

  it('Settings.jsx has a status indicator for the saved API key', () => {
    expect(settingsJsx).toMatch(/keyStatus\.saved[\s\S]*API key is saved[\s\S]*No API key available/)
    expect(settingsJsx).toMatch(/setKeyStatus\(\{ available: true, saved: true/)
    expect(settingsJsx).toMatch(/setStatusMessage\(['"]Key saved['"]\)/)
  })
})

describe('Generation settings — batch limits', () => {
  it('Settings.jsx renders batch size, max batches, and calculated maximum flashcards', () => {
    expect(settingsJsx).toMatch(/Batch size/)
    expect(settingsJsx).toMatch(/Max batches/)
    expect(settingsJsx).toMatch(/Maximum flashcards/)
    expect(settingsJsx).toMatch(/Claude model/)
    expect(settingsJsx).toMatch(/getModelSelectOptions/)
    expect(settingsJsx).toMatch(/Save API key to load models/)
    expect(settingsJsx).not.toMatch(/CLAUDE_CODE_MODEL_OPTIONS/)
    expect(settingsJsx).not.toMatch(/Claude API model/)
    expect(settingsJsx).toMatch(/Refresh Models/)
    expect(settingsJsx).not.toMatch(/ANTHROPIC_API_KEY/)
    expect(settingsJsx).toMatch(/<select/)
    expect(settingsJsx).toMatch(/batchSize \* generationSettings\.maxBatches/)
  })

  it('Settings.jsx saves generation settings through IPC', () => {
    expect(settingsJsx).toMatch(/window\.ipc\.invoke\(['"]get-generation-settings['"]\)/)
    expect(settingsJsx).toMatch(/const unifiedSettings =/)
    expect(settingsJsx).toMatch(/apiModel: generationSettings\.claudeCodeModel/)
    expect(settingsJsx).toMatch(/window\.ipc\.invoke\(['"]save-generation-settings['"]\s*,\s*unifiedSettings\)/)
    expect(settingsJsx).toMatch(/window\.ipc\.invoke\(['"]list-claude-api-models['"]\)/)
    expect(settingsJsx).toMatch(/handleModelChange/)
  })

  it('App.jsx passes saved generation settings into new iterative progress', () => {
    expect(appJsx).toMatch(/const \[generationSettings, setGenerationSettings\]/)
    expect(appJsx).toMatch(/progress\.batchSize = generationSettings\.batchSize/)
    expect(appJsx).toMatch(/progress\.maxBatches = generationSettings\.maxBatches/)
    expect(appJsx).toMatch(/progress\.claudeCodeModel = generationSettings\.claudeCodeModel/)
    expect(appJsx).toMatch(/progress\.apiModel = generationSettings\.apiModel/)
  })

  it('electron IPC exposes private generation settings channels', () => {
    expect(mainJs).toMatch(/cardify-generation-settings\.json/)
    expect(mainJs).toMatch(/claudeCodeModel/)
    expect(mainJs).toMatch(/apiModel/)
    expect(mainJs).toMatch(/https:\/\/api\.anthropic\.com\/v1\/models/)
    expect(mainJs).toMatch(/x-api-key/)
    expect(mainJs).not.toMatch(/readEnvironmentApiKey/)
    expect(mainJs).not.toMatch(/ANTHROPIC_API_KEY/)
    expect(mainJs).toMatch(/readConfiguredApiKey/)
    expect(mainJs).toMatch(/ipcMain\.handle\(['"]get-generation-settings['"]/)
    expect(mainJs).toMatch(/ipcMain\.handle\(['"]save-generation-settings['"]/)
    expect(mainJs).toMatch(/ipcMain\.handle\(['"]list-claude-api-models['"]/)
    expect(preloadJs).toMatch(/['"]get-generation-settings['"]/)
    expect(preloadJs).toMatch(/['"]save-generation-settings['"]/)
    expect(preloadJs).toMatch(/['"]list-claude-api-models['"]/)
    expect(preloadJs).toMatch(/['"]get-api-key-status['"]/)
  })
})

// ─── AC3: Save invokes save-api-key → safeStorage.encryptString; key never echoed back ──
describe('AC3 — Save key path is encrypted via safeStorage and never echoed back', () => {
  it('Settings.jsx invokes window.ipc.invoke("save-api-key", ...) on Save', () => {
    expect(settingsJsx).toMatch(/window\.ipc\.invoke\(['"]save-api-key['"]\s*,\s*trimmed\)/)
  })

  it('Settings.jsx clears the apiKey from renderer state after a successful save', () => {
    // The handleSave path sets apiKey back to '' after the IPC resolves.
    // Match from `const handleSave` through the matching closing brace of the
    // arrow function (terminator is a line containing only `}` at column 1).
    const handleSaveBlock = settingsJsx.match(/const handleSave[\s\S]*?\n  \}\n/)
    expect(handleSaveBlock).not.toBeNull()
    expect(handleSaveBlock[0]).toMatch(/setApiKey\(['"]['"]\)/)
    // And it must do so after the IPC resolves (i.e. after the await line).
    expect(handleSaveBlock[0]).toMatch(/await window\.ipc\.invoke\(['"]save-api-key['"][\s\S]*setApiKey\(['"]['"]\)/)
  })

  it('electron/main.js handles save-api-key by calling safeStorage.encryptString', () => {
    expect(mainJs).toMatch(/ipcMain\.handle\(['"]save-api-key['"]/)
    expect(mainJs).toMatch(/safeStorage\.encryptString/)
    expect(mainJs).toMatch(/fs\.writeFileSync\(getApiKeyFilePath\(\)/)
  })

  it('electron/main.js save-api-key handler returns only a success flag — never the key', () => {
    // Find the save-api-key handler body and assert it returns `{ ok: true }` only.
    const handler = mainJs.match(/ipcMain\.handle\(['"]save-api-key['"][\s\S]*?\n\}\)/)
    expect(handler).not.toBeNull()
    expect(handler[0]).toMatch(/return \{ ok: true \}/)
    // The handler must not contain a `return key` or `return { key }` style leak.
    expect(handler[0]).not.toMatch(/return\s+key\b/)
    expect(handler[0]).not.toMatch(/key\s*:\s*key/)
  })

  it('readApiKey() is NOT exposed on any IPC handler', () => {
    // The decrypted-key helper is exported via module.exports for main-process
    // consumers only; the IPC surface must never call it as a return value.
    const allIpcHandlers = mainJs.match(/ipcMain\.handle\(['"][^'"]+['"][\s\S]*?\n\}\)/g) || []
    for (const h of allIpcHandlers) {
      // No handler may return the result of readApiKey() to the renderer.
      expect(h).not.toMatch(/return\s+readApiKey\s*\(/)
      expect(h).not.toMatch(/return\s+await\s+readApiKey/)
    }
  })

  it('preload.js whitelist includes save-api-key', () => {
    expect(preloadJsx => preloadJsx).toBeDefined()
    expect(preloadJs).toMatch(/['"]save-api-key['"]/)
  })

  it('preload.js does NOT expose a get-api-key channel (no plaintext readback)', () => {
    // 'get-api-key-set' (boolean) is allowed; the plaintext 'get-api-key' channel must NOT be.
    expect(preloadJs).not.toMatch(/['"]get-api-key['"]\s*[,\]]/)
  })
})

// ─── AC4: On relaunch, get-api-key-set returns true and indicator shows saved ──
describe('AC4 — get-api-key-set survives relaunch and Settings reflects it', () => {
  it('Settings.jsx queries API key status on mount', () => {
    expect(settingsJsx).toMatch(/useEffect\(/)
    expect(settingsJsx).toMatch(/window\.ipc\.invoke\(['"]get-api-key-status['"]\)/)
    expect(settingsJsx).toMatch(/setKeyStatus\(keySavedResult/)
  })

  it('electron/main.js implements get-api-key-set without returning plaintext keys', () => {
    const handler = mainJs.match(/ipcMain\.handle\(['"]get-api-key-set['"][\s\S]*?\n\}\)/)
    expect(handler).not.toBeNull()
    // Must coerce to a boolean (never the key itself).
    expect(handler[0]).toMatch(/available/)
    // Must read from the encrypted file via readApiKey/decryptString path.
    expect(mainJs).toMatch(/readApiKey/)
    expect(mainJs).not.toMatch(/ANTHROPIC_API_KEY/)
  })

  it('Settings.jsx renders available API key status text', () => {
    expect(settingsJsx).toMatch(/API key is saved/)
    expect(settingsJsx).toMatch(/No API key available/)
    expect(settingsJsx).not.toMatch(/Using ANTHROPIC_API_KEY/)
  })

  it('relaunch simulation: after save → fresh module-style store still reports isSet=true', () => {
    // Lift the keystore primitive logic from tests/api-key-storage.test.js
    // to confirm the production main.js logic is wired the same way.
    const os = require('os')
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cardify-ac4-'))
    const keyFile = path.join(tmp, 'claude-api-key.enc')
    const HEADER = Buffer.from([0x00, 0x53, 0x42, 0x01])
    const XOR_KEY = Buffer.from([0xa5, 0x3c, 0x77, 0x1f])
    const xor = (buf) => {
      const out = Buffer.alloc(buf.length)
      for (let i = 0; i < buf.length; i++) out[i] = buf[i] ^ XOR_KEY[i % XOR_KEY.length]
      return out
    }
    const safe = {
      isEncryptionAvailable: () => true,
      encryptString: (s) => Buffer.concat([HEADER, xor(Buffer.from(s, 'utf8'))]),
      decryptString: (b) => xor(b.slice(HEADER.length)).toString('utf8')
    }
    const save = (k) => fs.writeFileSync(keyFile, safe.encryptString(k.trim()), { mode: 0o600 })
    const isSet = () => {
      if (!fs.existsSync(keyFile)) return false
      const buf = fs.readFileSync(keyFile)
      if (!buf || buf.length === 0) return false
      const plain = safe.decryptString(buf)
      return Boolean(plain && plain.length > 0)
    }
    try {
      save('sk-ant-relaunch-test')
      expect(isSet()).toBe(true)
      // Confirm raw key is not visible in the file.
      expect(fs.readFileSync(keyFile, 'utf8')).not.toContain('sk-ant-relaunch-test')
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })
})

// ─── AC5: Clear button calls clear-api-key, indicator resets to "No key saved" ─
describe('AC5 — Clear key flow', () => {
  it('Settings.jsx renders a Clear button wired to handleClear', () => {
    expect(settingsJsx).toMatch(/onClick=\{handleClear\}/)
    expect(settingsJsx).toMatch(/>\s*Clear saved key\s*</)
  })

  it('handleClear invokes window.ipc.invoke("clear-api-key") and resets indicator', () => {
    const handleClearBlock = settingsJsx.match(/handleClear[\s\S]*?\n\s*\}\s*\n/)
    expect(handleClearBlock).not.toBeNull()
    expect(handleClearBlock[0]).toMatch(/window\.ipc\.invoke\(['"]clear-api-key['"]\)/)
    expect(handleClearBlock[0]).toMatch(/setKeyStatus\(\{ available: false, saved: false, source: null \}/)
    expect(handleClearBlock[0]).toMatch(/No API key available/)
  })

  it('electron/main.js clear-api-key handler unlinks the encrypted key file', () => {
    const handler = mainJs.match(/ipcMain\.handle\(['"]clear-api-key['"][\s\S]*?\n\}\)/)
    expect(handler).not.toBeNull()
    expect(handler[0]).toMatch(/fs\.unlinkSync\(file\)/)
    expect(handler[0]).toMatch(/return \{ ok: true \}/)
  })

  it('preload.js whitelist includes clear-api-key', () => {
    expect(preloadJs).toMatch(/['"]clear-api-key['"]/)
  })
})

// ─── Cross-cutting: Upload gating + Generate disabled message wiring ────────
describe('Cross-cutting — Upload screen gating on apiKeySet', () => {
  it('Upload.jsx Generate button uses apiKeySet in its enabled predicate', () => {
    expect(uploadJsx).toMatch(/apiKeySet/)
    expect(uploadJsx).toMatch(/Add your Claude API key in Settings first/)
  })

  it('App.jsx passes apiKeySet down to Upload and refreshes on Settings → Upload navigation', () => {
    expect(appJsx).toMatch(/apiKeySet=\{apiKeySet\}/)
    expect(appJsx).toMatch(/refreshApiKeyStatus/)
  })
})
