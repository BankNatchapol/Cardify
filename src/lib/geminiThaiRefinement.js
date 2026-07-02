'use strict'

const DEFAULT_GEMINI_MODEL = 'gemini-3.1-flash-lite'
const DEFAULT_CHUNK_SIZE = 10
const DEFAULT_STYLE_EXAMPLE_LIMIT = 3
const DEFAULT_RECENT_EXAMPLE_LIMIT = 3
const DEFAULT_GEMINI_RETRY_ATTEMPTS = 4
const DEFAULT_GEMINI_RETRY_BASE_MS = 1000
const DEFAULT_GEMINI_RETRY_MAX_MS = 30000
const THAI_RE = /[\u0E00-\u0E7F]/
const NON_THAI_STUDY_RE = /[\u3400-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/
const ALLOWED_TAG_RE = /<\/?(?:mark|span)\b[^>]*>/gi
const CLOZE_RE = /\{\{c\d+::[\s\S]+?\}\}/g

const BASIC_REFINEMENT_CARD_SCHEMA = {
  type: 'object',
  properties: {
    index: { type: 'integer' },
    type: { type: 'string', enum: ['basic'] },
    front: { type: 'string' },
    back: { type: 'string' },
    changed: { type: 'boolean' }
  },
  required: ['index', 'type', 'front', 'back', 'changed'],
  additionalProperties: false,
  propertyOrdering: ['index', 'type', 'front', 'back', 'changed']
}

const CLOZE_REFINEMENT_CARD_SCHEMA = {
  type: 'object',
  properties: {
    index: { type: 'integer' },
    type: { type: 'string', enum: ['cloze'] },
    text: { type: 'string' },
    changed: { type: 'boolean' }
  },
  required: ['index', 'type', 'text', 'changed'],
  additionalProperties: false,
  propertyOrdering: ['index', 'type', 'text', 'changed']
}

function buildRefinementResponseJsonSchema (itemSchema, chunkLength) {
  const cardCount = Math.max(0, Number.parseInt(chunkLength, 10) || 0)
  return {
    type: 'object',
    properties: {
      cards: {
        type: 'array',
        items: itemSchema,
        minItems: cardCount,
        maxItems: cardCount
      }
    },
    required: ['cards'],
    additionalProperties: false,
    propertyOrdering: ['cards']
  }
}

function refinementResponseSchemaForChunk (chunk) {
  const hasBasic = chunk.some(card => card.type !== 'cloze')
  const hasCloze = chunk.some(card => card.type === 'cloze')
  const itemSchema = hasBasic && hasCloze
    ? { anyOf: [BASIC_REFINEMENT_CARD_SCHEMA, CLOZE_REFINEMENT_CARD_SCHEMA] }
    : hasCloze
      ? CLOZE_REFINEMENT_CARD_SCHEMA
      : BASIC_REFINEMENT_CARD_SCHEMA
  return buildRefinementResponseJsonSchema(itemSchema, chunk.length)
}

function chunkCards (cards, chunkSize = DEFAULT_CHUNK_SIZE) {
  if (!Array.isArray(cards)) throw new Error('cards must be an array')
  const size = Math.max(1, Number.parseInt(chunkSize, 10) || DEFAULT_CHUNK_SIZE)
  const chunks = []
  for (let offset = 0; offset < cards.length; offset += size) {
    chunks.push(cards.slice(offset, offset + size).map((card, index) => ({
      index: offset + index,
      ...normalizeCardForGemini(card)
    })))
  }
  return chunks
}

function buildThaiRefinementPrompt (deckContext = {}) {
  const description = deckContext.description || deckContext
  const title = String(description.title || deckContext.title || 'Untitled deck')
  const purpose = String(description.purpose || deckContext.purpose || '')
  const contents = Array.isArray(description.contents || deckContext.contents)
    ? (description.contents || deckContext.contents).join('\n')
    : String(description.contents || deckContext.contents || '')
  const cardFormat = String(deckContext.cardFormat || '')

  return [
    'You refine Thai wording for Cardify flashcards.',
    '',
    'Deck context:',
    `Title: ${title}`,
    purpose ? `Purpose: ${purpose}` : 'Purpose: not specified',
    contents ? `Contents:\n${contents}` : 'Contents: not specified',
    cardFormat ? `Card format: ${cardFormat}` : 'Card format: not specified',
    '',
    'Task:',
    '- Improve only Thai wording so it sounds natural, clear, and learner-friendly.',
    '- Preserve all Chinese, pinyin, romanization, numbers, examples, markdown, and Cardify semantic highlight tags.',
    '- Do not translate Chinese or pinyin into something else.',
    '- Do not add or remove cards.',
    '- Do not change card indexes or card types.',
    '- For basic cards, keep front unchanged unless the front is entirely Thai wording.',
    '- Preserve cloze syntax exactly, including markers like {{c1::...}}.',
    '- Use the provided styleReferenceCards and recentRefinedCards only as read-only style examples.',
    '- Do not copy, edit, or return styleReferenceCards or recentRefinedCards.',
    '- Prefer full Thai wording for grammar labels and word classes; avoid abbreviations such as ก. or น.',
    '- Keep Thai terminology consistent with the examples across every chunk.',
    '- Return JSON only with this shape: {"cards":[{"index":0,"type":"basic","front":"...","back":"...","changed":true}]}'
  ].join('\n')
}

function normalizeCardForStyleExample (card) {
  return normalizeCardForGemini(card)
}

function selectStyleReferenceCards (input, deckContext, limit = DEFAULT_STYLE_EXAMPLE_LIMIT, options = {}) {
  const max = Math.max(0, Number.parseInt(limit, 10) || 0)
  if (max <= 0) return []

  const context = deckContext || inferDeckContext(input, options)
  const sampleSources = [
    context?.acceptedSampleCards,
    context?.generationProgress?.acceptedSampleCards,
    input?.acceptedSampleCards,
    input?.generationProgress?.acceptedSampleCards,
    input?.sampleCards
  ]

  for (const source of sampleSources) {
    if (Array.isArray(source) && source.length > 0) {
      return source.slice(0, max).map(normalizeCardForStyleExample)
    }
  }

  const { cards } = selectCardsTarget(input, options)
  return cards.slice(0, max).map(normalizeCardForStyleExample)
}

function normalizeCardForGemini (card) {
  const type = card?.type === 'cloze' ? 'cloze' : 'basic'
  if (type === 'cloze') {
    return {
      type,
      text: String(card?.text || '')
    }
  }
  return {
    type,
    front: String(card?.front || ''),
    back: String(card?.back || '')
  }
}

function validateRefinedChunk (originalChunk, refinedChunk) {
  const refinedCards = Array.isArray(refinedChunk?.cards) ? refinedChunk.cards : refinedChunk
  if (!Array.isArray(originalChunk)) throw new Error('Original chunk must be an array')
  if (!Array.isArray(refinedCards)) throw new Error('Refined chunk must include a cards array')
  if (refinedCards.length !== originalChunk.length) {
    throw new Error(`Refined chunk card count changed from ${originalChunk.length} to ${refinedCards.length}`)
  }
  const allowedIndexes = new Set(originalChunk.map(card => Number(card.index)))
  refinedCards.forEach((refined) => {
    if (!allowedIndexes.has(Number(refined?.index))) {
      throw new Error(`Refined card index ${refined?.index} is outside the current chunk`)
    }
  })

  return refinedCards.map((refined, position) => {
    const original = originalChunk[position]
    if (Number(refined?.index) !== Number(original.index)) {
      throw new Error(`Refined card index mismatch at position ${position}`)
    }
    if (refined.type !== original.type) {
      throw new Error(`Refined card ${original.index} changed type from ${original.type} to ${refined.type}`)
    }

    if (original.type === 'cloze') {
      const text = requireString(refined.text, `Refined cloze card ${original.index} is missing text`)
      assertClozeMarkersPreserved(original.text, text, original.index)
      assertAllowedTagsPreserved(original.text, text, original.index)
      return { index: original.index, type: 'cloze', text, changed: Boolean(refined.changed) }
    }

    const front = requireString(refined.front, `Refined basic card ${original.index} is missing front`)
    const back = requireString(refined.back, `Refined basic card ${original.index} is missing back`)
    if (front !== original.front && containsNonThaiStudyContent(original.front)) {
      throw new Error(`Refined basic card ${original.index} changed a non-Thai front`)
    }
    assertAllowedTagsPreserved(original.front, front, original.index)
    assertAllowedTagsPreserved(original.back, back, original.index)
    return { index: original.index, type: 'basic', front, back, changed: Boolean(refined.changed) }
  })
}

function applyRefinedCardsToInput (input, refinedCards, options = {}) {
  const { cards, update } = selectCardsTarget(input, options)
  const byIndex = new Map(refinedCards.map(card => [Number(card.index), card]))
  const nextCards = cards.map((card, index) => {
    const refined = byIndex.get(index)
    if (!refined) return card
    if (refined.type === 'cloze') return { ...card, type: 'cloze', text: refined.text }
    return { ...card, type: 'basic', front: refined.front, back: refined.back }
  })
  return update(nextCards)
}

function selectCardsTarget (input, options = {}) {
  if (Array.isArray(input)) {
    return { cards: input, update: nextCards => nextCards }
  }

  if (!input || typeof input !== 'object') {
    throw new Error('Input must be a card array, a project object, or { projects: [...] }')
  }

  if (Array.isArray(input.cards)) {
    return {
      cards: input.cards,
      update: nextCards => ({ ...input, cards: nextCards })
    }
  }

  if (Array.isArray(input.notes)) {
    const notes = input.notes
    return {
      cards: notes.map(noteToCard),
      update: nextCards => ({
        ...input,
        notes: notes.map((note, index) => cardToNote(note, nextCards[index]))
      })
    }
  }

  if (Array.isArray(input.projects)) {
    const projects = input.projects
    const selectedIndex = selectProjectIndex(projects, options.projectId)
    const selected = projects[selectedIndex]
    if (!Array.isArray(selected?.cards)) throw new Error('Selected project does not include cards')
    return {
      cards: selected.cards,
      update: nextCards => ({
        ...input,
        projects: projects.map((project, index) => (
          index === selectedIndex ? { ...project, cards: nextCards } : project
        ))
      })
    }
  }

  throw new Error('Could not find cards in input JSON')
}

function noteToCard (note = {}) {
  const fields = note.fields || {}
  const noteType = String(note.noteType || note.type || '').toLowerCase()
  if (noteType.includes('cloze') || Object.prototype.hasOwnProperty.call(fields, 'Text')) {
    return {
      type: 'cloze',
      text: String(fields.Text || fields.text || note.text || '')
    }
  }

  return {
    type: 'basic',
    front: String(fields.Front || fields.front || note.front || ''),
    back: String(fields.Back || fields.back || note.back || '')
  }
}

function cardToNote (note = {}, card = {}) {
  const fields = note.fields || {}
  if (card.type === 'cloze') {
    return {
      ...note,
      noteType: note.noteType || 'cloze',
      fields: {
        ...fields,
        Text: card.text
      }
    }
  }

  return {
    ...note,
    noteType: note.noteType || 'basic',
    fields: {
      ...fields,
      Front: card.front,
      Back: card.back
    }
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

function inferDeckContext (input, options = {}) {
  if (options.deckContext) return options.deckContext
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    if (input.description || input.cardFormat) return input
    if (input.deck) {
      return {
        description: input.deck.description || {
          title: input.deck.name || input.deck.title || 'Untitled deck',
          purpose: '',
          contents: []
        },
        cardFormat: inferCardFormatFromCards(Array.isArray(input.notes) ? input.notes.map(noteToCard) : [])
      }
    }
    if (Array.isArray(input.projects)) {
      const index = selectProjectIndex(input.projects, options.projectId)
      return input.projects[index]
    }
  }
  return {}
}

function inferCardFormatFromCards (cards = []) {
  return cards.some(card => card?.type === 'cloze') ? 'cloze' : 'basic'
}

function buildGeminiChunkPayload ({ chunk, styleReferenceCards = [], recentRefinedCards = [] }) {
  return {
    styleReferenceCards,
    recentRefinedCards,
    cards: chunk
  }
}

async function refineThaiCardsWithGemini ({
  input,
  deckContext,
  apiKey,
  model = DEFAULT_GEMINI_MODEL,
  chunkSize = DEFAULT_CHUNK_SIZE,
  styleExampleLimit = DEFAULT_STYLE_EXAMPLE_LIMIT,
  recentExampleLimit = DEFAULT_RECENT_EXAMPLE_LIMIT,
  thinkingBudget,
  thinkingLevel,
  retryAttempts = DEFAULT_GEMINI_RETRY_ATTEMPTS,
  retryBaseMs = DEFAULT_GEMINI_RETRY_BASE_MS,
  retryMaxMs = DEFAULT_GEMINI_RETRY_MAX_MS,
  sleep = delay,
  onRetry,
  onProgress,
  onChunkComplete,
  projectId,
  genAI
}) {
  if (!apiKey) throw new Error('GEMINI_API_KEY is required')

  const { cards } = selectCardsTarget(input, { projectId })
  const chunks = chunkCards(cards, chunkSize)
  const resolvedDeckContext = deckContext || inferDeckContext(input, { projectId })
  const systemInstruction = buildThaiRefinementPrompt(resolvedDeckContext)
  const styleReferenceCards = selectStyleReferenceCards(input, resolvedDeckContext, styleExampleLimit, { projectId })
  const recentLimit = Math.max(0, Number.parseInt(recentExampleLimit, 10) || 0)
  const client = genAI || await createGoogleGenAI(apiKey)
  const refinedCards = []
  let recentRefinedCards = []
  emitProgress(onProgress, {
    stage: 'start',
    totalCards: cards.length,
    totalChunks: chunks.length,
    chunkSize: Number(chunkSize) || DEFAULT_CHUNK_SIZE,
    model
  })

  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
    const chunk = chunks[chunkIndex]
    const chunkStart = Date.now()
    emitProgress(onProgress, {
      stage: 'chunk-start',
      chunkNumber: chunkIndex + 1,
      chunkCount: chunks.length,
      chunkCards: chunk.length,
      refinedCards: refinedCards.length,
      totalCards: cards.length
    })
    const requestPayload = buildGeminiChunkPayload({
      chunk,
      styleReferenceCards,
      recentRefinedCards
    })
    const config = {
      systemInstruction,
      responseMimeType: 'application/json',
      responseJsonSchema: refinementResponseSchemaForChunk(chunk),
      temperature: 0.2
    }
    const thinkingConfig = buildGeminiThinkingConfig(model, { thinkingBudget, thinkingLevel })
    if (thinkingConfig) config.thinkingConfig = thinkingConfig
    const response = await generateContentWithRetry(client, {
      model,
      contents: JSON.stringify(requestPayload, null, 2),
      config
    }, {
      retryAttempts,
      retryBaseMs,
      retryMaxMs,
      sleep,
      onRetry,
      chunkNumber: chunkIndex + 1,
      chunkCount: chunks.length
    })
    const payload = await parseGeminiJsonResponseWithRetry({
      client,
      request: {
        model,
        contents: JSON.stringify(requestPayload, null, 2),
        config
      },
      response,
      retryAttempts,
      retryBaseMs,
      retryMaxMs,
      sleep,
      onRetry,
      chunkNumber: chunkIndex + 1,
      chunkCount: chunks.length
    })
    const refinedChunk = await validateRefinedChunkWithRetry({
      client,
      request: {
        model,
        contents: JSON.stringify(requestPayload, null, 2),
        config
      },
      chunk,
      payload,
      retryAttempts,
      retryBaseMs,
      retryMaxMs,
      sleep,
      onRetry,
      chunkNumber: chunkIndex + 1,
      chunkCount: chunks.length
    })
    refinedCards.push(...refinedChunk)
    if (typeof onChunkComplete === 'function') {
      onChunkComplete({
        chunkNumber: chunkIndex + 1,
        chunkCount: chunks.length,
        chunk,
        refinedChunk,
        refinedCards: refinedCards.slice(),
        totalCards: cards.length
      })
    }
    emitProgress(onProgress, {
      stage: 'chunk-complete',
      chunkNumber: chunkIndex + 1,
      chunkCount: chunks.length,
      chunkCards: chunk.length,
      refinedCards: refinedCards.length,
      totalCards: cards.length,
      durationMs: Date.now() - chunkStart
    })
    recentRefinedCards = recentLimit > 0
      ? refinedChunk.slice(-recentLimit).map(normalizeCardForStyleExample)
      : []
  }

  emitProgress(onProgress, {
    stage: 'complete',
    totalCards: cards.length,
    totalChunks: chunks.length,
    refinedCards: refinedCards.length
  })
  return applyRefinedCardsToInput(input, refinedCards, { projectId })
}

function emitProgress (onProgress, info) {
  if (typeof onProgress === 'function') onProgress(info)
}

async function parseGeminiJsonResponseWithRetry ({
  client,
  request,
  response,
  retryAttempts = DEFAULT_GEMINI_RETRY_ATTEMPTS,
  retryBaseMs = DEFAULT_GEMINI_RETRY_BASE_MS,
  retryMaxMs = DEFAULT_GEMINI_RETRY_MAX_MS,
  sleep = delay,
  onRetry,
  chunkNumber,
  chunkCount
}) {
  let currentResponse = response
  const attempts = Math.max(0, Number.parseInt(retryAttempts, 10) || 0)
  for (let attempt = 0; ; attempt++) {
    try {
      return parseGeminiJsonResponse(currentResponse)
    } catch (err) {
      if (attempt >= attempts || !isRetryableGeminiParseError(err)) throw err
      const waitMs = retryDelayMs(err, attempt, { retryBaseMs, retryMaxMs })
      if (typeof onRetry === 'function') {
        onRetry({
          attempt: attempt + 1,
          retryAttempts: attempts,
          waitMs,
          status: 'invalid-json',
          message: err.message,
          chunkNumber,
          chunkCount
        })
      }
      await sleep(waitMs)
      currentResponse = await generateContentWithRetry(client, request, {
        retryAttempts,
        retryBaseMs,
        retryMaxMs,
        sleep,
        onRetry,
        chunkNumber,
        chunkCount
      })
    }
  }
}

async function validateRefinedChunkWithRetry ({
  client,
  request,
  chunk,
  payload,
  retryAttempts = DEFAULT_GEMINI_RETRY_ATTEMPTS,
  retryBaseMs = DEFAULT_GEMINI_RETRY_BASE_MS,
  retryMaxMs = DEFAULT_GEMINI_RETRY_MAX_MS,
  sleep = delay,
  onRetry,
  chunkNumber,
  chunkCount
}) {
  let currentPayload = payload
  const attempts = Math.max(0, Number.parseInt(retryAttempts, 10) || 0)
  for (let attempt = 0; ; attempt++) {
    try {
      return validateRefinedChunk(chunk, currentPayload)
    } catch (err) {
      if (attempt >= attempts || !isRetryableGeminiValidationError(err)) throw err
      const waitMs = retryDelayMs(err, attempt, { retryBaseMs, retryMaxMs })
      if (typeof onRetry === 'function') {
        onRetry({
          attempt: attempt + 1,
          retryAttempts: attempts,
          waitMs,
          status: 'invalid-schema',
          message: err.message,
          chunkNumber,
          chunkCount
        })
      }
      await sleep(waitMs)
      const response = await generateContentWithRetry(client, request, {
        retryAttempts,
        retryBaseMs,
        retryMaxMs,
        sleep,
        onRetry,
        chunkNumber,
        chunkCount
      })
      currentPayload = await parseGeminiJsonResponseWithRetry({
        client,
        request,
        response,
        retryAttempts,
        retryBaseMs,
        retryMaxMs,
        sleep,
        onRetry,
        chunkNumber,
        chunkCount
      })
    }
  }
}

function isRetryableGeminiValidationError (err) {
  return /missing (front|back|text)|changed allowed highlight tags?/i.test(String(err?.message || ''))
}

function buildGeminiThinkingConfig (model, { thinkingBudget, thinkingLevel } = {}) {
  if (isGemini3OrNewer(model)) {
    if (!thinkingLevel) return null
    return {
      thinkingLevel: normalizeThinkingLevel(thinkingLevel)
    }
  }

  if (isGemini25(model) && Number.isFinite(Number(thinkingBudget))) {
    return {
      thinkingBudget: Number(thinkingBudget)
    }
  }

  return null
}

async function generateContentWithRetry (client, request, options = {}) {
  const retryAttempts = Math.max(0, Number.parseInt(options.retryAttempts, 10) || 0)
  const retryBaseMs = Math.max(0, Number.parseInt(options.retryBaseMs, 10) || DEFAULT_GEMINI_RETRY_BASE_MS)
  const retryMaxMs = Math.max(retryBaseMs, Number.parseInt(options.retryMaxMs, 10) || DEFAULT_GEMINI_RETRY_MAX_MS)
  const sleep = options.sleep || delay

  for (let attempt = 0; ; attempt++) {
    try {
      return await client.models.generateContent(request)
    } catch (err) {
      if (attempt >= retryAttempts || !isRetryableGeminiError(err)) {
        throw err
      }

      const waitMs = retryDelayMs(err, attempt, { retryBaseMs, retryMaxMs })
      if (typeof options.onRetry === 'function') {
        options.onRetry({
          attempt: attempt + 1,
          retryAttempts,
          waitMs,
          status: geminiErrorStatus(err),
          message: geminiErrorMessage(err),
          chunkNumber: options.chunkNumber,
          chunkCount: options.chunkCount
        })
      }
      await sleep(waitMs)
    }
  }
}

function isRetryableGeminiError (err) {
  const status = geminiErrorStatus(err)
  if ([429, 500, 502, 503, 504].includes(status)) return true

  const message = geminiErrorMessage(err).toLowerCase()
  return [
    'resource_exhausted',
    'rate limit',
    'too many requests',
    'quota exceeded',
    'overloaded',
    'server overload',
    'service unavailable',
    'unavailable',
    'internal error',
    'deadline exceeded'
  ].some(pattern => message.includes(pattern))
}

function geminiErrorStatus (err) {
  const candidates = [
    err?.status,
    err?.statusCode,
    err?.code,
    err?.response?.status,
    err?.error?.code
  ]
  for (const candidate of candidates) {
    const number = Number(candidate)
    if (Number.isFinite(number)) return number
  }

  const match = geminiErrorMessage(err).match(/\b(429|500|502|503|504)\b/)
  return match ? Number(match[1]) : null
}

function geminiErrorMessage (err) {
  if (!err) return ''
  if (typeof err === 'string') return err
  return String(err.message || err.statusText || err.error?.message || err)
}

function retryDelayMs (err, attempt, { retryBaseMs = DEFAULT_GEMINI_RETRY_BASE_MS, retryMaxMs = DEFAULT_GEMINI_RETRY_MAX_MS } = {}) {
  const retryAfter = retryAfterMs(err)
  if (retryAfter != null) return Math.min(retryAfter, retryMaxMs)
  return Math.min(retryBaseMs * (2 ** attempt), retryMaxMs)
}

function retryAfterMs (err) {
  const value = headerValue(err, 'retry-after')
  if (!value) return null

  const seconds = Number(value)
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000)

  const date = Date.parse(value)
  if (Number.isFinite(date)) return Math.max(0, date - Date.now())
  return null
}

function headerValue (err, name) {
  const headers = err?.response?.headers || err?.headers
  if (!headers) return null
  if (typeof headers.get === 'function') return headers.get(name) || headers.get(name.toUpperCase())
  return headers[name] || headers[name.toLowerCase()] || headers[name.toUpperCase()] || null
}

function delay (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function isGemini25 (model) {
  return /^gemini-2\.5(?:-|$)/i.test(String(model || ''))
}

function isGemini3OrNewer (model) {
  const version = String(model || '').match(/^gemini-(\d+(?:\.\d+)?)(?:-|$)/i)?.[1]
  return Number(version) >= 3
}

function normalizeThinkingLevel (value) {
  const level = String(value || '').trim().toUpperCase()
  if (!['MINIMAL', 'LOW', 'MEDIUM', 'HIGH'].includes(level)) {
    throw new Error('Gemini thinking level must be one of: minimal, low, medium, high')
  }
  return level
}

async function createGoogleGenAI (apiKey) {
  const { GoogleGenAI } = await import('@google/genai')
  return new GoogleGenAI({ apiKey })
}

function parseGeminiJsonResponse (response) {
  const text = typeof response?.text === 'string' ? response.text : response?.text?.()
  if (!text || typeof text !== 'string') throw new Error('Gemini returned an empty response')
  try {
    return JSON.parse(text)
  } catch (err) {
    const parseError = new Error(`Gemini returned invalid JSON: ${err.message}`)
    parseError.code = 'gemini-invalid-json'
    parseError.cause = err
    throw parseError
  }
}

function isRetryableGeminiParseError (err) {
  if (err?.code !== 'gemini-invalid-json') return false
  return /unterminated|unexpected end|bad control character|expected ','|expected '}'|expected ']'/i.test(err.message)
}

function requireString (value, message) {
  if (typeof value !== 'string') throw new Error(message)
  return value
}

function containsNonThaiStudyContent (text) {
  return NON_THAI_STUDY_RE.test(String(text || '')) || /[A-Za-z][A-Za-z0-9āēīōūǖüǎǐǒǔàèìòùáéíóúǘǚǜńňǹ]+/.test(String(text || ''))
}

function assertClozeMarkersPreserved (original, refined, index) {
  const originalMarkers = extractMatches(original, CLOZE_RE)
  const refinedMarkers = extractMatches(refined, CLOZE_RE)
  if (originalMarkers.length !== refinedMarkers.length) {
    throw new Error(`Refined cloze card ${index} changed cloze marker count`)
  }
  originalMarkers.forEach((marker, markerIndex) => {
    const originalId = marker.match(/\{\{(c\d+)::/)?.[1]
    const refinedId = refinedMarkers[markerIndex]?.match(/\{\{(c\d+)::/)?.[1]
    if (originalId !== refinedId) {
      throw new Error(`Refined cloze card ${index} changed cloze marker ${originalId}`)
    }
  })
  if (/\{\{c\d+::/.test(refined) && refinedMarkers.length === 0) {
    throw new Error(`Refined cloze card ${index} has malformed cloze syntax`)
  }
}

function assertAllowedTagsPreserved (original, refined, index) {
  const originalTags = extractAllowedTags(original)
  const refinedTags = extractAllowedTags(refined)
  if (originalTags.length !== refinedTags.length) {
    throw new Error(`Refined card ${index} changed allowed highlight tag count`)
  }
  originalTags.forEach((tag, tagIndex) => {
    if (tag !== refinedTags[tagIndex]) {
      throw new Error(`Refined card ${index} changed allowed highlight tags`)
    }
  })
}

function extractAllowedTags (text) {
  return extractMatches(text, ALLOWED_TAG_RE).map(tag => tag.replace(/\s+/g, ' ').trim())
}

function extractMatches (text, regex) {
  return String(text || '').match(new RegExp(regex.source, regex.flags)) || []
}

module.exports = {
  DEFAULT_GEMINI_MODEL,
  DEFAULT_CHUNK_SIZE,
  DEFAULT_STYLE_EXAMPLE_LIMIT,
  DEFAULT_RECENT_EXAMPLE_LIMIT,
  DEFAULT_GEMINI_RETRY_ATTEMPTS,
  DEFAULT_GEMINI_RETRY_BASE_MS,
  DEFAULT_GEMINI_RETRY_MAX_MS,
  BASIC_REFINEMENT_CARD_SCHEMA,
  CLOZE_REFINEMENT_CARD_SCHEMA,
  refinementResponseSchemaForChunk,
  chunkCards,
  buildThaiRefinementPrompt,
  selectStyleReferenceCards,
  buildGeminiChunkPayload,
  buildGeminiThinkingConfig,
  generateContentWithRetry,
  isRetryableGeminiError,
  isRetryableGeminiParseError,
  isRetryableGeminiValidationError,
  parseGeminiJsonResponseWithRetry,
  retryDelayMs,
  validateRefinedChunk,
  applyRefinedCardsToInput,
  selectCardsTarget,
  noteToCard,
  cardToNote,
  inferDeckContext,
  refineThaiCardsWithGemini,
  parseGeminiJsonResponse
}
