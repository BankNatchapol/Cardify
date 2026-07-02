'use strict'
/**
 * claude.js — runs in the Electron main process only.
 *
 * Exports:
 *   generateCards(parsedText, contextPrompt, cardFormat, apiKey)
 *     -> { description, cards }
 *
 * Long texts are split into ~40 000-token chunks (≈ 160 000 chars).
 * Each chunk is sent in a separate claude-sonnet-4-6 call. Cards are
 * concatenated in source order, and chunk descriptions are summarized into one
 * final deck overview.
 *
 * Throws:
 *   ApiKeyError   — HTTP 401 from the Claude API
 *   ParseError    — JSON parsing of the model response failed
 *   NetworkError  — any other Anthropic SDK / network error
 */

// ─── Token / character budget ────────────────────────────────────────────────
// Default Claude API model used when Settings/env do not override it.
// We budget 40 000 tokens per input chunk ≈ 160 000 chars (4 chars/token average).
// This avoids splitting normal study decks while staying below the 200k-token window.
const CHARS_PER_CHUNK = 160_000
const DEFAULT_CLAUDE_API_MODEL = 'claude-sonnet-4-6'
const {
  parseJsonFromText,
  cardsCandidateFromPayload,
  descriptionFromPayload
} = require('./generationParsing')
const { generationGoalStats } = require('./generationGoal.cjs')

// ─── Error types ─────────────────────────────────────────────────────────────
class ApiKeyError extends Error {
  constructor () {
    super('Invalid API key — check Settings')
    this.name = 'ApiKeyError'
    this.code = 'invalid-api-key'
  }
}

class ParseError extends Error {
  constructor (raw) {
    const text = String(raw || '')
    super(`Failed to parse Claude response as JSON: ${text.slice(0, 120)}`)
    this.name = 'ParseError'
    this.code = 'parse-error'
    this.raw = text
  }
}

class NetworkError extends Error {
  constructor (cause) {
    super(`Claude API error: ${cause.message}`)
    this.name = 'NetworkError'
    this.code = 'network-error'
    this.cause = cause
  }
}

class GenerationCancelledError extends Error {
  constructor () {
    super('Generation was cancelled')
    this.name = 'GenerationCancelledError'
    this.code = 'generation-cancelled'
  }
}

function isAbortError (err) {
  return err?.name === 'AbortError' || err?.code === 'ABORT_ERR'
}

function resolveClaudeApiModel (options = {}, env = process.env) {
  const configured = String(env.CARDIFY_CLAUDE_MODEL || options.apiModel || DEFAULT_CLAUDE_API_MODEL).trim()
  return configured || DEFAULT_CLAUDE_API_MODEL
}

const SEMANTIC_HIGHLIGHT_GUIDANCE = [
  'When color would improve scanning or retention, use semantic highlights:',
  '- Use <span class="cf-key">...</span> for the main target term, answer, or concept.',
  '- In example sentences, highlight the target word or phrase where it appears.',
  '- Use <span class="cf-success">...</span> for correct usage, final answers, or important positive contrasts.',
  '- Use <span class="cf-warning">...</span> for common mistakes, traps, exceptions, false friends, or "do not confuse with" notes.',
  '- Use <span class="cf-muted">...</span> for pronunciation notes, literal translations, memory hints, or lower-priority context.',
  '- Use <mark>...</mark> for one short phrase that should visually pop.',
  'Prefer a small number of meaningful highlights over decorating the whole card.'
].join('\n')

const SEMANTIC_AUDIO_GUIDANCE = [
  'Add semantic audio placeholders for Chinese speech where useful:',
  '- Keep Basic card "front" fields clean for recall; do not put audio tags on the front.',
  '- For Basic cards with spoken front text, put {{audio:front}} in the "back" field near the pinyin/pronunciation line for that front text.',
  '- For Chinese example sentences in the "back" field, append {{audio:example_1}}, {{audio:example_2}}, etc. directly after each matching Chinese example sentence in card order.',
  '- Do not use [sound:...] filenames and do not invent MP3 paths; Cardify resolves semantic audio tags later.',
  '- Do not add audio placeholders to pinyin-only, translation-only, explanation-only, or cloze cards unless explicitly requested.'
].join('\n')

function defaultDescription () {
  return {
    title: 'Generated Cardify Project',
    purpose: '',
    contents: []
  }
}

function normalizeDescription (description) {
  if (!description || typeof description !== 'object' || Array.isArray(description)) {
    return defaultDescription()
  }

  return {
    title: String(description.title || 'Generated Cardify Project').trim() || 'Generated Cardify Project',
    purpose: String(description.purpose || '').trim(),
    contents: Array.isArray(description.contents)
      ? description.contents.map(item => String(item || '').trim()).filter(Boolean)
      : []
  }
}

function normalizeCoverage (coverage) {
  const source = coverage && typeof coverage === 'object' && !Array.isArray(coverage)
    ? coverage
    : {}
  return {
    batchSummary: String(source.batchSummary || '').trim(),
    coveredTopics: Array.isArray(source.coveredTopics)
      ? source.coveredTopics.map(topic => String(topic || '').trim()).filter(Boolean)
      : [],
    remainingFocus: String(source.remainingFocus || '').trim(),
    done: Boolean(source.done)
  }
}

function isChunkDescription (description) {
  const title = String(description?.title || '').toLowerCase()
  const purpose = String(description?.purpose || '').toLowerCase()
  const contents = Array.isArray(description?.contents) ? description.contents.join(' ').toLowerCase() : ''
  const haystack = `${title} ${purpose} ${contents}`

  return [
    /\bpart\s*\d+\b/i,
    /\bsection\s*\d+\b/i,
    /\bchunk\s*\d+\b/i,
    /\b\d+\s*[-–]\s*\d+\b/,
    /ส่วนที่\s*\d+/,
    /คำที่\s*\d+\s*[-–]\s*\d+/,
    /ชุดที่\s*\d+/
  ].some(pattern => pattern.test(haystack))
}

function normalizeCards (cards, cardFormat) {
  if (!Array.isArray(cards)) throw new ParseError(JSON.stringify(cards || null))
  return cards.map(card => {
    if (cardFormat === 'basic') {
      return { front: String(card.front ?? ''), back: String(card.back ?? ''), type: 'basic' }
    }
    return { text: String(card.text ?? ''), type: 'cloze' }
  })
}

function fallbackCombinedDescription (descriptions) {
  const normalized = descriptions.map(normalizeDescription)
  const firstDescription = normalized.find(description =>
    (description.title || description.purpose || description.contents.length > 0) &&
    !isChunkDescription(description)
  ) || normalized.find(description =>
    description.title || description.purpose || description.contents.length > 0
  ) || defaultDescription()
  const contents = [...new Set(normalized.flatMap(description => description.contents))]

  return {
    ...firstDescription,
    contents
  }
}

function serializeSampleCards (cards = []) {
  if (!Array.isArray(cards) || cards.length === 0) return ''
  return cards.map((card, index) => {
    if (card.type === 'cloze') {
      return `Sample ${index + 1}\nCloze: ${card.text || ''}`
    }
    return [
      `Sample ${index + 1}`,
      `Front: ${card.front || ''}`,
      `Back: ${card.back || ''}`
    ].join('\n')
  }).join('\n\n')
}

function buildEffectiveContext (contextPrompt, options = {}) {
  const lines = [contextPrompt || '']
  if (options.clarifiedContext) {
    lines.push('', 'Clarified generation requirements:', options.clarifiedContext)
  }
  if (options.sampleFeedback) {
    lines.push('', 'User feedback on sample cards:', options.sampleFeedback)
  }
  if (Array.isArray(options.sampleFeedbackHistory) && options.sampleFeedbackHistory.length > 0) {
    lines.push(
      '',
      'Accumulated user feedback from previous sample regenerations:',
      ...options.sampleFeedbackHistory.map((feedback, index) => `${index + 1}. ${String(feedback || '').trim()}`).filter(Boolean)
    )
  }
  const previousSamples = serializeSampleCards(options.previousSampleCards)
  if (previousSamples) {
    lines.push(
      '',
      'Previous sample cards for comparison. Use these to understand what the user is trying to improve; do not copy them unless the feedback asks for it:',
      previousSamples
    )
  }
  const samples = serializeSampleCards(options.sampleCards)
  if (samples) {
    lines.push('', 'Accepted sample cards to preserve and follow as style examples:', samples)
  }
  return lines.join('\n').trim()
}

function mergeSeedCards (generatedCards, seedCards, cardFormat) {
  const normalizedSeeds = Array.isArray(seedCards) ? normalizeCards(seedCards, cardFormat) : []
  const normalizedGenerated = Array.isArray(generatedCards) ? normalizeCards(generatedCards, cardFormat) : []
  const seen = new Set()
  const merged = []
  for (const card of [...normalizedSeeds, ...normalizedGenerated]) {
    const key = card.type === 'cloze'
      ? `cloze:${card.text}`
      : `basic:${card.front}\n${card.back}`
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(card)
  }
  return merged
}

// ─── Prompt builder ───────────────────────────────────────────────────────────
/**
 * Build the messages array for a single claude-sonnet-4-6 call.
 *
 * @param {'basic'|'cloze'} cardFormat
 * @param {string} contextPrompt
 * @param {string} textChunk
 * @param {{index:number,total:number}|null} [chunkMeta]
 * @returns {{ system: string, messages: Array }}
 */
function buildPrompt (cardFormat, contextPrompt, textChunk, chunkMeta = null, options = {}) {
  const formatInstruction =
    cardFormat === 'basic'
      ? 'Basic cards: [{"front": "concise prompt", "back": "markdown-rich answer where useful"}]'
      : 'Cloze cards: [{"text": "{{c1::term}} is ... with light markdown only where useful"}]'
  const isMultiChunk = chunkMeta && chunkMeta.total > 1
  const sourceScope = isMultiChunk
    ? `This is chunk ${chunkMeta.index} of ${chunkMeta.total} from a larger source. Generate cards only from this chunk. The description is temporary chunk metadata for a later combine step, so do not title it as a part, section, chunk, or card range.`
    : 'Generate cards from the complete provided text.'

  const system =
    `You are a flashcard generation expert. Generate a Cardify project with ${cardFormat} flashcards from the provided text.\n` +
    `${sourceScope}\n` +
    `Tune the cards specifically to the user's context — emphasize what matters for their stated goal,\n` +
    `omit or deprioritize what doesn't.\n` +
    `Write card fields in concise markdown where it improves readability: **bold**, _italic_, lists, tables, blockquotes, and inline/fenced code.\n` +
    `For Basic cards, keep the front short and mostly plain; use richer markdown mainly in the back.\n` +
    `For Cloze cards, preserve valid Anki cloze syntax like {{c1::term}} and use markdown sparingly around it.\n` +
    `For color emphasis, use only <mark>, <span class="cf-key">, <span class="cf-warning">, <span class="cf-success">, or <span class="cf-muted">. Do not use inline styles, arbitrary classes, scripts, or decorative HTML.\n` +
    `${SEMANTIC_HIGHLIGHT_GUIDANCE}\n` +
    `${SEMANTIC_AUDIO_GUIDANCE}\n` +
    `Return ONLY a JSON object, no explanation, with this top-level shape: {"description":{"title":"","purpose":"","contents":[]},"cards":[]}.\n` +
    `- ${formatInstruction}`

  const userContent =
    `Context: ${buildEffectiveContext(contextPrompt, options)}\nText: ${textChunk}`

  return {
    system,
    messages: [{ role: 'user', content: userContent }]
  }
}

function buildClarificationPrompt (contextPrompt, text, clarificationHistory = [], maxQuestions = 5) {
  const answeredCount = Array.isArray(clarificationHistory) ? clarificationHistory.length : 0
  const remaining = Math.max(0, maxQuestions - answeredCount)
  const system = [
    'You are Cardify\'s clarification assistant for flashcard generation.',
    'Decide whether the user intent is clear enough to generate high-quality flashcards.',
    `Ask 1-2 targeted questions only if they materially affect card quality. Hard cap: ${maxQuestions} total clarification questions across the whole flow.`,
    'Clarify rubric: prefer output language for cards/explanations when unclear, audience/level, exam or use case, desired granularity, terminology, card style, audio placement for spoken study content, and what to omit.',
    'If spoken audio placement is ambiguous for a language-learning deck, ask whether audio should appear on fronts, example sentences, both, or neither. Cardify uses semantic tags like {{audio:front}} and {{audio:example_1}}.',
    'If the desired card/explanation language is not clearly stated, ask what language or mix of languages to use.',
    'Avoid asking about details already obvious from the source text or user context.',
    'If the intent is clear, stop asking and produce a concise clarifiedContext.',
    'Return ONLY JSON with either {"status":"questions","questions":["..."]} or {"status":"clear","clarifiedContext":"..."}'
  ].join('\n')

  const userContent = [
    `Original context: ${contextPrompt}`,
    `Questions remaining: ${remaining}`,
    '',
    'Clarification history:',
    JSON.stringify(clarificationHistory || [], null, 2),
    '',
    'Source excerpt:',
    String(text || '').slice(0, 12000)
  ].join('\n')

  return {
    system,
    messages: [{ role: 'user', content: userContent }]
  }
}

function normalizeClarificationResult (payload, fallbackContext = '') {
  const status = payload?.status === 'questions' ? 'questions' : 'clear'
  if (status === 'questions') {
    const questions = Array.isArray(payload.questions)
      ? payload.questions.map(q => String(q || '').trim()).filter(Boolean).slice(0, 2)
      : []
    if (questions.length > 0) return { status: 'questions', questions }
  }
  return {
    status: 'clear',
    clarifiedContext: String(payload?.clarifiedContext || fallbackContext || '').trim()
  }
}

function buildSamplePrompt (cardFormat, contextPrompt, text, options = {}) {
  const formatInstruction =
    cardFormat === 'basic'
      ? 'Each sample card must have "front" and "back" strings.'
      : 'Each sample card must have a "text" string using valid Anki cloze syntax like {{c1::term}}.'

  const system = [
    'You are generating sample Cardify flashcards before the full deck is created.',
    `Generate exactly 3 ${cardFormat} sample flashcards from the source text.`,
    'These are examples for user approval, so prioritize representative cards that reveal style and content choices.',
    'Use the clarified requirements, user feedback, and accepted sample cards as style guidance.',
    'Do not copy accepted sample cards into the new sample set unless necessary to show a corrected version.',
    'Write card fields in concise markdown where it improves readability.',
    'Use semantic highlights when useful: <mark>, <span class="cf-key">, <span class="cf-warning">, <span class="cf-success">, <span class="cf-muted">.',
    SEMANTIC_HIGHLIGHT_GUIDANCE,
    SEMANTIC_AUDIO_GUIDANCE,
    'Return ONLY a JSON object with this top-level shape: {"description":{"title":"","purpose":"","contents":[]},"cards":[]}.',
    formatInstruction
  ].join('\n')

  const userContent = [
    `Context: ${buildEffectiveContext(contextPrompt, options)}`,
    '',
    'Source excerpt:',
    String(text || '').slice(0, 24000)
  ].join('\n')

  return {
    system,
    messages: [{ role: 'user', content: userContent }]
  }
}

function buildIterativeBatchPrompt (cardFormat, contextPrompt, text, progress = {}) {
  const batchSize = Number(progress.batchSize) || 10
  const nextBatch = (Number(progress.completedBatches) || 0) + 1
  const maxBatches = Number(progress.maxBatches) || 20
  const goalStats = generationGoalStats(progress, Number(progress.currentCardCount) || (Array.isArray(progress.duplicateKeys) ? progress.duplicateKeys.length : 0))
  const isRepair = progress.status === 'repairing_shortfall'
  const requestedCount = isRepair && goalStats.remainingToTarget
    ? goalStats.remainingToTarget
    : batchSize
  const formatInstruction =
    cardFormat === 'basic'
      ? 'Each card must have "front" and "back" strings. Keep fronts short; make backs useful with markdown where it improves review.'
      : 'Each card must have a "text" string using valid Anki cloze syntax like {{c1::term}}.'

  const system = [
    'You are continuing an iterative Cardify deck generation.',
    isRepair
      ? `Repair a generation shortfall. Generate exactly ${requestedCount} missing ${cardFormat} flashcards for batch ${nextBatch} of ${maxBatches}.`
      : `Generate exactly ${batchSize} new ${cardFormat} flashcards for batch ${nextBatch} of ${maxBatches}, unless the source is fully covered and the target card count is already met.`,
    goalStats.targetCardCount
      ? `Generation goal: target ${goalStats.targetCardCount} unique cards, current ${goalStats.currentCardCount}, remaining ${goalStats.remainingToTarget}.`
      : 'Generation goal: target card count is unknown; use coverage.done only when the source is fully covered.',
    'Do not set coverage.done to true unless the target card count is met or there is truly no remaining source material.',
    'Choose the next most valuable content from the source based on the user goal and prior coverage; do not blindly slice the source by position.',
    'Do not repeat existing cards or accepted samples. Use the duplicate keys as content already covered.',
    'Do not return deck title or deck description. Return only cards and batch coverage metadata.',
    'Coverage text must be user-facing. Do not mention internal duplicate keys, duplicate-safety, no-op, parser, schema, or implementation details.',
    'Write card fields in concise markdown where it improves readability.',
    'Use semantic highlights when useful: <mark>, <span class="cf-key">, <span class="cf-warning">, <span class="cf-success">, <span class="cf-muted">.',
    SEMANTIC_HIGHLIGHT_GUIDANCE,
    SEMANTIC_AUDIO_GUIDANCE,
    'Return ONLY a JSON object with this top-level shape: {"cards":[],"coverage":{"batchSummary":"","coveredTopics":[],"remainingFocus":"","done":false}}.',
    formatInstruction
  ].join('\n')

  const userContent = [
    `Context: ${buildEffectiveContext(contextPrompt, {
      clarifiedContext: progress.clarifiedContext,
      sampleFeedback: progress.sampleFeedback,
      sampleCards: progress.acceptedSampleCards
    })}`,
    '',
    'Generation goal state:',
    JSON.stringify({
      targetCardCount: goalStats.targetCardCount,
      currentCardCount: goalStats.currentCardCount,
      remainingToTarget: goalStats.remainingToTarget,
      repairShortfall: isRepair
    }, null, 2),
    '',
    'Prior coverage history:',
    JSON.stringify(progress.coverageHistory || [], null, 2),
    '',
    'Existing duplicate keys to avoid:',
    JSON.stringify(progress.duplicateKeys || [], null, 2),
    '',
    'Source text:',
    String(text || '').slice(0, 120000)
  ].join('\n')

  return {
    system,
    messages: [{ role: 'user', content: userContent }]
  }
}

function buildIterativeBatchRecoveryPrompt (cardFormat, contextPrompt, text, progress = {}) {
  const prompt = buildIterativeBatchPrompt(cardFormat, contextPrompt, text, progress)
  return {
    system: [
      'The previous iterative batch response could not be parsed by Cardify.',
      'Return only one valid JSON object. Do not wrap it in markdown fences.',
      'Use exactly this top-level shape: {"cards":[],"coverage":{"batchSummary":"","coveredTopics":[],"remainingFocus":"","done":false}}.',
      `Generate up to ${Number(progress.batchSize) || 10} new ${cardFormat} flashcards for the same batch. Do not repeat duplicate keys.`,
      'Every quote, newline, and backslash inside string values must be valid JSON escaping.',
      'Markdown is allowed only inside JSON string values.',
      '',
      prompt.system
    ].join('\n'),
    messages: prompt.messages
  }
}

function buildDescriptionCombinePrompt (contextPrompt, descriptions) {
  const system = [
    'You are combining Cardify chunk descriptions into one final deck overview.',
    'Return ONLY a JSON object with this exact top-level shape: {"description":{"title":"","purpose":"","contents":[]}}.',
    'Do not include cards.',
    'Create one coherent deck title, purpose, and contents list for the whole source.',
    'Do not use titles based on part, section, chunk, or numeric/card ranges.',
    'Keep the title short and the contents concise.'
  ].join('\n')

  const userContent = [
    `Context: ${contextPrompt}`,
    '',
    'Chunk descriptions:',
    JSON.stringify(descriptions.map(normalizeDescription), null, 2)
  ].join('\n')

  return {
    system,
    messages: [{ role: 'user', content: userContent }]
  }
}

function buildDeckOverviewPrompt (contextPrompt, text, options = {}) {
  const system = [
    'You are creating the global Cardify deck overview before batch card generation begins.',
    'Return ONLY a JSON object with this exact top-level shape: {"description":{"title":"","purpose":"","contents":[]}}.',
    'Do not include cards or batch coverage.',
    'Create one coherent deck title, purpose, and contents list for the whole source and user goal.',
    'Do not use titles based on part, section, chunk, batch, or numeric/card ranges.',
    'Keep the title short and useful as an Anki deck name.'
  ].join('\n')

  const userContent = [
    `Context: ${buildEffectiveContext(contextPrompt, options)}`,
    '',
    'Source excerpt:',
    String(text || '').slice(0, 24000)
  ].join('\n')

  return {
    system,
    messages: [{ role: 'user', content: userContent }]
  }
}

// ─── Text chunker ─────────────────────────────────────────────────────────────
/**
 * Split text into chunks of at most CHARS_PER_CHUNK characters,
 * never cutting in the middle of a sentence.
 * Sentence boundary is detected by `. `, `! `, or `? ` followed by
 * a capital letter or end-of-string. Falls back to hard cut if no
 * boundary is found within the chunk window.
 *
 * @param {string} text
 * @param {number} [maxChars]
 * @returns {string[]}
 */
function chunkText (text, maxChars = CHARS_PER_CHUNK) {
  if (text.length <= maxChars) return [text]

  const chunks = []
  let start = 0

  while (start < text.length) {
    if (start + maxChars >= text.length) {
      // Remaining text fits in one chunk
      chunks.push(text.slice(start))
      break
    }

    // Look for a sentence boundary in the last 2 000 chars of the window
    const window = text.slice(start, start + maxChars)
    const searchFrom = Math.max(0, window.length - 2_000)
    const sub = window.slice(searchFrom)

    // Regex: period/exclamation/question mark + space + uppercase or end
    const boundaryRe = /[.!?] (?=[A-Z]|$)/g
    let lastMatch = -1
    let m
    while ((m = boundaryRe.exec(sub)) !== null) {
      lastMatch = m.index + m[0].length - 1 // position of the space
    }

    let splitAt
    if (lastMatch >= 0) {
      // Split after the sentence-ending space
      splitAt = start + searchFrom + lastMatch + 1
    } else {
      // No sentence boundary found — hard cut at maxChars
      splitAt = start + maxChars
    }

    chunks.push(text.slice(start, splitAt).trimEnd())
    start = splitAt
    // skip leading whitespace for the next chunk
    while (start < text.length && text[start] === ' ') start++
  }

  return chunks.filter(c => c.length > 0)
}

function chunkTextWithMetadata (text, maxChars = CHARS_PER_CHUNK) {
  const chunks = chunkText(text, maxChars)
  return chunks.map((chunk, index) => ({
    text: chunk,
    index: index + 1,
    total: chunks.length
  }))
}

// ─── Single-chunk Claude call ─────────────────────────────────────────────────
/**
 * Send one chunk to Claude and return the parsed card array.
 *
 * @param {import('@anthropic-ai/sdk').default} client
 * @param {'basic'|'cloze'} cardFormat
 * @param {string} contextPrompt
 * @param {string} textChunk
 * @returns {Promise<Array>}
 */
async function callClaude (client, cardFormat, contextPrompt, chunk, options = {}) {
  const textChunk = typeof chunk === 'string' ? chunk : chunk.text
  const chunkMeta = typeof chunk === 'string' ? null : { index: chunk.index, total: chunk.total }
  const { system, messages } = buildPrompt(cardFormat, contextPrompt, textChunk, chunkMeta, options)

  let response
  try {
    response = await client.messages.create({
      model: resolveClaudeApiModel(options),
      max_tokens: 4096,
      system,
      messages
    }, { signal: options.signal })
  } catch (err) {
    if (isAbortError(err)) throw new GenerationCancelledError()
    // Detect auth errors from the SDK
    if (
      err.status === 401 ||
      (err.message && err.message.toLowerCase().includes('authentication'))
    ) {
      throw new ApiKeyError()
    }
    throw new NetworkError(err)
  }

  const rawText =
    response.content && response.content[0] && response.content[0].type === 'text'
      ? response.content[0].text
      : ''

  let payload
  try {
    payload = parseJsonFromText(rawText)
  } catch {
    throw new ParseError(rawText)
  }

  const cards = cardsCandidateFromPayload(payload)
  return {
    description: normalizeDescription(descriptionFromPayload(payload)),
    cards: normalizeCards(cards, cardFormat)
  }
}

async function callClaudeJson (client, prompt, maxTokens = 1024, options = {}) {
  let response
  try {
    response = await client.messages.create({
      model: resolveClaudeApiModel(options),
      max_tokens: maxTokens,
      system: prompt.system,
      messages: prompt.messages
    }, { signal: options.signal })
  } catch (err) {
    if (isAbortError(err)) throw new GenerationCancelledError()
    if (
      err.status === 401 ||
      (err.message && err.message.toLowerCase().includes('authentication'))
    ) {
      throw new ApiKeyError()
    }
    throw new NetworkError(err)
  }

  const rawText =
    response.content && response.content[0] && response.content[0].type === 'text'
      ? response.content[0].text
      : ''
  try {
    return parseJsonFromText(rawText)
  } catch {
    throw new ParseError(rawText)
  }
}

async function callClaudeDescriptionCombine (client, contextPrompt, descriptions, options = {}) {
  const { system, messages } = buildDescriptionCombinePrompt(contextPrompt, descriptions)

  let response
  try {
    response = await client.messages.create({
      model: resolveClaudeApiModel(options),
      max_tokens: 1024,
      system,
      messages
    }, { signal: options.signal })
  } catch (err) {
    if (isAbortError(err)) throw new GenerationCancelledError()
    if (
      err.status === 401 ||
      (err.message && err.message.toLowerCase().includes('authentication'))
    ) {
      throw new ApiKeyError()
    }
    throw new NetworkError(err)
  }

  const rawText =
    response.content && response.content[0] && response.content[0].type === 'text'
      ? response.content[0].text
      : ''
  let payload
  try {
    payload = parseJsonFromText(rawText)
  } catch {
    throw new ParseError(rawText)
  }

  return normalizeDescription(payload.description)
}

// ─── Public API ───────────────────────────────────────────────────────────────
/**
 * Generate flashcards from parsed text (used internally for .txt files).
 */
async function generateCards (parsedText, contextPrompt, cardFormat, apiKey, options = {}) {
  const Anthropic = require('@anthropic-ai/sdk')
  const client = new Anthropic({ apiKey })

  const chunks = chunkTextWithMetadata(parsedText)
  const cards = []
  const descriptions = []

  for (const chunk of chunks) {
    const generation = await callClaude(client, cardFormat, contextPrompt, chunk, options)
    descriptions.push(generation.description)
    cards.push(...generation.cards)
  }

  let description
  if (descriptions.length > 1) {
    try {
      description = await callClaudeDescriptionCombine(client, contextPrompt, descriptions, options)
    } catch {
      description = fallbackCombinedDescription(descriptions)
    }
  } else {
    description = fallbackCombinedDescription(descriptions)
  }

  return { description, cards: mergeSeedCards(cards, options.sampleCards, cardFormat) }
}

async function prepareGeneration (parsedText, contextPrompt, cardFormat, apiKey, clarificationHistory = [], options = {}) {
  const Anthropic = require('@anthropic-ai/sdk')
  const client = new Anthropic({ apiKey })
  const prompt = buildClarificationPrompt(contextPrompt, parsedText, clarificationHistory)
  const payload = await callClaudeJson(client, prompt, 1024, options)
  return normalizeClarificationResult(payload, buildEffectiveContext(contextPrompt))
}

async function generateSampleCards (parsedText, contextPrompt, cardFormat, apiKey, options = {}) {
  const Anthropic = require('@anthropic-ai/sdk')
  const client = new Anthropic({ apiKey })
  const prompt = buildSamplePrompt(cardFormat, contextPrompt, parsedText, options)
  const payload = await callClaudeJson(client, prompt, 2048, options)
  const cards = normalizeCards(cardsCandidateFromPayload(payload), cardFormat)
  if (cards.length === 0) throw new ParseError(JSON.stringify(payload || null))
  return {
    description: normalizeDescription(descriptionFromPayload(payload)),
    cards: cards.slice(0, 3)
  }
}

async function generateDeckOverview (parsedText, contextPrompt, cardFormat, apiKey, options = {}) {
  const Anthropic = require('@anthropic-ai/sdk')
  const client = new Anthropic({ apiKey })
  const prompt = buildDeckOverviewPrompt(contextPrompt, parsedText, options)
  const payload = await callClaudeJson(client, prompt, 1024, options)
  return {
    description: normalizeDescription(payload.description)
  }
}

async function generateIterativeBatch (parsedText, contextPrompt, cardFormat, apiKey, progress = {}) {
  const Anthropic = require('@anthropic-ai/sdk')
  const client = new Anthropic({ apiKey })
  let payload
  try {
    payload = await callClaudeJson(client, buildIterativeBatchPrompt(cardFormat, contextPrompt, parsedText, progress), 4096, progress)
  } catch (err) {
    if (err.code !== 'parse-error') throw err
    payload = await callClaudeJson(client, buildIterativeBatchRecoveryPrompt(cardFormat, contextPrompt, parsedText, progress), 4096, progress)
  }
  return {
    cards: normalizeCards(payload.cards, cardFormat),
    coverage: normalizeCoverage(payload.coverage)
  }
}

/**
 * Generate flashcards directly from a file path.
 * PDFs are sent as native base64 document blocks — no text extraction needed.
 * .txt files are read and chunked as before.
 */
async function generateCardsFromFile (filePath, contextPrompt, cardFormat, apiKey, options = {}) {
  const fs = require('fs')
  const path = require('path')
  const ext = path.extname(filePath).toLowerCase()

  if (ext === '.pdf') {
    const Anthropic = require('@anthropic-ai/sdk')
    const client = new Anthropic({ apiKey })

    const formatInstruction = cardFormat === 'basic'
      ? 'Basic: [{"front": "...", "back": "..."}]'
      : 'Cloze: [{"text": "{{c1::term}} is ..."}]'

    const system =
      `You are a flashcard generation expert. Generate ${cardFormat} flashcards from the provided document.\n` +
      `Tune the cards specifically to the user's context — emphasize what matters for their stated goal.\n` +
      `Write card fields in concise markdown where it improves readability: **bold**, _italic_, lists, tables, blockquotes, and inline/fenced code.\n` +
      `For Basic cards, keep the front short and mostly plain; use richer markdown mainly in the back.\n` +
      `For Cloze cards, preserve valid Anki cloze syntax like {{c1::term}} and use markdown sparingly around it.\n` +
      `For color emphasis, use only <mark>, <span class="cf-key">, <span class="cf-warning">, <span class="cf-success">, or <span class="cf-muted">. Do not use inline styles, arbitrary classes, scripts, or decorative HTML.\n` +
      `${SEMANTIC_HIGHLIGHT_GUIDANCE}\n` +
      `${SEMANTIC_AUDIO_GUIDANCE}\n` +
      `Return ONLY a JSON array, no explanation:\n` +
      `- ${formatInstruction}`

    const base64 = fs.readFileSync(filePath).toString('base64')

    let response
    try {
      response = await client.messages.create({
        model: resolveClaudeApiModel(options),
        max_tokens: 4096,
        system,
        messages: [{
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
            { type: 'text', text: `Context: ${contextPrompt}\n\nGenerate flashcards from this document.` }
          ]
        }]
      }, { signal: options.signal })
    } catch (err) {
      if (isAbortError(err)) throw new GenerationCancelledError()
      if (err.status === 401 || (err.message && err.message.toLowerCase().includes('authentication'))) {
        throw new ApiKeyError()
      }
      throw new NetworkError(err)
    }

    const rawText = response.content?.[0]?.type === 'text' ? response.content[0].text : ''
    let cards
    try {
      cards = cardsCandidateFromPayload(parseJsonFromText(rawText))
    } catch {
      throw new ParseError(rawText)
    }
    if (!Array.isArray(cards)) throw new ParseError(rawText)

    return cards.map(card => cardFormat === 'basic'
      ? { front: String(card.front ?? ''), back: String(card.back ?? ''), type: 'basic' }
      : { text: String(card.text ?? ''), type: 'cloze' }
    )
  }

  // .txt — read and use text-based generation
  const text = fs.readFileSync(filePath, 'utf-8')
  return generateCards(text, contextPrompt, cardFormat, apiKey, options)
}

module.exports = {
  generateCards,
  prepareGeneration,
  generateSampleCards,
  generateDeckOverview,
  generateIterativeBatch,
  generateCardsFromFile,
  chunkText,
  chunkTextWithMetadata,
  buildPrompt,
  buildClarificationPrompt,
  buildSamplePrompt,
  buildDeckOverviewPrompt,
  buildIterativeBatchPrompt,
  buildIterativeBatchRecoveryPrompt,
  buildDescriptionCombinePrompt,
  fallbackCombinedDescription,
  normalizeCoverage,
  mergeSeedCards,
  resolveClaudeApiModel,
  DEFAULT_CLAUDE_API_MODEL,
  ApiKeyError,
  ParseError,
  GenerationCancelledError,
  NetworkError
}
