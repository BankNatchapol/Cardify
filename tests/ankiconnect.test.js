'use strict'
/**
 * Unit tests for src/lib/ankiconnect.js
 *
 * Covers AC5:
 *   - testConnection returns { connected: false } when fetch throws ECONNREFUSED
 *   - buildNotes correctly maps Basic {front,back} and Cloze {text} to
 *     AnkiConnect note format with correct modelName
 */

const { testConnection, buildNotes, createDeck, addNotes } = require('../src/lib/ankiconnect')

// ─── Mock fetch ───────────────────────────────────────────────────────────────

let mockFetch

beforeEach(() => {
  // Reset the mock before each test
  mockFetch = jest.fn()
  global.fetch = mockFetch
})

afterEach(() => {
  delete global.fetch
})

// ─── testConnection ───────────────────────────────────────────────────────────

describe('testConnection', () => {
  test('returns { connected: true } when AnkiConnect is reachable', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true })
    const result = await testConnection()
    expect(result).toEqual({ connected: true })
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:8765',
      expect.objectContaining({ method: 'GET' })
    )
  })

  test('returns { connected: false } when fetch throws (ECONNREFUSED)', async () => {
    const err = new Error('connect ECONNREFUSED 127.0.0.1:8765')
    err.code = 'ECONNREFUSED'
    mockFetch.mockRejectedValueOnce(err)

    const result = await testConnection()
    expect(result).toEqual({ connected: false })
  })

  test('returns { connected: false } on timeout (AbortError)', async () => {
    const err = new DOMException('The operation was aborted.', 'AbortError')
    mockFetch.mockRejectedValueOnce(err)

    const result = await testConnection()
    expect(result).toEqual({ connected: false })
  })

  test('returns { connected: false } on any network error', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    const result = await testConnection()
    expect(result).toEqual({ connected: false })
  })
})

// ─── buildNotes ───────────────────────────────────────────────────────────────

describe('buildNotes', () => {
  const deckName = 'My Test Deck'

  test('maps Basic cards to AnkiConnect note format with modelName "Basic"', () => {
    const cards = [
      { type: 'basic', front: 'What is photosynthesis?', back: 'The process plants use to make food from sunlight.' },
      { type: 'basic', front: 'Capital of France?', back: 'Paris' }
    ]

    const notes = buildNotes(deckName, cards)

    expect(notes).toHaveLength(2)
    expect(notes[0]).toEqual({
      deckName,
      modelName: 'Basic',
      fields: { Front: '<p>What is photosynthesis?</p>', Back: '<p>The process plants use to make food from sunlight.</p>' },
      options: { allowDuplicate: false },
      tags: []
    })
    expect(notes[1]).toEqual({
      deckName,
      modelName: 'Basic',
      fields: { Front: '<p>Capital of France?</p>', Back: '<p>Paris</p>' },
      options: { allowDuplicate: false },
      tags: []
    })
  })

  test('maps Cloze cards to AnkiConnect note format with modelName "Cloze"', () => {
    const cards = [
      { type: 'cloze', text: '{{c1::Mitochondria}} is the powerhouse of the cell.' },
      { type: 'cloze', text: 'The capital of France is {{c1::Paris}}.' }
    ]

    const notes = buildNotes(deckName, cards)

    expect(notes).toHaveLength(2)
    expect(notes[0]).toEqual({
      deckName,
      modelName: 'Cloze',
      fields: { Text: '<p>{{c1::Mitochondria}} is the powerhouse of the cell.</p>' },
      options: { allowDuplicate: false },
      tags: []
    })
    expect(notes[1]).toEqual({
      deckName,
      modelName: 'Cloze',
      fields: { Text: '<p>The capital of France is {{c1::Paris}}.</p>' },
      options: { allowDuplicate: false },
      tags: []
    })
  })

  test('handles mixed Basic and Cloze cards in one call', () => {
    const cards = [
      { type: 'basic', front: 'Q1', back: 'A1' },
      { type: 'cloze', text: '{{c1::answer}} is correct.' }
    ]

    const notes = buildNotes(deckName, cards)

    expect(notes[0].modelName).toBe('Basic')
    expect(notes[0].fields).toEqual({ Front: '<p>Q1</p>', Back: '<p>A1</p>' })
    expect(notes[1].modelName).toBe('Cloze')
    expect(notes[1].fields).toEqual({ Text: '<p>{{c1::answer}} is correct.</p>' })
  })

  test('defaults to Basic for cards with no type field', () => {
    const cards = [{ front: 'Q?', back: 'A!' }]
    const notes = buildNotes(deckName, cards)
    expect(notes[0].modelName).toBe('Basic')
  })

  test('handles empty front/back with empty string', () => {
    const cards = [{ type: 'basic', front: undefined, back: undefined }]
    const notes = buildNotes(deckName, cards)
    expect(notes[0].fields).toEqual({ Front: '', Back: '' })
  })

  test('handles empty text with empty string for Cloze', () => {
    const cards = [{ type: 'cloze', text: undefined }]
    const notes = buildNotes(deckName, cards)
    expect(notes[0].fields).toEqual({ Text: '' })
  })

  test('converts markdown to Anki-safe HTML fields', () => {
    const notes = buildNotes(deckName, [{
      type: 'basic',
      front: '**Photosynthesis**?',
      back: '- Uses <span class="cf-success">light</span>\n- Makes `glucose`'
    }])

    expect(notes[0].fields.Front).toContain('<strong>Photosynthesis</strong>')
    expect(notes[0].fields.Back).toContain('<ul>')
    expect(notes[0].fields.Back).toContain('style="color:#047857;font-weight:700;"')
    expect(notes[0].fields.Back).toContain('<code>glucose</code>')
  })

  test('returns empty array for empty card list', () => {
    const notes = buildNotes(deckName, [])
    expect(notes).toEqual([])
  })

  test('sets allowDuplicate: false on every note', () => {
    const cards = [
      { type: 'basic', front: 'Q', back: 'A' },
      { type: 'cloze', text: '{{c1::X}} is Y.' }
    ]
    const notes = buildNotes(deckName, cards)
    notes.forEach(n => {
      expect(n.options).toEqual({ allowDuplicate: false })
    })
  })

  test('sets tags: [] on every note', () => {
    const cards = [{ type: 'basic', front: 'Q', back: 'A' }]
    const notes = buildNotes(deckName, cards)
    expect(notes[0].tags).toEqual([])
  })
})

// ─── createDeck ───────────────────────────────────────────────────────────────

describe('createDeck', () => {
  test('posts createDeck action to AnkiConnect', async () => {
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ result: 12345, error: null })
    })

    await createDeck('MyDeck')

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:8765',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ action: 'createDeck', version: 6, params: { deck: 'MyDeck' } })
      })
    )
  })

  test('throws when AnkiConnect is unreachable', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('connect ECONNREFUSED'))
    await expect(createDeck('MyDeck')).rejects.toThrow('AnkiConnect unreachable')
  })
})

// ─── addNotes ─────────────────────────────────────────────────────────────────

describe('addNotes', () => {
  const deckName = 'Test Deck'
  const basicCards = [
    { type: 'basic', front: 'Q1', back: 'A1' },
    { type: 'basic', front: 'Q2', back: 'A2' }
  ]

  test('returns { added, errors } with correct counts on full success', async () => {
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ result: [1001, 1002], error: null })
    })

    const result = await addNotes(deckName, basicCards)
    expect(result.added).toBe(2)
    expect(result.errors).toHaveLength(0)
  })

  test('counts null results as duplicates (not hard errors)', async () => {
    // 1 added, 1 duplicate
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ result: [1001, null], error: null })
    })

    const result = await addNotes(deckName, basicCards)
    expect(result.added).toBe(1)
    // duplicate is in errors as "duplicate:1"
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toMatch(/duplicate/)
  })

  test('returns all added=0 when all cards are duplicates', async () => {
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ result: [null, null], error: null })
    })

    const result = await addNotes(deckName, basicCards)
    expect(result.added).toBe(0)
    expect(result.errors).toHaveLength(2)
  })

  test('throws when AnkiConnect is unreachable', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('connect ECONNREFUSED'))
    await expect(addNotes(deckName, basicCards)).rejects.toThrow('AnkiConnect unreachable')
  })
})
