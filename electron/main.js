const { app, BrowserWindow, ipcMain, safeStorage } = require('electron')
const path = require('path')
const fs = require('fs')
const { parseFile } = require('../src/lib/parser')
const { generateCards, ApiKeyError } = require('../src/lib/claude')
const { testConnection, createDeck, addNotes } = require('../src/lib/ankiconnect')

let mainWindow

function createWindow () {
  mainWindow = new BrowserWindow({
    width: 1024,
    height: 768,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (process.env.NODE_ENV === 'development' || process.env.VITE_DEV_SERVER_URL) {
    const devUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173'
    mainWindow.loadURL(devUrl)
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/renderer/index.html'))
  }
}

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// API key storage helpers — encrypted at rest via Electron safeStorage.
// The raw plaintext key stays in the main process only and is never sent back
// to the renderer over IPC.
// ─────────────────────────────────────────────────────────────────────────────

/** Returns the absolute path to the encrypted key file inside userData. */
function getApiKeyFilePath () {
  return path.join(app.getPath('userData'), 'claude-api-key.enc')
}

/**
 * Internal main-process helper: returns the decrypted API key string, or null
 * if no key is saved. NEVER exposed via IPC to the renderer.
 */
function readApiKey () {
  const file = getApiKeyFilePath()
  if (!fs.existsSync(file)) return null
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Encryption is not available on this system')
  }
  const encrypted = fs.readFileSync(file)
  if (!encrypted || encrypted.length === 0) return null
  const plain = safeStorage.decryptString(encrypted)
  return plain && plain.length > 0 ? plain : null
}

// ─────────────────────────────────────────────────────────────────────────────
// IPC: parse-file
// ─────────────────────────────────────────────────────────────────────────────
ipcMain.handle('parse-file', async (_event, filePath) => {
  return parseFile(filePath)
})

// ─────────────────────────────────────────────────────────────────────────────
// IPC: generate-cards  (Task 3)
// Input:  { parsedText: string, contextPrompt: string, cardFormat: 'basic'|'cloze' }
// Output: Array<{front,back,type}> | Array<{text,type}> | { error: 'invalid-api-key' }
// ─────────────────────────────────────────────────────────────────────────────
ipcMain.handle('generate-cards', async (_event, { parsedText, contextPrompt, cardFormat }) => {
  let apiKey
  try {
    apiKey = readApiKey()
  } catch {
    return { error: 'invalid-api-key' }
  }

  if (!apiKey) {
    return { error: 'invalid-api-key' }
  }

  try {
    const cards = await generateCards(parsedText, contextPrompt, cardFormat, apiKey)
    return cards
  } catch (err) {
    if (err instanceof ApiKeyError || err.code === 'invalid-api-key') {
      return { error: 'invalid-api-key' }
    }
    throw err
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// IPC: API key management (Task 2)
// ─────────────────────────────────────────────────────────────────────────────
ipcMain.handle('save-api-key', async (_event, key) => {
  if (typeof key !== 'string' || key.trim().length === 0) {
    throw new Error('API key must be a non-empty string')
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Encryption is not available on this system')
  }
  const encrypted = safeStorage.encryptString(key.trim())
  fs.writeFileSync(getApiKeyFilePath(), encrypted, { mode: 0o600 })
  return { ok: true }
})

ipcMain.handle('get-api-key-set', async () => {
  try {
    const key = readApiKey()
    return Boolean(key)
  } catch {
    return false
  }
})

ipcMain.handle('clear-api-key', async () => {
  const file = getApiKeyFilePath()
  if (fs.existsSync(file)) {
    fs.unlinkSync(file)
  }
  return { ok: true }
})

// ─────────────────────────────────────────────────────────────────────────────
// IPC: push-to-anki  (Task 5)
// Input:  { deckName: string, cards: Array<card> }
// Output: { success: true, added: number, errors: string[] }
//       | { error: 'anki-not-running' }
// ─────────────────────────────────────────────────────────────────────────────
ipcMain.handle('push-to-anki', async (_event, { deckName, cards }) => {
  // 1. Test connectivity
  const { connected } = await testConnection()
  if (!connected) {
    return { error: 'anki-not-running' }
  }

  try {
    // 2. Ensure deck exists (createDeck is idempotent)
    await createDeck(deckName)

    // 3. Add notes — duplicates are counted, not errored
    const { added, errors } = await addNotes(deckName, cards)

    return { success: true, added, errors }
  } catch (err) {
    if (err.code === 'anki-not-running') {
      return { error: 'anki-not-running' }
    }
    throw err
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// IPC: test-anki-connection  (Task 5)
// Output: { connected: boolean }
// ─────────────────────────────────────────────────────────────────────────────
ipcMain.handle('test-anki-connection', async () => {
  return testConnection()
})
