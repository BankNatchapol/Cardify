'use strict'

const { spawn } = require('child_process')
const { chunkTextWithMetadata, ParseError, mergeSeedCards } = require('./claude')
const {
  parseJsonFromText,
  unwrapClaudePayload,
  cardsCandidateFromPayload,
  descriptionFromPayload
} = require('./generationParsing')
const { generationGoalStats } = require('./generationGoal.cjs')

const DEFAULT_CLAUDE_CODE_TIMEOUT_MS = 1200000

class ClaudeCodeUnavailableError extends Error {
  constructor (message = 'Claude Code is not available or not authenticated') {
    super(message)
    this.name = 'ClaudeCodeUnavailableError'
    this.code = 'claude-code-unavailable'
  }
}

class ClaudeCodeError extends Error {
  constructor (message, code = 'claude-code-error') {
    super(message)
    this.name = 'ClaudeCodeError'
    this.code = code
  }
}

class ClaudeCodeCancelledError extends Error {
  constructor (message = 'Generation was cancelled') {
    super(message)
    this.name = 'ClaudeCodeCancelledError'
    this.code = 'generation-cancelled'
  }
}

function createClaudeCodeEnv (baseEnv = process.env) {
  const env = {
    ...baseEnv,
    PATH: [
      baseEnv.PATH || '',
      '/opt/homebrew/bin',
      '/usr/local/bin'
    ].filter(Boolean).join(':')
  }

  // Cardify uses Claude Code through the user's Claude Code login. API-key
  // provider variables can force `claude` into metered API billing mode.
  for (const key of [
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_AUTH_TOKEN',
    'ANTHROPIC_BASE_URL',
    'ANTHROPIC_MODEL',
    'ANTHROPIC_SMALL_FAST_MODEL',
    'CLAUDE_CODE_USE_BEDROCK',
    'CLAUDE_CODE_USE_VERTEX',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_SESSION_TOKEN',
    'GOOGLE_APPLICATION_CREDENTIALS'
  ]) {
    delete env[key]
  }

  return env
}

function claudeCodeResultErrorMessage (stdout) {
  try {
    const parsed = JSON.parse(String(stdout || '').trim())
    if (parsed?.is_error) return String(parsed.result || parsed.error || 'Claude Code returned an error').trim()
  } catch {
    // Non-JSON output is handled by the normal parser path.
  }
  return null
}

function isClaudeCodeBillingError (message) {
  return /credit balance is too low|insufficient credit|billing/i.test(String(message || ''))
}

function createClaudeCodeBillingError () {
  return new ClaudeCodeUnavailableError('Claude Code is using API billing, but the API credit balance is too low. Cardify now removes API-key environment variables before launching Claude Code; restart Cardify and make sure `claude auth status` shows your Claude Code subscription.')
}

function runClaudeCommand (args, input = '', options = {}) {
  return new Promise((resolve, reject) => {
    const env = createClaudeCodeEnv()

    const child = spawn('claude', args, {
      cwd: options.cwd || process.cwd(),
      env,
      stdio: ['pipe', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''
    let settled = false
    const timeoutMs = options.timeoutMs || getClaudeCodeTimeoutMs()
    let abortListener = null

    function killChild () {
      child.kill('SIGTERM')
      setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL')
      }, 5000).unref?.()
    }

    function settle (fn) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (options.signal && abortListener) {
        options.signal.removeEventListener('abort', abortListener)
      }
      fn()
    }

    const timer = setTimeout(() => {
      settle(() => {
        killChild()
        reject(new ClaudeCodeError(`Claude Code timed out after ${Math.round(timeoutMs / 1000)} seconds while generating cards`, 'claude-code-timeout'))
      })
    }, timeoutMs)

    if (options.signal) {
      if (options.signal.aborted) {
        settle(() => {
          killChild()
          reject(new ClaudeCodeCancelledError())
        })
        return
      }
      abortListener = () => {
        settle(() => {
          killChild()
          reject(new ClaudeCodeCancelledError())
        })
      }
      options.signal.addEventListener('abort', abortListener, { once: true })
    }

    child.stdout.on('data', chunk => { stdout += chunk.toString('utf8') })
    child.stderr.on('data', chunk => { stderr += chunk.toString('utf8') })
    child.on('error', err => {
      settle(() => {
        if (err.code === 'ENOENT') {
          reject(new ClaudeCodeUnavailableError('Claude Code CLI was not found on PATH'))
        } else {
          reject(new ClaudeCodeError(err.message))
        }
      })
    })
    child.on('close', code => {
      settle(() => {
        if (code !== 0) {
          const message = (stderr || stdout || `Claude Code exited with code ${code}`).trim()
          if (/not logged in|login|authentication|auth/i.test(message)) {
            reject(new ClaudeCodeUnavailableError(message))
          } else if (isClaudeCodeBillingError(message)) {
            reject(createClaudeCodeBillingError())
          } else {
            reject(new ClaudeCodeError(message))
          }
          return
        }
        const resultError = claudeCodeResultErrorMessage(stdout)
        if (resultError) {
          if (isClaudeCodeBillingError(resultError)) {
            reject(createClaudeCodeBillingError())
          } else {
            reject(new ClaudeCodeError(resultError))
          }
          return
        }
        resolve({ stdout, stderr })
      })
    })

    child.stdin.end(input)
  })
}

function getClaudeCodeTimeoutMs () {
  const configured = Number(process.env.CARDIFY_CLAUDE_CODE_TIMEOUT_MS)
  if (Number.isFinite(configured) && configured >= 30000) return configured
  return DEFAULT_CLAUDE_CODE_TIMEOUT_MS
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

function buildClaudeCodePrompt (cardFormat, contextPrompt, textChunk, chunkMeta = null, options = {}) {
  const formatInstruction =
    cardFormat === 'basic'
      ? 'Each card must have "front" and "back" strings. Keep "front" concise and mostly plain; use markdown-rich structure mainly in "back" when it improves review.'
      : 'Each card must have a "text" string using Anki cloze syntax like {{c1::term}}. Preserve valid cloze syntax and use markdown sparingly around it.'
  const isMultiChunk = chunkMeta && chunkMeta.total > 1
  const sourceScope = isMultiChunk
    ? `This is chunk ${chunkMeta.index} of ${chunkMeta.total} from a larger source. Generate cards only from this chunk. The description is temporary chunk metadata for a later combine step.`
    : 'Generate from the complete provided source text.'

  return [
    `Generate a Cardify project from the source text.`,
    sourceScope,
    `The project must include both a deck description and ${cardFormat} Anki flashcards.`,
    `Tune both the description and cards to the user's context and study goal.`,
    `Write card fields in concise markdown where it improves readability: **bold**, _italic_, bullet/numbered lists, tables, blockquotes, and inline/fenced code.`,
    `For color emphasis, use only semantic HTML: <mark>, <span class="cf-key">, <span class="cf-warning">, <span class="cf-success">, or <span class="cf-muted">. Do not use inline styles, arbitrary classes, scripts, or decorative HTML.`,
    SEMANTIC_HIGHLIGHT_GUIDANCE,
    SEMANTIC_AUDIO_GUIDANCE,
    `Return only data matching the provided JSON schema. No prose.`,
    `Your final answer must begin with "{" and end with "}".`,
    `Do not say "I've generated", "Here is", "Summary", or any other explanatory text.`,
    `Put deck/project overview information only in "description".`,
    `Do not name the project as a part, section, chunk, or card range even if this request contains only part of a larger source.`,
    `Put only real reviewable flashcards in "cards".`,
    `Do not put card-format examples, headings, study tips, or template descriptions in "cards".`,
    `Every card must contain concrete study content from the source text, not placeholders.`,
    formatInstruction,
    `The description title should be short. The purpose should say what the deck is for. The contents array should name the main topics covered.`,
    '',
    `Context: ${buildEffectiveContext(contextPrompt, options)}`,
    '',
    `Source text:`,
    textChunk
  ].join('\n')
}

function buildClaudeCodeRecoveryPrompt (cardFormat, contextPrompt, textChunk, chunkMeta = null) {
  const cardShape = cardFormat === 'basic'
    ? '{"front":"short prompt","back":"markdown answer","type":"basic"}'
    : '{"text":"Anki cloze text with {{c1::answer}}","type":"cloze"}'
  const isMultiChunk = chunkMeta && chunkMeta.total > 1
  const sourceScope = isMultiChunk
    ? `This is recovery for chunk ${chunkMeta.index} of ${chunkMeta.total}. Generate cards only from this chunk. The description is temporary chunk metadata, not the final project overview.`
    : 'Generate from the complete provided source text.'

  return [
    'The previous response could not be parsed by Cardify.',
    sourceScope,
    'Return only a valid JSON object. Do not wrap it in markdown fences. Do not include any explanatory text before or after the JSON.',
    'Use this exact top-level shape: {"description":{"title":"","purpose":"","contents":[]},"cards":[]}.',
    `Each card must match this shape: ${cardShape}.`,
    'For sample-card recovery, return exactly 3 cards unless the source has fewer than 3 meaningful facts.',
    'Every quote, newline, and backslash inside string values must be valid JSON escaping.',
    'Markdown is allowed only inside JSON string values.',
    'For Basic cards, keep front concise and improve back with markdown when helpful.',
    'Use only these semantic color tags in strings when useful: <mark>, <span class="cf-key">, <span class="cf-warning">, <span class="cf-success">, <span class="cf-muted">.',
    SEMANTIC_HIGHLIGHT_GUIDANCE,
    SEMANTIC_AUDIO_GUIDANCE,
    '',
    `Context: ${contextPrompt}`,
    '',
    'Source text:',
    textChunk
  ].join('\n')
}

function buildClaudeCodeDescriptionCombinePrompt (contextPrompt, descriptions) {
  return [
    'Combine these Cardify chunk descriptions into one final deck overview.',
    'Return only a valid JSON object matching the provided schema. No prose.',
    'Return only "description"; do not include cards.',
    'Create one coherent deck title, purpose, and contents list for the whole source.',
    'Do not use a title based on a part, section, chunk, or numeric/card range.',
    'Keep the title short and the contents concise.',
    '',
    `Context: ${contextPrompt}`,
    '',
    'Chunk descriptions:',
    JSON.stringify(descriptions.map(normalizeDescription), null, 2)
  ].join('\n')
}

function buildClaudeCodeDeckOverviewPrompt (contextPrompt, text, options = {}) {
  return [
    'You are creating the global Cardify deck overview before batch card generation begins.',
    'Return only a valid JSON object matching the provided schema. No prose.',
    'Return only "description"; do not include cards or batch coverage.',
    'Create one coherent deck title, purpose, and contents list for the whole source and user goal.',
    'Do not use a title based on a part, section, chunk, batch, or numeric/card range.',
    'Keep the title short and useful as an Anki deck name.',
    '',
    `Context: ${buildEffectiveContext(contextPrompt, options)}`,
    '',
    'Source excerpt:',
    String(text || '').slice(0, 24000)
  ].join('\n')
}

function buildClaudeCodeClarificationPrompt (contextPrompt, text, clarificationHistory = [], maxQuestions = 5) {
  const answeredCount = Array.isArray(clarificationHistory) ? clarificationHistory.length : 0
  const remaining = Math.max(0, maxQuestions - answeredCount)
  return [
    'You are Cardify\'s clarification assistant for flashcard generation.',
    'Decide whether the user intent is clear enough to generate high-quality flashcards.',
    `Ask 1-2 targeted questions only if they materially affect card quality. Hard cap: ${maxQuestions} total clarification questions across the whole flow.`,
    'Clarify rubric: prefer output language for cards/explanations when unclear, audience/level, exam or use case, desired granularity, terminology, card style, audio placement for spoken study content, and what to omit.',
    'If spoken audio placement is ambiguous for a language-learning deck, ask whether audio should appear on fronts, example sentences, both, or neither. Cardify uses semantic tags like {{audio:front}} and {{audio:example_1}}.',
    'If the desired card/explanation language is not clearly stated, ask what language or mix of languages to use.',
    'Avoid asking about details already obvious from the source text or user context.',
    'If the intent is clear, stop asking and produce a concise clarifiedContext.',
    'Return only JSON matching the schema. No prose.',
    '',
    `Original context: ${contextPrompt}`,
    `Questions remaining: ${remaining}`,
    '',
    'Clarification history:',
    JSON.stringify(clarificationHistory || [], null, 2),
    '',
    'Source excerpt:',
    String(text || '').slice(0, 12000)
  ].join('\n')
}

function buildClaudeCodeSamplePrompt (cardFormat, contextPrompt, text, options = {}) {
  const formatInstruction = cardFormat === 'basic'
    ? 'Each sample card must have "front" and "back" strings.'
    : 'Each sample card must have a "text" string using valid Anki cloze syntax like {{c1::term}}.'

  return [
    'You are generating sample Cardify flashcards before the full deck is created.',
    `Generate exactly 3 ${cardFormat} sample flashcards from the source text.`,
    'These are examples for user approval, so prioritize representative cards that reveal style and content choices.',
    'Use the clarified requirements, user feedback, and accepted sample cards as style guidance.',
    'Do not copy accepted sample cards into the new sample set unless necessary to show a corrected version.',
    'Write card fields in concise markdown where it improves readability.',
    'Use semantic highlights when useful: <mark>, <span class="cf-key">, <span class="cf-warning">, <span class="cf-success">, <span class="cf-muted">.',
    SEMANTIC_HIGHLIGHT_GUIDANCE,
    SEMANTIC_AUDIO_GUIDANCE,
    'Return only JSON matching the schema. No prose.',
    formatInstruction,
    '',
    `Context: ${buildEffectiveContext(contextPrompt, options)}`,
    '',
    'Source excerpt:',
    String(text || '').slice(0, 24000)
  ].join('\n')
}

function buildClaudeCodeIterativeBatchPrompt (cardFormat, contextPrompt, text, progress = {}) {
  const batchSize = Number(progress.batchSize) || 10
  const nextBatch = (Number(progress.completedBatches) || 0) + 1
  const maxBatches = Number(progress.maxBatches) || 20
  const goalStats = generationGoalStats(progress, Number(progress.currentCardCount) || (Array.isArray(progress.duplicateKeys) ? progress.duplicateKeys.length : 0))
  const isRepair = progress.status === 'repairing_shortfall'
  const requestedCount = isRepair && goalStats.remainingToTarget
    ? goalStats.remainingToTarget
    : batchSize
  const formatInstruction = cardFormat === 'basic'
    ? 'Each card must have "front" and "back" strings. Keep fronts short; make backs useful with markdown where it improves review.'
    : 'Each card must have a "text" string using valid Anki cloze syntax like {{c1::term}}.'

  return [
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
    'Return only JSON matching the schema. No prose.',
    'Use this top-level shape: {"cards":[],"coverage":{"batchSummary":"","coveredTopics":[],"remainingFocus":"","done":false}}.',
    formatInstruction,
    '',
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
}

function buildClaudeCodeIterativeBatchRecoveryPrompt (cardFormat, contextPrompt, text, progress = {}) {
  return [
    'The previous iterative batch response could not be parsed by Cardify.',
    'Return only one valid JSON object. Do not wrap it in markdown fences.',
    'Use exactly this top-level shape: {"cards":[],"coverage":{"batchSummary":"","coveredTopics":[],"remainingFocus":"","done":false}}.',
    `Generate up to ${Number(progress.batchSize) || 10} new ${cardFormat} flashcards for the same batch. Do not repeat duplicate keys.`,
    'Every quote, newline, and backslash inside string values must be valid JSON escaping.',
    'Markdown is allowed only inside JSON string values.',
    '',
    buildClaudeCodeIterativeBatchPrompt(cardFormat, contextPrompt, text, progress)
  ].join('\n')
}

function outputSchemaForFormat (cardFormat) {
  const cardProperties = cardFormat === 'basic'
    ? {
        front: { type: 'string' },
        back: { type: 'string' }
      }
    : {
        text: { type: 'string' }
      }

  return {
    type: 'object',
    additionalProperties: false,
    required: ['description', 'cards'],
    properties: {
      description: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'purpose', 'contents'],
        properties: {
          title: { type: 'string' },
          purpose: { type: 'string' },
          contents: {
            type: 'array',
            items: { type: 'string' }
          }
        }
      },
      cards: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: Object.keys(cardProperties),
          properties: cardProperties
        }
      }
    }
  }
}

function outputDescriptionSchema () {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['description'],
    properties: {
      description: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'purpose', 'contents'],
        properties: {
          title: { type: 'string' },
          purpose: { type: 'string' },
          contents: {
            type: 'array',
            items: { type: 'string' }
          }
        }
      }
    }
  }
}

function outputClarificationSchema () {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['status'],
    properties: {
      status: { type: 'string', enum: ['questions', 'clear'] },
      questions: {
        type: 'array',
        items: { type: 'string' }
      },
      clarifiedContext: { type: 'string' }
    }
  }
}

function outputIterativeBatchSchema (cardFormat) {
  const base = outputSchemaForFormat(cardFormat)
  return {
    type: 'object',
    additionalProperties: false,
    required: ['cards', 'coverage'],
    properties: {
      cards: base.properties.cards,
      coverage: {
        type: 'object',
        additionalProperties: false,
        required: ['batchSummary', 'coveredTopics', 'remainingFocus', 'done'],
        properties: {
          batchSummary: { type: 'string' },
          coveredTopics: {
            type: 'array',
            items: { type: 'string' }
          },
          remainingFocus: { type: 'string' },
          done: { type: 'boolean' }
        }
      }
    }
  }
}

function defaultDescription () {
  return {
    title: 'Generated Cardify Project',
    purpose: '',
    contents: []
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
  if (!Array.isArray(cards)) return null

  return cards.map(card =>
    cardFormat === 'basic'
      ? { front: String(card.front ?? ''), back: String(card.back ?? ''), type: 'basic' }
      : { text: String(card.text ?? ''), type: 'cloze' }
  ).filter(card => !isTemplateCard(card))
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

function extractGenerationFromClaudeCodeOutput (stdout, cardFormat) {
  const trimmed = stdout.trim()
  let parsed
  try {
    parsed = parseJsonFromText(trimmed)
  } catch {
    throw new ParseError(stdout)
  }

  let payload
  try {
    payload = unwrapClaudePayload(parsed)
  } catch {
    payload = null
  }

  if (!payload && typeof parsed.result === 'string') {
    const resultText = parsed.result.trim()
    try {
      payload = parseJsonFromText(resultText)
    } catch {
      const markdownCards = parseMarkdownCards(resultText, cardFormat)
      if (markdownCards.length > 0) {
        return {
          description: defaultDescription(),
          cards: markdownCards
        }
      }
      throw new ParseError(parsed.result)
    }
  }

  const cards = normalizeCards(cardsCandidateFromPayload(payload), cardFormat)
  if (!cards || cards.length === 0) throw new ParseError(stdout)

  return {
    description: normalizeDescription(descriptionFromPayload(payload)),
    cards
  }
}

function extractIterativeBatchFromClaudeCodeOutput (stdout, cardFormat) {
  const trimmed = stdout.trim()
  let parsed
  try {
    parsed = parseJsonFromText(trimmed)
  } catch {
    throw new ParseError(stdout)
  }

  let payload
  try {
    payload = unwrapClaudePayload(parsed)
  } catch {
    throw new ParseError(stdout)
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new ParseError(stdout)
  }

  const cards = normalizeCards(cardsCandidateFromPayload(payload), cardFormat)
  if (!cards || cards.length === 0) throw new ParseError(stdout)

  return {
    cards,
    coverage: normalizeCoverage(payload.coverage)
  }
}

function extractCardsFromClaudeCodeOutput (stdout, cardFormat) {
  return extractGenerationFromClaudeCodeOutput(stdout, cardFormat).cards
}

function extractDescriptionFromClaudeCodeOutput (stdout) {
  const trimmed = stdout.trim()
  let parsed
  try {
    parsed = parseJsonFromText(trimmed)
  } catch {
    throw new ParseError(stdout)
  }

  let payload
  try {
    payload = unwrapClaudePayload(parsed)
  } catch {
    throw new ParseError(stdout)
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new ParseError(stdout)
  }

  return normalizeDescription(payload.description)
}

function extractClarificationFromClaudeCodeOutput (stdout, fallbackContext = '') {
  const trimmed = stdout.trim()
  let parsed
  try {
    parsed = parseJsonFromText(trimmed)
  } catch {
    throw new ParseError(stdout)
  }

  let payload
  try {
    payload = unwrapClaudePayload(parsed)
  } catch {
    throw new ParseError(stdout)
  }

  return normalizeClarificationResult(payload, fallbackContext)
}

function normalizeClaudeCodeModel (model = 'default') {
  const normalized = String(model || 'default').trim()
  return normalized || 'default'
}

function buildGenerationCommandArgs (schema, useSchema = true, options = {}) {
  const model = normalizeClaudeCodeModel(options.claudeCodeModel)
  const args = [
    '-p',
    '--output-format', 'json',
    '--no-session-persistence',
    '--permission-mode', 'dontAsk',
    '--disable-slash-commands',
    '--system-prompt', useSchema
      ? 'You are a strict JSON API for generating Cardify projects. Return exactly one JSON object matching the schema. Markdown is allowed only inside JSON string field values. No prose, no summary.'
      : 'You are a strict JSON API for generating Cardify projects. Return exactly one valid JSON object in your result field. Markdown is allowed only inside JSON string field values. No prose, no summary.',
    '--tools', ''
  ]

  if (model !== 'default') {
    args.splice(3, 0, '--model', model)
  }

  if (useSchema) {
    args.push('--json-schema', schema)
  }

  return args
}

function parseMarkdownCards (text, cardFormat) {
  const normalizedText = text.replace(/\\n/g, '\n')
  if (cardFormat === 'cloze') {
    return normalizedText
      .split('\n')
      .map(line => line.replace(/^\s*(?:[-*]|\d+\.)\s*/, '').trim())
      .filter(line => line.includes('{{c'))
      .map(line => ({ text: line, type: 'cloze' }))
      .filter(card => !isTemplateCard(card))
  }

  const cards = []
  const pairRe = /(?:^|\n)\s*(?:[-*]|\d+\.)?\s*\*\*Front:\*\*\s*([\s\S]*?)(?=\n\s*(?:[-*]|\d+\.)?\s*\*\*Back:\*\*)\n\s*(?:[-*]|\d+\.)?\s*\*\*Back:\*\*\s*([\s\S]*?)(?=\n\s*(?:[-*]|\d+\.)?\s*\*\*Front:\*\*|\n\s*\d+\.\s|\n\s*---|$)/gi
  let match
  while ((match = pairRe.exec(normalizedText)) !== null) {
    const front = match[1].trim()
    const back = match[2].trim()
    if (front && back) cards.push({ front, back, type: 'basic' })
  }
  return cards.filter(card => !isTemplateCard(card))
}

function isTemplateCard (card) {
  const haystack = card.type === 'cloze'
    ? String(card.text || '')
    : `${card.front || ''} ${card.back || ''}`
  const normalized = haystack.toLowerCase()

  return [
    'chinese character + pinyin',
    'english meaning + a sample sentence',
    'sample sentence (drawn from the source text)',
    'study tips for hsk',
    'front:',
    'back:'
  ].some(marker => normalized.includes(marker))
}

async function getClaudeCodeStatus () {
  try {
    const { stdout } = await runClaudeCommand(['auth', 'status'], '', { timeoutMs: 10000 })
    const status = JSON.parse(stdout)
    return {
      available: true,
      loggedIn: Boolean(status.loggedIn),
      authMethod: status.authMethod || null,
      email: status.email || null,
      subscriptionType: status.subscriptionType || null
    }
  } catch (err) {
    return {
      available: false,
      loggedIn: false,
      error: err.message
    }
  }
}

async function readSourceText (filePath, sourceText = null) {
  const fs = require('fs')
  const path = require('path')

  if (typeof sourceText === 'string' && sourceText.trim().length > 0) {
    return sourceText
  }
  const ext = path.extname(filePath || '').toLowerCase()
  if (ext === '.pdf') {
    const { parseFile } = require('./parser')
    return parseFile(filePath)
  }
  return fs.readFileSync(filePath, 'utf-8')
}

async function prepareGenerationClaudeCode (filePath, contextPrompt, cardFormat, sourceText = null, clarificationHistory = [], options = {}) {
  const text = await readSourceText(filePath, sourceText)
  const schema = JSON.stringify(outputClarificationSchema())
  const prompt = buildClaudeCodeClarificationPrompt(contextPrompt, text, clarificationHistory)
  const { stdout, stderr } = await runClaudeCommand(buildGenerationCommandArgs(schema, true, options), prompt, { signal: options.signal })
  return extractClarificationFromClaudeCodeOutput(stdout, buildEffectiveContext(contextPrompt))
}

async function generateSampleCardsClaudeCode (filePath, contextPrompt, cardFormat, sourceText = null, options = {}) {
  const text = await readSourceText(filePath, sourceText)
  const schema = JSON.stringify(outputSchemaForFormat(cardFormat))
  const prompt = buildClaudeCodeSamplePrompt(cardFormat, contextPrompt, text, options)
  const { stdout, stderr } = await runClaudeCommand(buildGenerationCommandArgs(schema, true, options), prompt, { signal: options.signal })
  let generation
  try {
    generation = extractGenerationFromClaudeCodeOutput(stdout, cardFormat)
  } catch (err) {
    if (err.code !== 'parse-error') throw err
    options.debugLog?.({
      provider: 'claude-code',
      status: 'parse-error',
      retry: false,
      promptLength: prompt.length,
      sourceLength: text.length,
      error: err,
      stdout,
      stderr
    })
    options.debugLog?.({
      provider: 'claude-code',
      status: 'retry-start',
      retry: true,
      promptLength: prompt.length,
      sourceLength: text.length
    })
    const retryPrompt = buildClaudeCodeRecoveryPrompt(
      cardFormat,
      buildEffectiveContext(contextPrompt, options),
      text.slice(0, 24000)
    )
    const retry = await runClaudeCommand(buildGenerationCommandArgs(schema, false, options), retryPrompt, { signal: options.signal })
    try {
      generation = extractGenerationFromClaudeCodeOutput(retry.stdout, cardFormat)
    } catch (retryErr) {
      if (retryErr.code === 'parse-error') {
        options.debugLog?.({
          provider: 'claude-code',
          status: 'parse-error',
          retry: true,
          promptLength: retryPrompt.length,
          sourceLength: text.length,
          error: retryErr,
          stdout: retry.stdout,
          stderr: retry.stderr
        })
      }
      throw retryErr
    }
  }
  return {
    description: generation.description,
    cards: generation.cards.slice(0, 3)
  }
}

async function generateDeckOverviewClaudeCode (filePath, contextPrompt, cardFormat, sourceText = null, options = {}) {
  const text = await readSourceText(filePath, sourceText)
  const schema = JSON.stringify(outputDescriptionSchema())
  const prompt = buildClaudeCodeDeckOverviewPrompt(contextPrompt, text, options)
  const { stdout } = await runClaudeCommand(buildGenerationCommandArgs(schema, true, options), prompt, { signal: options.signal })
  return {
    description: extractDescriptionFromClaudeCodeOutput(stdout)
  }
}

async function generateCardsClaudeCode (filePath, contextPrompt, cardFormat, sourceText = null, options = {}) {
  const text = await readSourceText(filePath, sourceText)

  const chunks = chunkTextWithMetadata(text)
  const cards = []
  const descriptions = []
  const schema = JSON.stringify(outputSchemaForFormat(cardFormat))

  for (const chunk of chunks) {
    const chunkMeta = { index: chunk.index, total: chunk.total }
    const prompt = buildClaudeCodePrompt(cardFormat, contextPrompt, chunk.text, chunkMeta, options)
    const { stdout } = await runClaudeCommand(buildGenerationCommandArgs(schema, true, options), prompt, { signal: options.signal })
    let generation
    try {
      generation = extractGenerationFromClaudeCodeOutput(stdout, cardFormat)
    } catch (err) {
      if (err.code !== 'parse-error') throw err
      const retryPrompt = buildClaudeCodeRecoveryPrompt(cardFormat, contextPrompt, chunk.text, chunkMeta)
      const retry = await runClaudeCommand(buildGenerationCommandArgs(schema, false, options), retryPrompt, { signal: options.signal })
      generation = extractGenerationFromClaudeCodeOutput(retry.stdout, cardFormat)
    }
    descriptions.push(generation.description)
    cards.push(...generation.cards)
  }

  let description
  if (descriptions.length > 1) {
    try {
      const descriptionSchema = JSON.stringify(outputDescriptionSchema())
      const combinePrompt = buildClaudeCodeDescriptionCombinePrompt(contextPrompt, descriptions)
      const combined = await runClaudeCommand(buildGenerationCommandArgs(descriptionSchema, true, options), combinePrompt, { signal: options.signal })
      description = extractDescriptionFromClaudeCodeOutput(combined.stdout)
    } catch {
      description = fallbackCombinedDescription(descriptions)
    }
  } else {
    description = fallbackCombinedDescription(descriptions)
  }

  return {
    description,
    cards: mergeSeedCards(cards, options.sampleCards, cardFormat)
  }
}

async function generateIterativeBatchClaudeCode (filePath, contextPrompt, cardFormat, sourceText = null, progress = {}) {
  const text = await readSourceText(filePath, sourceText)
  const schema = JSON.stringify(outputIterativeBatchSchema(cardFormat))
  const prompt = buildClaudeCodeIterativeBatchPrompt(cardFormat, contextPrompt, text, progress)
  const { stdout } = await runClaudeCommand(buildGenerationCommandArgs(schema, true, progress), prompt, { signal: progress.signal })
  try {
    return extractIterativeBatchFromClaudeCodeOutput(stdout, cardFormat)
  } catch (err) {
    if (err.code !== 'parse-error') throw err
    const retryPrompt = buildClaudeCodeIterativeBatchRecoveryPrompt(cardFormat, contextPrompt, text, progress)
    const retry = await runClaudeCommand(buildGenerationCommandArgs(schema, false, progress), retryPrompt, { signal: progress.signal })
    return extractIterativeBatchFromClaudeCodeOutput(retry.stdout, cardFormat)
  }
}

module.exports = {
  generateCardsClaudeCode,
  prepareGenerationClaudeCode,
  generateSampleCardsClaudeCode,
  generateDeckOverviewClaudeCode,
  generateIterativeBatchClaudeCode,
  getClaudeCodeStatus,
  buildClaudeCodePrompt,
  buildClaudeCodeRecoveryPrompt,
  buildClaudeCodeDescriptionCombinePrompt,
  buildClaudeCodeClarificationPrompt,
  buildClaudeCodeSamplePrompt,
  buildClaudeCodeDeckOverviewPrompt,
  buildClaudeCodeIterativeBatchPrompt,
  buildClaudeCodeIterativeBatchRecoveryPrompt,
  buildGenerationCommandArgs,
  normalizeClaudeCodeModel,
  extractGenerationFromClaudeCodeOutput,
  extractIterativeBatchFromClaudeCodeOutput,
  extractCardsFromClaudeCodeOutput,
  extractDescriptionFromClaudeCodeOutput,
  extractClarificationFromClaudeCodeOutput,
  outputSchemaForFormat,
  outputDescriptionSchema,
  outputClarificationSchema,
  outputIterativeBatchSchema,
  parseMarkdownCards,
  parseJsonFromText,
  getClaudeCodeTimeoutMs,
  isTemplateCard,
  isChunkDescription,
  normalizeDescription,
  normalizeCoverage,
  fallbackCombinedDescription,
  createClaudeCodeEnv,
  claudeCodeResultErrorMessage,
  ClaudeCodeUnavailableError,
  ClaudeCodeError,
  ClaudeCodeCancelledError
}
