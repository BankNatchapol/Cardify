'use strict'

const fs = require('fs')
const path = require('path')

const DEFAULT_ELEVENLABS_MODEL = 'eleven_v3'
const DEFAULT_ELEVENLABS_OUTPUT_FORMAT = 'mp3_44100_128'
const DEFAULT_ELEVENLABS_VOICE_ID = '5ncWmV8ucTKnJsg8AQLM'
const DEFAULT_ELEVENLABS_CONCURRENCY = 2
const DEFAULT_ELEVENLABS_RETRY_ATTEMPTS = 3
const DEFAULT_ELEVENLABS_RETRY_BASE_MS = 1000
const DEFAULT_ELEVENLABS_RETRY_MAX_MS = 30000
const ELEVENLABS_MIN_SPEED = 0.7
const ELEVENLABS_MAX_SPEED = 1.2

const HAN_RE = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/
const THAI_RE = /[\u0E00-\u0E7F]/
const CHINESE_SENTENCE_END_RE = /[。！？!?]$/
const SKIP_BACK_LINE_RE = /พินอิน|ชนิดของคำ|ความหมาย|ตัวอย่างประโยค|ข้อควรระวัง|หมายเหตุ|คำอ่าน|แปล|translation/i

function selectDeckCards (input, options = {}) {
  if (Array.isArray(input)) {
    return {
      deck: {},
      cards: input.map((card, index) => normalizeCard(card, index))
    }
  }

  if (!input || typeof input !== 'object') {
    throw new Error('Input JSON must be an object or card array')
  }

  if (Array.isArray(input.cards)) {
    return {
      deck: input.description || {},
      cards: input.cards.map((card, index) => normalizeCard(card, index))
    }
  }

  if (Array.isArray(input.notes)) {
    return {
      deck: input.deck || {},
      cards: input.notes.map((note, index) => normalizeNote(note, index))
    }
  }

  if (Array.isArray(input.projects)) {
    const index = selectProjectIndex(input.projects, options.projectId)
    const project = input.projects[index]
    if (!Array.isArray(project?.cards)) throw new Error('Selected project does not include cards')
    return {
      deck: project.description || { title: project.name || project.fileName || project.id || '' },
      cards: project.cards.map((card, cardIndex) => normalizeCard(card, cardIndex, project.id))
    }
  }

  throw new Error('Could not find cards in input JSON')
}

function extractChineseAudioTargets (input, options = {}) {
  const selected = selectDeckCards(input, options)
  const targets = []

  selected.cards.forEach((card, index) => {
    const front = extractFrontTarget(card)
    const noteSlug = noteSlugFor(index)
    if (front) {
      targets.push({
        id: `${noteSlug}-front`,
        noteId: card.noteId || noteSlug,
        noteIndex: index,
        kind: 'front',
        text: front,
        relativeFile: path.join('front', `${noteSlug}-front.mp3`)
      })
    }

    extractExampleTargets(card.back || card.text || '').forEach((example, exampleIndex) => {
      targets.push({
        id: `${noteSlug}-example-${String(exampleIndex + 1).padStart(2, '0')}`,
        noteId: card.noteId || noteSlug,
        noteIndex: index,
        kind: 'example',
        text: example,
        relativeFile: path.join('examples', `${noteSlug}-example-${String(exampleIndex + 1).padStart(2, '0')}.mp3`)
      })
    })
  })

  return { deck: selected.deck, targets }
}

function extractFrontTarget (card = {}) {
  const text = cleanStudyText(card.front || card.fields?.Front || card.fields?.front || '')
  return HAN_RE.test(text) ? addChineseFullStopForTts(text) : ''
}

function addChineseFullStopForTts (text = '') {
  const trimmed = String(text || '').trim()
  if (!trimmed) return ''
  return CHINESE_SENTENCE_END_RE.test(trimmed) ? trimmed : `${trimmed}。`
}

function extractExampleTargets (back = '') {
  const examples = []
  const seen = new Set()
  const normalized = String(back || '').replace(/<br\s*\/?>/gi, '\n')

  for (const rawLine of normalized.split(/\r?\n/)) {
    const line = cleanStudyText(rawLine)
    if (!line) continue
    if (!HAN_RE.test(line)) continue
    if (SKIP_BACK_LINE_RE.test(line)) continue
    if (THAI_RE.test(line)) continue
    if (seen.has(line)) continue
    seen.add(line)
    examples.push(line)
  }

  return examples
}

function cleanStudyText (value = '') {
  return stripMarkdown(stripHtml(String(value || '')))
    .replace(/\{\{audio:[A-Za-z0-9_-]+\}\}/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function stripHtml (value) {
  return String(value || '').replace(/<[^>]*>/g, '')
}

function stripMarkdown (value) {
  return String(value || '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/^[-*]\s+/, '')
    .replace(/^\d+\.\s+/, '')
}

async function generateElevenLabsAudio (targets, options = {}) {
  const apiKey = options.apiKey
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY is required')

  const outputDir = options.outputDir
  if (!outputDir) throw new Error('outputDir is required')

  const selectedTargets = applyTargetFilters(targets, options)
  const manifestPath = path.join(outputDir, 'manifest.json')
  const previousManifest = readManifest(manifestPath)
  const previousById = new Map((previousManifest.targets || []).map(target => [target.id, target]))
  const manifestTargets = []

  const manifest = {
    deck: options.deck || {},
    sourceFile: options.sourceFile || '',
    generatedAt: new Date().toISOString(),
    voiceId: options.voiceId || DEFAULT_ELEVENLABS_VOICE_ID,
    modelId: options.model || DEFAULT_ELEVENLABS_MODEL,
    outputFormat: options.outputFormat || DEFAULT_ELEVENLABS_OUTPUT_FORMAT,
    speed: normalizeSpeed(options.speed),
    targets: manifestTargets
  }

  fs.mkdirSync(outputDir, { recursive: true })
  await mapWithConcurrency(selectedTargets, options.concurrency || DEFAULT_ELEVENLABS_CONCURRENCY, async (target, index) => {
    const outputPath = path.join(outputDir, target.relativeFile)
    const previous = previousById.get(target.id)

    if (!options.force && previous?.status === 'success' && fs.existsSync(outputPath)) {
      const record = { ...target, file: target.relativeFile, status: 'skipped' }
      manifestTargets[index] = record
      options.onProgress?.({ stage: 'skip', target: record, index, total: selectedTargets.length })
      return
    }

    fs.mkdirSync(path.dirname(outputPath), { recursive: true })
    options.onProgress?.({ stage: 'start', target, index, total: selectedTargets.length })
    try {
      const audio = await requestElevenLabsAudio(target.text, {
        apiKey,
        voiceId: options.voiceId || DEFAULT_ELEVENLABS_VOICE_ID,
        model: options.model || DEFAULT_ELEVENLABS_MODEL,
        outputFormat: options.outputFormat || DEFAULT_ELEVENLABS_OUTPUT_FORMAT,
        speed: options.speed,
        fetchImpl: options.fetchImpl,
        retryAttempts: options.retryAttempts ?? DEFAULT_ELEVENLABS_RETRY_ATTEMPTS,
        retryBaseMs: options.retryBaseMs ?? DEFAULT_ELEVENLABS_RETRY_BASE_MS,
        retryMaxMs: options.retryMaxMs ?? DEFAULT_ELEVENLABS_RETRY_MAX_MS,
        sleep: options.sleep,
        onRetry: options.onRetry
      })
      fs.writeFileSync(outputPath, audio)
      const record = { ...target, file: target.relativeFile, status: 'success' }
      manifestTargets[index] = record
      options.onProgress?.({ stage: 'complete', target: record, index, total: selectedTargets.length })
    } catch (err) {
      const record = { ...target, file: target.relativeFile, status: 'error', error: err.message }
      manifestTargets[index] = record
      options.onProgress?.({ stage: 'error', target: record, index, total: selectedTargets.length })
      throw err
    } finally {
      writeManifest(manifestPath, manifest)
    }
  })

  writeManifest(manifestPath, manifest)
  return manifest
}

function applyTargetFilters (targets = [], options = {}) {
  const only = options.only || 'all'
  let selected = only === 'all'
    ? [...targets]
    : targets.filter(target => target.kind === only.replace(/s$/, ''))
  if (Number.isFinite(Number(options.limit)) && Number(options.limit) >= 0) {
    selected = selected.slice(0, Number(options.limit))
  }
  return selected
}

async function requestElevenLabsAudio (text, options = {}) {
  const fetchImpl = options.fetchImpl || global.fetch
  if (typeof fetchImpl !== 'function') throw new Error('fetch is not available in this Node runtime')

  const voiceId = options.voiceId || DEFAULT_ELEVENLABS_VOICE_ID
  const outputFormat = options.outputFormat || DEFAULT_ELEVENLABS_OUTPUT_FORMAT
  const model = options.model || DEFAULT_ELEVENLABS_MODEL
  const speed = normalizeSpeed(options.speed)
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${encodeURIComponent(outputFormat)}`
  const body = {
    text,
    model_id: model
  }
  if (speed != null) {
    body.voice_settings = { speed }
  }

  return withRetry(async attempt => {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'xi-api-key': options.apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    })

    if (!response.ok) {
      const body = await safeResponseText(response)
      const err = new Error(`ElevenLabs request failed with HTTP ${response.status}${body ? `: ${body}` : ''}`)
      err.status = response.status
      err.retryAfter = response.headers?.get?.('retry-after')
      throw err
    }

    return Buffer.from(await response.arrayBuffer())
  }, {
    retryAttempts: options.retryAttempts ?? DEFAULT_ELEVENLABS_RETRY_ATTEMPTS,
    retryBaseMs: options.retryBaseMs ?? DEFAULT_ELEVENLABS_RETRY_BASE_MS,
    retryMaxMs: options.retryMaxMs ?? DEFAULT_ELEVENLABS_RETRY_MAX_MS,
    sleep: options.sleep,
    onRetry: options.onRetry
  })
}

function normalizeSpeed (speed) {
  if (speed == null || speed === '') return null
  const number = Number(speed)
  if (!Number.isFinite(number)) throw new Error('ElevenLabs speed must be a number')
  if (number < ELEVENLABS_MIN_SPEED || number > ELEVENLABS_MAX_SPEED) {
    throw new Error(`ElevenLabs speed must be between ${ELEVENLABS_MIN_SPEED} and ${ELEVENLABS_MAX_SPEED}`)
  }
  return number
}

async function withRetry (fn, options = {}) {
  const attempts = options.retryAttempts ?? DEFAULT_ELEVENLABS_RETRY_ATTEMPTS
  let lastErr
  for (let attempt = 0; attempt <= attempts; attempt++) {
    try {
      return await fn(attempt)
    } catch (err) {
      lastErr = err
      if (attempt >= attempts || !isRetryableElevenLabsError(err)) throw err
      const waitMs = retryDelayMs(err, attempt, options)
      options.onRetry?.({
        attempt: attempt + 1,
        retryAttempts: attempts,
        status: err.status,
        waitMs
      })
      await (options.sleep || sleep)(waitMs)
    }
  }
  throw lastErr
}

function isRetryableElevenLabsError (err) {
  const status = Number(err?.status || err?.response?.status)
  return [429, 500, 502, 503, 504].includes(status)
}

function retryDelayMs (err, attempt, options = {}) {
  const retryAfter = parseRetryAfter(err?.retryAfter || err?.response?.headers?.get?.('retry-after'))
  if (retryAfter != null) return retryAfter
  const base = options.retryBaseMs ?? DEFAULT_ELEVENLABS_RETRY_BASE_MS
  const max = options.retryMaxMs ?? DEFAULT_ELEVENLABS_RETRY_MAX_MS
  return Math.min(max, base * Math.pow(2, attempt))
}

function parseRetryAfter (value) {
  if (!value) return null
  const seconds = Number(value)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)
  const date = Date.parse(value)
  if (Number.isFinite(date)) return Math.max(0, date - Date.now())
  return null
}

async function safeResponseText (response) {
  try {
    const text = await response.text()
    return text.slice(0, 500)
  } catch {
    return ''
  }
}

function readManifest (manifestPath) {
  if (!fs.existsSync(manifestPath)) return {}
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  } catch {
    return {}
  }
}

function writeManifest (manifestPath, manifest) {
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true })
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
}

async function mapWithConcurrency (items, concurrency, iterator) {
  const workers = []
  let nextIndex = 0
  const workerCount = Math.max(1, Math.min(Number(concurrency) || 1, items.length || 1))

  for (let i = 0; i < workerCount; i++) {
    workers.push((async () => {
      while (nextIndex < items.length) {
        const index = nextIndex++
        await iterator(items[index], index)
      }
    })())
  }

  await Promise.all(workers)
}

function normalizeCard (card = {}, index, projectId = '') {
  if (String(card.type || '').toLowerCase() === 'cloze' || Object.prototype.hasOwnProperty.call(card, 'text')) {
    return {
      type: 'cloze',
      noteId: card.id || card.noteId || noteSlugFor(index),
      projectId,
      text: String(card.text || '')
    }
  }

  return {
    type: 'basic',
    noteId: card.id || card.noteId || noteSlugFor(index),
    projectId,
    front: String(card.front || ''),
    back: String(card.back || '')
  }
}

function normalizeNote (note = {}, index) {
  const fields = note.fields || {}
  const noteType = String(note.noteType || note.type || '').toLowerCase()
  if (noteType.includes('cloze') || Object.prototype.hasOwnProperty.call(fields, 'Text')) {
    return {
      type: 'cloze',
      noteId: note.id || noteSlugFor(index),
      text: String(fields.Text || fields.text || note.text || '')
    }
  }

  return {
    type: 'basic',
    noteId: note.id || noteSlugFor(index),
    front: String(fields.Front || fields.front || note.front || ''),
    back: String(fields.Back || fields.back || note.back || '')
  }
}

function selectProjectIndex (projects, projectId) {
  if (projectId) {
    const index = projects.findIndex(project => project?.id === projectId)
    if (index < 0) throw new Error(`Project not found: ${projectId}`)
    return index
  }
  if (projects.length === 1) return 0
  throw new Error('Input contains multiple projects; pass --project-id')
}

function noteSlugFor (index) {
  return `note-${String(index + 1).padStart(4, '0')}`
}

function sleep (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

module.exports = {
  DEFAULT_ELEVENLABS_CONCURRENCY,
  DEFAULT_ELEVENLABS_MODEL,
  DEFAULT_ELEVENLABS_OUTPUT_FORMAT,
  DEFAULT_ELEVENLABS_RETRY_ATTEMPTS,
  DEFAULT_ELEVENLABS_RETRY_BASE_MS,
  DEFAULT_ELEVENLABS_RETRY_MAX_MS,
  DEFAULT_ELEVENLABS_VOICE_ID,
  ELEVENLABS_MAX_SPEED,
  ELEVENLABS_MIN_SPEED,
  addChineseFullStopForTts,
  cleanStudyText,
  extractChineseAudioTargets,
  extractExampleTargets,
  extractFrontTarget,
  generateElevenLabsAudio,
  isRetryableElevenLabsError,
  normalizeSpeed,
  requestElevenLabsAudio,
  retryDelayMs,
  selectDeckCards
}
