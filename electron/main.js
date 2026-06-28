const { app, BrowserWindow, ipcMain, safeStorage, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const { parseFile } = require('../src/lib/parser')
const { generateCardsFromFile, ApiKeyError } = require('../src/lib/claude')
const { generateCardsClaudeCode, getClaudeCodeStatus } = require('../src/lib/claudeCode')
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
// Local project persistence — generated cards are saved before Anki push.
// ─────────────────────────────────────────────────────────────────────────────

function getProjectsFilePath () {
  return path.join(app.getPath('userData'), 'cardify-projects.json')
}

function readProjects () {
  const file = getProjectsFilePath()
  if (!fs.existsSync(file)) return []
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'))
    return Array.isArray(data.projects) ? data.projects : []
  } catch {
    return []
  }
}

function writeProjects (projects) {
  const file = getProjectsFilePath()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify({ projects }, null, 2), { mode: 0o600 })
}

function saveProject (project) {
  const now = new Date().toISOString()
  const projects = readProjects()
  const id = project.id || `project-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const existing = projects.findIndex(p => p.id === id)
  const nextProject = {
    ...project,
    id,
    updatedAt: now,
    createdAt: project.createdAt || (existing >= 0 ? projects[existing].createdAt : now)
  }
  if (existing >= 0) {
    projects[existing] = nextProject
  } else {
    projects.unshift(nextProject)
  }
  writeProjects(projects)
  return nextProject
}

function deleteProject (id) {
  const projects = readProjects().filter(project => project.id !== id)
  writeProjects(projects)
  return { ok: true }
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
// Output: Array<{front,back,type}> | Array<{text,type}>
//       | { error: 'claude-code-unavailable'|'invalid-api-key' }
// ─────────────────────────────────────────────────────────────────────────────
ipcMain.handle('generate-cards', async (_event, { filePath, contextPrompt, cardFormat }) => {
  let claudeCodeUnavailable = false
  try {
    return await generateCardsClaudeCode(filePath, contextPrompt, cardFormat)
  } catch (err) {
    if (err.code === 'claude-code-unavailable') {
      claudeCodeUnavailable = true
    } else if (err.code === 'claude-code-error' || err.code === 'parse-error') {
      throw err
    }
  }

  let apiKey = null
  try { apiKey = readApiKey() } catch { /* ignore */ }

  if (apiKey) {
    try {
      return await generateCardsFromFile(filePath, contextPrompt, cardFormat, apiKey)
    } catch (err) {
      if (err instanceof ApiKeyError || err.code === 'invalid-api-key') {
        return { error: 'invalid-api-key' }
      }
      throw err
    }
  }

  return { error: claudeCodeUnavailable ? 'claude-code-unavailable' : 'invalid-api-key' }
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

ipcMain.handle('get-claude-code-status', async () => {
  return getClaudeCodeStatus()
})

ipcMain.handle('save-project', async (_event, project) => {
  return saveProject(project)
})

ipcMain.handle('list-projects', async () => {
  return readProjects()
})

ipcMain.handle('get-latest-project', async () => {
  const projects = readProjects()
  return projects[0] || null
})

ipcMain.handle('delete-project', async (_event, id) => {
  return deleteProject(id)
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
// IPC: export-mobile-package
// Input:  { deckName, description, cards }
// Output: { ok: true, filePath } | { canceled: true }
// ─────────────────────────────────────────────────────────────────────────────
ipcMain.handle('export-mobile-package', async (_event, { deckName, description, cards }) => {
  const defaultName = (deckName || 'cardify-deck').replace(/[/\\:*?"<>|]/g, '-') + '.cardify.json'
  const { canceled, filePath: savePath } = await dialog.showSaveDialog({
    title: 'Export for Mobile',
    defaultPath: defaultName,
    filters: [{ name: 'Cardify Package', extensions: ['cardify.json'] }]
  })
  if (canceled || !savePath) return { canceled: true }

  const packageId = `pkg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const deckId = `deck-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  const notes = cards.map((card, i) => ({
    id: `note-${deckId}-${i}`,
    noteType: card.type === 'cloze' ? 'cloze' : 'basic',
    fields: card.type === 'cloze'
      ? { Front: card.text || '', Back: '' }
      : { Front: card.front || '', Back: card.back || '' },
    tags: [],
    source: {}
  }))

  const deckPackage = { packageId, deck: { id: deckId, name: deckName || 'Untitled', description }, notes }
  fs.writeFileSync(savePath, JSON.stringify(deckPackage, null, 2), 'utf-8')
  return { ok: true, filePath: savePath }
})

// ─────────────────────────────────────────────────────────────────────────────
// IPC: test-anki-connection  (Task 5)
// Output: { connected: boolean }
// ─────────────────────────────────────────────────────────────────────────────
ipcMain.handle('test-anki-connection', async () => {
  return testConnection()
})
