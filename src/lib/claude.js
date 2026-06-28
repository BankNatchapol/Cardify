'use strict'
/**
 * claude.js — runs in the Electron main process only.
 *
 * Exports:
 *   generateCards(parsedText, contextPrompt, cardFormat, apiKey)
 *     -> Array<{front, back, type: 'basic'}> | Array<{text, type: 'cloze'}>
 *
 * Long texts are split into ~8000-token chunks (≈ 32 000 chars).
 * Each chunk is sent in a separate claude-sonnet-4-6 call and results
 * are concatenated before returning.
 *
 * Throws:
 *   ApiKeyError   — HTTP 401 from the Claude API
 *   ParseError    — JSON parsing of the model response failed
 *   NetworkError  — any other Anthropic SDK / network error
 */

// ─── Token / character budget ────────────────────────────────────────────────
// claude-sonnet-4-6 context window: 200k tokens.
// We budget 8 000 tokens per input chunk ≈ 32 000 chars (4 chars/token average).
// This is conservative and keeps each call well within limits.
const CHARS_PER_CHUNK = 32_000

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
    super(`Failed to parse Claude response as JSON: ${raw.slice(0, 120)}`)
    this.name = 'ParseError'
    this.code = 'parse-error'
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

// ─── Prompt builder ───────────────────────────────────────────────────────────
/**
 * Build the messages array for a single claude-sonnet-4-6 call.
 *
 * @param {'basic'|'cloze'} cardFormat
 * @param {string} contextPrompt
 * @param {string} textChunk
 * @returns {{ system: string, messages: Array }}
 */
function buildPrompt (cardFormat, contextPrompt, textChunk) {
  const formatInstruction =
    cardFormat === 'basic'
      ? 'Basic: [{"front": "...", "back": "..."}]'
      : 'Cloze: [{"text": "{{c1::term}} is ..."}]'

  const system =
    `You are a flashcard generation expert. Generate ${cardFormat} flashcards from the provided text.\n` +
    `Tune the cards specifically to the user's context — emphasize what matters for their stated goal,\n` +
    `omit or deprioritize what doesn't.\n` +
    `Return ONLY a JSON array, no explanation:\n` +
    `- ${formatInstruction}`

  const userContent =
    `Context: ${contextPrompt}\nText: ${textChunk}`

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
async function callClaude (client, cardFormat, contextPrompt, textChunk) {
  const { system, messages } = buildPrompt(cardFormat, contextPrompt, textChunk)

  let response
  try {
    response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system,
      messages
    })
  } catch (err) {
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

  // Strip markdown code fences if the model wrapped the JSON
  const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()

  let cards
  try {
    cards = JSON.parse(cleaned)
  } catch {
    throw new ParseError(rawText)
  }

  if (!Array.isArray(cards)) throw new ParseError(rawText)

  // Normalise: ensure each card has the expected `type` field
  return cards.map(card => {
    if (cardFormat === 'basic') {
      return { front: String(card.front ?? ''), back: String(card.back ?? ''), type: 'basic' }
    } else {
      return { text: String(card.text ?? ''), type: 'cloze' }
    }
  })
}

// ─── Public API ───────────────────────────────────────────────────────────────
/**
 * Generate flashcards from parsed text (used internally for .txt files).
 */
async function generateCards (parsedText, contextPrompt, cardFormat, apiKey) {
  const Anthropic = require('@anthropic-ai/sdk')
  const client = new Anthropic({ apiKey })

  const chunks = chunkText(parsedText)
  const results = []

  for (const chunk of chunks) {
    const cards = await callClaude(client, cardFormat, contextPrompt, chunk)
    results.push(...cards)
  }

  return results
}

/**
 * Generate flashcards directly from a file path.
 * PDFs are sent as native base64 document blocks — no text extraction needed.
 * .txt files are read and chunked as before.
 */
async function generateCardsFromFile (filePath, contextPrompt, cardFormat, apiKey) {
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
      `Return ONLY a JSON array, no explanation:\n` +
      `- ${formatInstruction}`

    const base64 = fs.readFileSync(filePath).toString('base64')

    let response
    try {
      response = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 4096,
        system,
        messages: [{
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
            { type: 'text', text: `Context: ${contextPrompt}\n\nGenerate flashcards from this document.` }
          ]
        }]
      })
    } catch (err) {
      if (err.status === 401 || (err.message && err.message.toLowerCase().includes('authentication'))) {
        throw new ApiKeyError()
      }
      throw new NetworkError(err)
    }

    const rawText = response.content?.[0]?.type === 'text' ? response.content[0].text : ''
    const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
    let cards
    try { cards = JSON.parse(cleaned) } catch { throw new ParseError(rawText) }
    if (!Array.isArray(cards)) throw new ParseError(rawText)

    return cards.map(card => cardFormat === 'basic'
      ? { front: String(card.front ?? ''), back: String(card.back ?? ''), type: 'basic' }
      : { text: String(card.text ?? ''), type: 'cloze' }
    )
  }

  // .txt — read and use text-based generation
  const text = fs.readFileSync(filePath, 'utf-8')
  return generateCards(text, contextPrompt, cardFormat, apiKey)
}

module.exports = { generateCards, generateCardsFromFile, chunkText, buildPrompt, ApiKeyError, ParseError, NetworkError }
