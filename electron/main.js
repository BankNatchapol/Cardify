const { app, BrowserWindow, ipcMain, safeStorage } = require('electron')
const path = require('path')
const fs = require('fs')
const { parseFile } = require('../src/lib/parser')

let mainWindow

function createWindow() {
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
// IPC: parse-file
// ─────────────────────────────────────────────────────────────────────────────
ipcMain.handle('parse-file', async (_event, filePath) => {
  return parseFile(filePath)
})

// ─────────────────────────────────────────────────────────────────────────────
// API key storage (Task 2) — encrypted at rest via Electron safeStorage.
// The raw plaintext key is read in the main process only; the renderer can
// only query whether a key is set, save a new one, or clear it. The key is
// never sent back to the renderer over IPC.
// ─────────────────────────────────────────────────────────────────────────────

/** Returns the absolute path to the encrypted key file inside userData. */
function getApiKeyFilePath() {
  return path.join(app.getPath('userData'), 'claude-api-key.enc')
}

/**
 * Internal main-process helper: returns the decrypted API key string, or null
 * if no key is saved. NEVER exposed via IPC to the renderer.
 */
function readApiKey() {
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

// Expose to other main-process modules (e.g. Task 3 claude.js) without ever
// crossing the IPC boundary.
module.exports = { readApiKey, getApiKeyFilePath }

ipcMain.handle('save-api-key', async (_event, key) => {
  if (typeof key !== 'string' || key.trim().length === 0) {
    throw new Error('API key must be a non-empty string')
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Encryption is not available on this system')
  }
  const encrypted = safeStorage.encryptString(key.trim())
  fs.writeFileSync(getApiKeyFilePath(), encrypted, { mode: 0o600 })
  // Intentionally return only success — never echo the key back.
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
// Stub handlers for future tasks
// ─────────────────────────────────────────────────────────────────────────────
ipcMain.handle('generate-cards', async (_event, _args) => {
  throw new Error('generate-cards not yet implemented — Task 3')
})

ipcMain.handle('push-to-anki', async (_event, _args) => {
  throw new Error('push-to-anki not yet implemented — Task 5')
})

ipcMain.handle('test-anki-connection', async () => {
  throw new Error('test-anki-connection not yet implemented — Task 5')
})
