const { app, BrowserWindow, ipcMain, safeStorage, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const { parseFile } = require('../src/lib/parser')
const { generateCards, generateCardsFromFile, prepareGeneration, generateSampleCards, generateDeckOverview, generateIterativeBatch, ApiKeyError } = require('../src/lib/claude')
const { generateCardsClaudeCode, prepareGenerationClaudeCode, generateSampleCardsClaudeCode, generateDeckOverviewClaudeCode, generateIterativeBatchClaudeCode, getClaudeCodeStatus } = require('../src/lib/claudeCode')
const { testConnection, createDeck, addNotes } = require('../src/lib/ankiconnect')
const { createDebugId, createGenerationLogger } = require('../src/lib/generationDebug')

const DEFAULT_CLAUDE_API_MODEL = 'claude-sonnet-4-6'
const ANTHROPIC_API_VERSION = '2023-06-01'

let mainWindow
const iterativeStops = new Set()
const activeGenerationControllers = new Set()
const iterativeControllers = new Map()
const generationLogger = createGenerationLogger({ fs, path, app })

function createGenerationController (scope = 'generation') {
  const controller = new AbortController()
  const entry = { scope, controller }
  activeGenerationControllers.add(entry)
  return {
    signal: controller.signal,
    done: () => activeGenerationControllers.delete(entry)
  }
}

function cancelActiveGenerations (scope = null) {
  let count = 0
  for (const entry of [...activeGenerationControllers]) {
    if (scope && entry.scope !== scope) continue
    entry.controller.abort()
    count += 1
  }
  return count
}

function cardDuplicateKey (card) {
  if (!card) return ''
  return card.type === 'cloze'
    ? `cloze:${card.text || ''}`
    : `basic:${card.front || ''}\n${card.back || ''}`
}

function normalizeGenerationProgress (progress = {}) {
  const batchSize = Number(progress.batchSize) || 10
  const maxBatches = Number(progress.maxBatches) || 20
  const acceptedSampleCards = Array.isArray(progress.acceptedSampleCards) ? progress.acceptedSampleCards : []
  const duplicateKeys = Array.isArray(progress.duplicateKeys)
    ? progress.duplicateKeys.map(key => String(key || '')).filter(Boolean)
    : acceptedSampleCards.map(cardDuplicateKey).filter(Boolean)

  return {
    mode: 'iterative',
    status: progress.status || 'in_progress',
    batchSize,
    maxBatches,
    completedBatches: Number(progress.completedBatches) || 0,
    coverageHistory: Array.isArray(progress.coverageHistory) ? progress.coverageHistory : [],
    clarifiedContext: String(progress.clarifiedContext || ''),
    sampleFeedback: String(progress.sampleFeedback || ''),
    acceptedSampleCards,
    duplicateKeys
  }
}

function dedupeBatchCards (cards = [], duplicateKeys = []) {
  const seen = new Set(duplicateKeys)
  const fresh = []
  for (const card of Array.isArray(cards) ? cards : []) {
    const key = cardDuplicateKey(card)
    if (!key || seen.has(key)) continue
    seen.add(key)
    fresh.push(card)
  }
  return { cards: fresh, duplicateKeys: [...seen] }
}

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

function readConfiguredApiKey () {
  const savedKey = readApiKey()
  if (savedKey) return { key: savedKey, source: 'saved' }
  return null
}

function getApiKeyStatus () {
  let saved = false
  try {
    saved = Boolean(readApiKey())
  } catch {
    saved = false
  }
  return {
    available: saved,
    saved,
    source: saved ? 'saved' : null
  }
}

function normalizeModelInfo (model) {
  if (!model || typeof model !== 'object') return null
  const id = String(model.id || '').trim()
  if (!id) return null
  return {
    id,
    displayName: String(model.display_name || model.displayName || id).trim() || id,
    createdAt: String(model.created_at || model.createdAt || ''),
    maxInputTokens: Number.isFinite(Number(model.max_input_tokens)) ? Number(model.max_input_tokens) : null,
    maxTokens: Number.isFinite(Number(model.max_tokens)) ? Number(model.max_tokens) : null
  }
}

async function listClaudeApiModels () {
  const configuredKey = readConfiguredApiKey()
  if (!configuredKey) return { models: [], error: 'no-api-key' }

  const models = []
  let afterId = null
  for (let page = 0; page < 20; page++) {
    const url = new URL('https://api.anthropic.com/v1/models')
    if (afterId) url.searchParams.set('after_id', afterId)
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'x-api-key': configuredKey.key,
        'anthropic-version': ANTHROPIC_API_VERSION
      }
    })

    if (!response.ok) {
      if (response.status === 401) return { models: [], error: 'invalid-api-key' }
      return { models: [], error: 'models-unavailable', message: `Could not load Claude models (${response.status})` }
    }

    const payload = await response.json()
    for (const model of Array.isArray(payload?.data) ? payload.data : []) {
      const normalized = normalizeModelInfo(model)
      if (normalized) models.push(normalized)
    }
    if (!payload?.has_more || !payload?.last_id) break
    afterId = payload.last_id
  }

  const unique = Array.from(new Map(models.map(model => [model.id, model])).values())
  unique.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
  return { models: unique, keySource: configuredKey.source }
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

function defaultGenerationSettings () {
  return {
    batchSize: 10,
    maxBatches: 20,
    claudeCodeModel: 'default',
    apiModel: DEFAULT_CLAUDE_API_MODEL
  }
}

function normalizeGenerationSettings (settings = {}) {
  const defaults = defaultGenerationSettings()
  const batchSize = Math.min(50, Math.max(1, Number.parseInt(settings.batchSize, 10) || defaults.batchSize))
  const maxBatches = Math.min(100, Math.max(1, Number.parseInt(settings.maxBatches, 10) || defaults.maxBatches))
  const claudeCodeModel = String(settings.claudeCodeModel || defaults.claudeCodeModel).trim() || defaults.claudeCodeModel
  const apiModel = String(settings.apiModel || defaults.apiModel).trim() || defaults.apiModel
  return { batchSize, maxBatches, claudeCodeModel, apiModel }
}

function getGenerationSettingsFilePath () {
  return path.join(app.getPath('userData'), 'cardify-generation-settings.json')
}

function readGenerationSettings () {
  const file = getGenerationSettingsFilePath()
  if (!fs.existsSync(file)) return defaultGenerationSettings()
  try {
    return normalizeGenerationSettings(JSON.parse(fs.readFileSync(file, 'utf8')))
  } catch {
    return defaultGenerationSettings()
  }
}

function writeGenerationSettings (settings) {
  const normalized = normalizeGenerationSettings(settings)
  const file = getGenerationSettingsFilePath()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(normalized, null, 2), { mode: 0o600 })
  return normalized
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

function isParseError (err) {
  return err?.code === 'parse-error' || err?.name === 'ParseError' || /Failed to parse Claude response as JSON/i.test(err?.message || '')
}

function writeGenerationLog (record) {
  try {
    generationLogger.write(record)
  } catch {
    // Debug logging must never break generation.
  }
}

function parseErrorLogFields (err) {
  return {
    error: err,
    stdout: err?.raw || err?.stdout,
    stderr: err?.stderr
  }
}

function generationParseErrorResponse (debugId) {
  return {
    error: 'generation-parse-error',
    debugId,
    message: 'Claude returned a response Cardify could not read as cards. Try Generate again. If it keeps happening, simplify the context prompt or add an API key fallback in Settings.'
  }
}

function sampleParseErrorResponse (debugId) {
  return {
    error: 'generation-parse-error',
    debugId,
    message: 'Claude returned sample cards in a format Cardify could not read. Try Regenerate Samples.'
  }
}

function claudeCodeTimeoutResponse (err) {
  return {
    error: 'claude-code-timeout',
    message: `${err?.message || 'Claude Code timed out while generating cards'}. Try again with a smaller project, or raise CARDIFY_CLAUDE_CODE_TIMEOUT_MS before starting Cardify.`
  }
}

function generationCancelledResponse () {
  return {
    error: 'generation-cancelled',
    message: 'Generation was cancelled.'
  }
}

function contextMentionsLanguagePreference (contextPrompt = '') {
  return /\b(language|english|thai|ไทย|อังกฤษ|chinese|จีน|mandarin|spanish|japanese|korean|french|german|bilingual|translate|translation)\b/i.test(contextPrompt)
}

function fallbackClarificationResponse (contextPrompt, clarificationHistory = []) {
  const answered = Array.isArray(clarificationHistory) ? clarificationHistory.length : 0
  if (answered > 0) {
    return {
      status: 'clear',
      clarifiedContext: [
        contextPrompt,
        'Clarification answers:',
        ...clarificationHistory.map(item => `Q: ${item.question || ''}\nA: ${item.answer || ''}`)
      ].filter(Boolean).join('\n')
    }
  }

  const questions = contextMentionsLanguagePreference(contextPrompt)
    ? [
        'Who is this deck for, and what level or exam/use case should it target?',
        'What should Cardify emphasize or avoid when making the cards?'
      ]
    : [
        'What language or mix of languages should Cardify use for the card prompts, explanations, and examples?',
        'Who is this deck for, and what level or exam/use case should it target?'
      ]

  return {
    status: 'questions',
    questions
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// IPC: parse-file
// ─────────────────────────────────────────────────────────────────────────────
ipcMain.handle('parse-file', async (_event, filePath) => {
  return parseFile(filePath)
})

async function runWithClaudeFallback (claudeCodeFn, apiFn, context = {}) {
  let claudeCodeUnavailable = false
  let claudeCodeParseError = null
  const debugId = context.debugId || createDebugId()
  writeGenerationLog({
    ...context,
    debugId,
    provider: 'claude-code',
    status: 'start'
  })
  try {
    const result = await claudeCodeFn()
    writeGenerationLog({
      ...context,
      debugId,
      provider: 'claude-code',
      status: 'success',
      cardCount: Array.isArray(result?.cards) ? result.cards.length : undefined
    })
    return result
  } catch (err) {
    if (err.code === 'claude-code-unavailable') {
      claudeCodeUnavailable = true
    } else if (isParseError(err)) {
      claudeCodeParseError = err
      writeGenerationLog({
        ...context,
        ...parseErrorLogFields(err),
        debugId,
        provider: 'claude-code',
        status: 'parse-error'
      })
    } else if (err.code === 'claude-code-timeout') {
      return claudeCodeTimeoutResponse(err)
    } else if (err.code === 'generation-cancelled' || err.name === 'AbortError') {
      return generationCancelledResponse()
    } else if (err.code === 'claude-code-error') {
      throw err
    } else {
      throw err
    }
  }

  let configuredKey = null
  try { configuredKey = readConfiguredApiKey() } catch { /* ignore */ }

  if (configuredKey?.key) {
    writeGenerationLog({
      ...context,
      debugId,
      provider: 'anthropic-api',
      status: 'fallback-start'
    })
    try {
      const result = await apiFn(configuredKey.key)
      writeGenerationLog({
        ...context,
        debugId,
        provider: 'anthropic-api',
        status: 'success',
        cardCount: Array.isArray(result?.cards) ? result.cards.length : undefined
      })
      return result
    } catch (err) {
      if (err instanceof ApiKeyError || err.code === 'invalid-api-key') {
        return { error: 'invalid-api-key' }
      }
      if (err.code === 'generation-cancelled' || err.name === 'AbortError') {
        return generationCancelledResponse()
      }
      if (isParseError(err)) {
        writeGenerationLog({
          ...context,
          ...parseErrorLogFields(err),
          debugId,
          provider: 'anthropic-api',
          status: 'parse-error'
        })
        return generationParseErrorResponse(debugId)
      }
      throw err
    }
  }

  if (claudeCodeParseError) {
    return generationParseErrorResponse(debugId)
  }

  return { error: claudeCodeUnavailable ? 'claude-code-unavailable' : 'invalid-api-key' }
}

ipcMain.handle('prepare-generation', async (_event, { filePath, parsedText, contextPrompt, cardFormat, clarificationHistory }) => {
  const sourceText = typeof parsedText === 'string' && parsedText.trim().length > 0 ? parsedText : null
  const debugId = createDebugId('prepare')
  const generation = createGenerationController('prepare')
  const generationSettings = readGenerationSettings()
  const context = {
    debugId,
    stage: 'prepare-generation',
    cardFormat,
    sourceLength: sourceText?.length,
    contextLength: String(contextPrompt || '').length,
    clarificationCount: Array.isArray(clarificationHistory) ? clarificationHistory.length : 0
  }
  try {
    const claudeCodeOptions = { signal: generation.signal, claudeCodeModel: generationSettings.claudeCodeModel }
    const result = await runWithClaudeFallback(
      () => prepareGenerationClaudeCode(filePath, contextPrompt, cardFormat, sourceText, clarificationHistory || [], claudeCodeOptions),
      async (apiKey) => prepareGeneration(sourceText || await parseFile(filePath), contextPrompt, cardFormat, apiKey, clarificationHistory || [], { signal: generation.signal, apiModel: generationSettings.apiModel }),
      context
    )
    if (result?.error === 'generation-parse-error') {
      return fallbackClarificationResponse(contextPrompt, clarificationHistory || [])
    }
    return result
  } finally {
    generation.done()
  }
})

ipcMain.handle('generate-sample-cards', async (_event, { filePath, parsedText, contextPrompt, cardFormat, clarifiedContext, acceptedSampleCards, previousSampleCards, sampleFeedbackHistory, sampleFeedback }) => {
  const sourceText = typeof parsedText === 'string' && parsedText.trim().length > 0 ? parsedText : null
  const debugId = createDebugId('sample')
  const generation = createGenerationController('sample')
  const generationSettings = readGenerationSettings()
  const context = {
    debugId,
    stage: 'generate-sample-cards',
    cardFormat,
    sourceLength: sourceText?.length,
    contextLength: String(contextPrompt || '').length,
    clarifiedContextLength: String(clarifiedContext || '').length,
    acceptedSampleCount: Array.isArray(acceptedSampleCards) ? acceptedSampleCards.length : 0,
    previousSampleCount: Array.isArray(previousSampleCards) ? previousSampleCards.length : 0,
    sampleFeedbackHistoryCount: Array.isArray(sampleFeedbackHistory) ? sampleFeedbackHistory.length : 0,
    sampleFeedbackLength: String(sampleFeedback || '').length
  }
  const options = {
    clarifiedContext,
    sampleCards: acceptedSampleCards,
    previousSampleCards,
    sampleFeedbackHistory,
    sampleFeedback,
    signal: generation.signal,
    claudeCodeModel: generationSettings.claudeCodeModel,
    apiModel: generationSettings.apiModel,
    debugLog: record => writeGenerationLog({ ...context, ...record, debugId })
  }
  try {
    const result = await runWithClaudeFallback(
      () => generateSampleCardsClaudeCode(filePath, contextPrompt, cardFormat, sourceText, options),
      async (apiKey) => generateSampleCards(sourceText || await parseFile(filePath), contextPrompt, cardFormat, apiKey, options),
      context
    )
    if (result?.error === 'generation-parse-error') {
      return sampleParseErrorResponse(result.debugId || debugId)
    }
    return result
  } finally {
    generation.done()
  }
})

ipcMain.handle('generate-deck-overview', async (_event, { filePath, parsedText, contextPrompt, cardFormat, clarifiedContext, acceptedSampleCards, sampleFeedbackHistory }) => {
  const sourceText = typeof parsedText === 'string' && parsedText.trim().length > 0 ? parsedText : null
  const debugId = createDebugId('overview')
  const generation = createGenerationController('overview')
  const generationSettings = readGenerationSettings()
  const context = {
    debugId,
    stage: 'generate-deck-overview',
    cardFormat,
    sourceLength: sourceText?.length,
    contextLength: String(contextPrompt || '').length,
    clarifiedContextLength: String(clarifiedContext || '').length,
    acceptedSampleCount: Array.isArray(acceptedSampleCards) ? acceptedSampleCards.length : 0,
    sampleFeedbackHistoryCount: Array.isArray(sampleFeedbackHistory) ? sampleFeedbackHistory.length : 0
  }
  const options = {
    clarifiedContext,
    sampleCards: acceptedSampleCards,
    sampleFeedbackHistory,
    sampleFeedback: Array.isArray(sampleFeedbackHistory) ? sampleFeedbackHistory.join('\n') : '',
    signal: generation.signal,
    claudeCodeModel: generationSettings.claudeCodeModel,
    apiModel: generationSettings.apiModel
  }
  try {
    return await runWithClaudeFallback(
      () => generateDeckOverviewClaudeCode(filePath, contextPrompt, cardFormat, sourceText, options),
      async (apiKey) => generateDeckOverview(sourceText || await parseFile(filePath), contextPrompt, cardFormat, apiKey, options),
      context
    )
  } finally {
    generation.done()
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// IPC: generate-cards  (Task 3)
// Input:  { parsedText: string, contextPrompt: string, cardFormat: 'basic'|'cloze' }
// Output: Array<{front,back,type}> | Array<{text,type}>
//       | { error: 'claude-code-unavailable'|'invalid-api-key' }
// ─────────────────────────────────────────────────────────────────────────────
ipcMain.handle('generate-cards', async (_event, { filePath, parsedText, contextPrompt, cardFormat, clarifiedContext, sampleCards, sampleFeedback }) => {
  const sourceText = typeof parsedText === 'string' && parsedText.trim().length > 0 ? parsedText : null
  const generation = createGenerationController('cards')
  const generationSettings = readGenerationSettings()
  const options = {
    clarifiedContext,
    sampleCards,
    sampleFeedback,
    signal: generation.signal,
    claudeCodeModel: generationSettings.claudeCodeModel,
    apiModel: generationSettings.apiModel
  }
  const context = {
    debugId: createDebugId('cards'),
    stage: 'generate-cards',
    cardFormat,
    sourceLength: sourceText?.length,
    contextLength: String(contextPrompt || '').length,
    sampleCount: Array.isArray(sampleCards) ? sampleCards.length : 0,
    sampleFeedbackLength: String(sampleFeedback || '').length
  }
  try {
    return await runWithClaudeFallback(
      () => generateCardsClaudeCode(filePath, contextPrompt, cardFormat, sourceText, options),
      (apiKey) => {
        if (sourceText) {
          return generateCards(sourceText, contextPrompt, cardFormat, apiKey, options)
        }
        return generateCardsFromFile(filePath, contextPrompt, cardFormat, apiKey, options)
      },
      context
    )
  } finally {
    generation.done()
  }
})

ipcMain.handle('stop-iterative-generation', async (_event, { projectId }) => {
  if (projectId) iterativeStops.add(projectId)
  const controller = projectId ? iterativeControllers.get(projectId) : null
  if (controller) controller.abort()
  return { ok: true }
})

ipcMain.handle('cancel-generation', async (_event, { scope } = {}) => {
  const count = cancelActiveGenerations(scope || null)
  return { ok: true, cancelled: count }
})

ipcMain.handle('start-iterative-generation', async (event, { projectId, filePath, parsedText, contextPrompt, cardFormat, generationProgress }) => {
  const sourceText = typeof parsedText === 'string' && parsedText.trim().length > 0 ? parsedText : null
  const generationSettings = readGenerationSettings()
  let progress = normalizeGenerationProgress({ ...generationProgress, status: 'in_progress' })
  progress = {
    ...progress,
    claudeCodeModel: generationProgress?.claudeCodeModel || generationSettings.claudeCodeModel,
    apiModel: generationProgress?.apiModel || generationSettings.apiModel
  }
  const id = projectId || `iterative-${Date.now()}`
  iterativeStops.delete(id)

  for (let index = progress.completedBatches; index < progress.maxBatches; index++) {
    if (iterativeStops.has(id)) {
      progress = { ...progress, status: 'stopped' }
      event.sender.send('generation-batch', {
        projectId: id,
        batchNumber: progress.completedBatches,
        maxBatches: progress.maxBatches,
        cards: [],
        coverage: null,
        status: 'stopped',
        generationProgress: progress
      })
      iterativeStops.delete(id)
      return { status: 'stopped', generationProgress: progress }
    }

    const batchNumber = progress.completedBatches + 1
    const controller = new AbortController()
    iterativeControllers.set(id, controller)
    const runProgress = { ...progress, signal: controller.signal }
    let result
    try {
      result = await runWithClaudeFallback(
        () => generateIterativeBatchClaudeCode(filePath, contextPrompt, cardFormat, sourceText, runProgress),
        async (apiKey) => generateIterativeBatch(sourceText || await parseFile(filePath), contextPrompt, cardFormat, apiKey, runProgress),
        {
          debugId: createDebugId(`batch-${batchNumber}`),
          stage: 'start-iterative-generation',
          batchNumber,
          cardFormat,
          sourceLength: sourceText?.length,
          contextLength: String(contextPrompt || '').length,
          completedBatches: progress.completedBatches,
          duplicateKeyCount: progress.duplicateKeys.length,
          coverageHistoryCount: progress.coverageHistory.length
        }
      )
    } catch (err) {
      const status = err.code === 'generation-cancelled' || err.name === 'AbortError' ? 'stopped' : 'failed'
      progress = { ...progress, status }
      event.sender.send('generation-batch', {
        projectId: id,
        batchNumber,
        maxBatches: progress.maxBatches,
        cards: [],
        coverage: null,
        status,
        error: err.message,
        generationProgress: progress
      })
      iterativeStops.delete(id)
      iterativeControllers.delete(id)
      return { status, error: err.message, generationProgress: progress }
    } finally {
      if (iterativeControllers.get(id) === controller) {
        iterativeControllers.delete(id)
      }
    }

    if (result?.error) {
      const status = result.error === 'generation-cancelled' ? 'stopped' : 'failed'
      progress = { ...progress, status }
      event.sender.send('generation-batch', {
        projectId: id,
        batchNumber,
        maxBatches: progress.maxBatches,
        cards: [],
        coverage: null,
        status,
        error: result.message || result.error,
        generationProgress: progress
      })
      iterativeStops.delete(id)
      return { status, error: result.message || result.error, generationProgress: progress }
    }

    const deduped = dedupeBatchCards(result.cards, progress.duplicateKeys)
    const coverage = result.coverage || { batchSummary: '', coveredTopics: [], remainingFocus: '', done: false }
    const nextStatus = coverage.done
      ? 'done'
      : batchNumber >= progress.maxBatches
        ? 'capped'
        : 'in_progress'
    progress = {
      ...progress,
      status: nextStatus,
      completedBatches: batchNumber,
      coverageHistory: [...progress.coverageHistory, coverage],
      duplicateKeys: deduped.duplicateKeys
    }

    event.sender.send('generation-batch', {
      projectId: id,
      batchNumber,
      maxBatches: progress.maxBatches,
      cards: deduped.cards,
      coverage,
      status: progress.status,
      generationProgress: progress
    })

    if (iterativeStops.has(id)) {
      progress = { ...progress, status: 'stopped' }
      event.sender.send('generation-batch', {
        projectId: id,
        batchNumber,
        maxBatches: progress.maxBatches,
        cards: [],
        coverage,
        status: 'stopped',
        generationProgress: progress
      })
      iterativeStops.delete(id)
      return { status: 'stopped', generationProgress: progress }
    }

    if (progress.status === 'done' || progress.status === 'capped') {
      iterativeStops.delete(id)
      return { status: progress.status, generationProgress: progress }
    }
  }

  progress = { ...progress, status: 'capped' }
  iterativeStops.delete(id)
  return { status: 'capped', generationProgress: progress }
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
  return getApiKeyStatus().available
})

ipcMain.handle('get-api-key-status', async () => {
  return getApiKeyStatus()
})

ipcMain.handle('clear-api-key', async () => {
  const file = getApiKeyFilePath()
  if (fs.existsSync(file)) {
    fs.unlinkSync(file)
  }
  return { ok: true }
})

ipcMain.handle('list-claude-api-models', async () => {
  try {
    return await listClaudeApiModels()
  } catch (err) {
    return { models: [], error: 'models-unavailable', message: err.message }
  }
})

ipcMain.handle('get-claude-code-status', async () => {
  return getClaudeCodeStatus()
})

ipcMain.handle('get-generation-settings', async () => {
  return readGenerationSettings()
})

ipcMain.handle('save-generation-settings', async (_event, settings) => {
  return writeGenerationSettings(settings)
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
