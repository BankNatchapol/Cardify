'use strict'
/**
 * ankiconnect.js — runs in the Electron main process only.
 *
 * Provides a thin wrapper around the AnkiConnect HTTP API (port 8765).
 *
 * Exports:
 *   testConnection()                        -> { connected: bool }
 *   createDeck(deckName)                    -> void
 *   addNotes(deckName, cards)               -> { added: number, errors: string[] }
 *   buildNotes(deckName, cards)             -> AnkiConnect notes array (pure, unit-testable)
 *
 * AnkiConnect note format:
 *   Basic: { deckName, modelName: 'Basic',  fields: { Front, Back }, options: { allowDuplicate: false }, tags: [] }
 *   Cloze: { deckName, modelName: 'Cloze',  fields: { Text },        options: { allowDuplicate: false }, tags: [] }
 */

const ANKI_URL = 'http://localhost:8765'
const ANKI_VERSION = 6
const CONNECTION_TIMEOUT_MS = 2000
const { renderCardMarkdown } = require('./cardMarkdown.cjs')

// ─── Low-level HTTP helper ────────────────────────────────────────────────────
/**
 * POST a JSON-RPC-style request to AnkiConnect.
 *
 * @param {string} action     AnkiConnect action name
 * @param {object} [params]   Action parameters
 * @returns {Promise<any>}    Resolved result field from the response
 * @throws {Error}            On network failure or AnkiConnect error field set
 */
async function ankiRequest (action, params = {}) {
  const body = JSON.stringify({ action, version: ANKI_VERSION, params })

  let response
  try {
    response = await fetch(ANKI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(CONNECTION_TIMEOUT_MS)
    })
  } catch (err) {
    // Network-level failure (ECONNREFUSED, timeout, etc.)
    const error = new Error(`AnkiConnect unreachable: ${err.message}`)
    error.code = 'anki-not-running'
    throw error
  }

  const data = await response.json()

  if (data.error !== null && data.error !== undefined) {
    throw new Error(`AnkiConnect error: ${data.error}`)
  }

  return data.result
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Test whether AnkiConnect is reachable.
 * Uses a GET request with a 2 s timeout.
 *
 * @returns {Promise<{ connected: boolean }>}
 */
async function testConnection () {
  try {
    await fetch(ANKI_URL, {
      method: 'GET',
      signal: AbortSignal.timeout(CONNECTION_TIMEOUT_MS)
    })
    return { connected: true }
  } catch {
    return { connected: false }
  }
}

/**
 * Create an Anki deck if it doesn't already exist.
 * AnkiConnect's createDeck is idempotent — safe to call even if the deck exists.
 *
 * @param {string} deckName
 * @returns {Promise<void>}
 */
async function createDeck (deckName) {
  await ankiRequest('createDeck', { deck: deckName })
}

/**
 * Pure function: map a card array + deck name into an AnkiConnect notes array.
 * Card shapes:
 *   Basic: { front: string, back: string, type: 'basic' }
 *   Cloze: { text: string, type: 'cloze' }
 *
 * @param {string} deckName
 * @param {Array<{front?:string, back?:string, text?:string, type:string}>} cards
 * @returns {Array<object>} AnkiConnect-formatted notes
 */
function buildNotes (deckName, cards) {
  return cards.map(card => {
    if (card.type === 'cloze') {
      return {
        deckName,
        modelName: 'Cloze',
        fields: { Text: renderCardMarkdown(card.text ?? '', { target: 'anki' }) },
        options: { allowDuplicate: false },
        tags: []
      }
    }
    // Default: Basic
    return {
      deckName,
      modelName: 'Basic',
      fields: {
        Front: renderCardMarkdown(card.front ?? '', { target: 'anki' }),
        Back: renderCardMarkdown(card.back ?? '', { target: 'anki' })
      },
      options: { allowDuplicate: false },
      tags: []
    }
  })
}

/**
 * Add notes to Anki. Handles duplicate-note errors gracefully:
 * AnkiConnect returns null in the result array for each duplicate;
 * we count those as "skipped" rather than failures.
 *
 * @param {string} deckName
 * @param {Array} cards
 * @returns {Promise<{ added: number, errors: string[] }>}
 */
async function addNotes (deckName, cards) {
  const notes = buildNotes(deckName, cards)
  const result = await ankiRequest('addNotes', { notes })

  // result is an array of note IDs (numbers) or null for duplicates / errors
  if (!Array.isArray(result)) {
    return { added: 0, errors: ['Unexpected response from AnkiConnect'] }
  }

  let added = 0
  const errors = []

  result.forEach((id, idx) => {
    if (id === null) {
      // null = duplicate or rejected — treat as skipped, not an error
      errors.push(`duplicate:${idx}`)
    } else {
      added++
    }
  })

  return { added, errors }
}

module.exports = { testConnection, createDeck, addNotes, buildNotes }
