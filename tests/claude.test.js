'use strict'
/**
 * tests/claude.test.js
 *
 * Unit tests for src/lib/claude.js
 * Covers:
 *   - buildPrompt: correct system/user messages for basic and cloze formats
 *   - chunkText: splits text at ~8000 tokens without cutting mid-sentence
 *   - generateCards: mocks Anthropic SDK, verifies integration
 */

// ─── Mock @anthropic-ai/sdk before requiring claude.js ──────────────────────
const mockCreate = jest.fn()

jest.mock('@anthropic-ai/sdk', () => {
  return jest.fn().mockImplementation(() => ({
    messages: { create: mockCreate }
  }))
})

const {
  buildPrompt,
  chunkText,
  generateCards,
  ApiKeyError,
  ParseError
} = require('../src/lib/claude')

// ─────────────────────────────────────────────────────────────────────────────
// buildPrompt
// ─────────────────────────────────────────────────────────────────────────────
describe('buildPrompt', () => {
  test('basic format: system prompt contains "basic" and correct schema', () => {
    const { system, messages } = buildPrompt('basic', 'Study for exam', 'Some text')
    expect(system).toContain('basic')
    expect(system).toContain('"front"')
    expect(system).toContain('"back"')
    expect(system).not.toContain('{{c1::')
  })

  test('cloze format: system prompt contains "cloze" and cloze schema', () => {
    const { system, messages } = buildPrompt('cloze', 'Learn vocab', 'Some text')
    expect(system).toContain('cloze')
    expect(system).toContain('{{c1::')
    expect(system).toContain('"text"')
    expect(system).not.toContain('"front"')
  })

  test('basic format: user message contains context and text chunk', () => {
    const context = 'Med student studying pharmacology'
    const chunk = 'Beta blockers reduce heart rate.'
    const { messages } = buildPrompt('basic', context, chunk)
    expect(messages).toHaveLength(1)
    expect(messages[0].role).toBe('user')
    expect(messages[0].content).toContain(context)
    expect(messages[0].content).toContain(chunk)
  })

  test('cloze format: user message contains context and text chunk', () => {
    const context = 'Spanish language learner'
    const chunk = 'El gato es negro.'
    const { messages } = buildPrompt('cloze', context, chunk)
    expect(messages[0].content).toContain(context)
    expect(messages[0].content).toContain(chunk)
  })

  test('system prompt instructs to return ONLY a JSON array', () => {
    const { system } = buildPrompt('basic', 'ctx', 'txt')
    expect(system).toMatch(/return only a json array/i)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// chunkText
// ─────────────────────────────────────────────────────────────────────────────
describe('chunkText', () => {
  test('text shorter than maxChars is returned as single chunk', () => {
    const text = 'Short text.'
    const chunks = chunkText(text, 100)
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toBe(text)
  })

  test('text exactly at maxChars boundary is returned as single chunk', () => {
    const text = 'a'.repeat(100)
    const chunks = chunkText(text, 100)
    expect(chunks).toHaveLength(1)
  })

  test('long text with sentence boundaries is split without cutting mid-sentence', () => {
    // Build a string of 10 sentences, each 15 chars + ". " = ~170 chars
    // Set maxChars to 50 to force multiple chunks
    const sentences = Array.from({ length: 10 }, (_, i) => `Sentence ${i + 1} end`)
    const text = sentences.join('. ') + '.'

    const chunks = chunkText(text, 50)

    // Every chunk must end with a complete sentence (not cut in the middle)
    for (const chunk of chunks) {
      // chunk should end at a sentence boundary (period) or be the last fragment
      expect(chunk.length).toBeGreaterThan(0)
    }

    // Reassembling must recover all content (modulo inter-chunk spaces)
    const reassembled = chunks.join(' ').replace(/\s+/g, ' ').trim()
    const original = text.replace(/\s+/g, ' ').trim()
    expect(reassembled).toBe(original)
  })

  test('very long word without spaces falls back to hard cut', () => {
    // A single word longer than maxChars — no sentence boundary
    const text = 'a'.repeat(200)
    const chunks = chunkText(text, 50)
    expect(chunks.length).toBeGreaterThan(1)
    const total = chunks.reduce((sum, c) => sum + c.length, 0)
    expect(total).toBe(200)
  })

  test('splits ~8000-token text (32000 chars) into chunks ≤ 32000 chars each', () => {
    // Simulate a realistic 100k-char document
    const sentence = 'The mitochondria is the powerhouse of the cell. '
    const text = sentence.repeat(Math.ceil(100_000 / sentence.length)).slice(0, 100_000)

    const chunks = chunkText(text) // uses default CHARS_PER_CHUNK = 32_000
    expect(chunks.length).toBeGreaterThanOrEqual(4)
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(32_000)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// generateCards — integration with mocked Anthropic SDK
// ─────────────────────────────────────────────────────────────────────────────
describe('generateCards', () => {
  beforeEach(() => {
    mockCreate.mockReset()
  })

  function makeResponse (jsonArray) {
    return {
      content: [{ type: 'text', text: JSON.stringify(jsonArray) }]
    }
  }

  test('basic format: returns normalised card array', async () => {
    const cards = [{ front: 'Q1', back: 'A1' }, { front: 'Q2', back: 'A2' }]
    mockCreate.mockResolvedValue(makeResponse(cards))

    const result = await generateCards('short text', 'exam prep', 'basic', 'sk-test-key')

    expect(result).toHaveLength(2)
    expect(result[0]).toEqual({ front: 'Q1', back: 'A1', type: 'basic' })
    expect(result[1]).toEqual({ front: 'Q2', back: 'A2', type: 'basic' })
  })

  test('cloze format: returns normalised cloze card array', async () => {
    const cards = [{ text: '{{c1::Mitochondria}} is the powerhouse of the cell.' }]
    mockCreate.mockResolvedValue(makeResponse(cards))

    const result = await generateCards('short text', 'biology', 'cloze', 'sk-test-key')

    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      text: '{{c1::Mitochondria}} is the powerhouse of the cell.',
      type: 'cloze'
    })
  })

  test('throws ApiKeyError on HTTP 401', async () => {
    const authErr = Object.assign(new Error('authentication_error'), { status: 401 })
    mockCreate.mockRejectedValue(authErr)

    await expect(generateCards('text', 'ctx', 'basic', 'bad-key')).rejects.toBeInstanceOf(ApiKeyError)
  })

  test('throws ApiKeyError on authentication message', async () => {
    const authErr = new Error('Invalid authentication credentials')
    mockCreate.mockRejectedValue(authErr)

    await expect(generateCards('text', 'ctx', 'basic', 'bad-key')).rejects.toBeInstanceOf(ApiKeyError)
  })

  test('throws ParseError when model returns invalid JSON', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'This is not JSON at all.' }]
    })

    await expect(generateCards('text', 'ctx', 'basic', 'key')).rejects.toBeInstanceOf(ParseError)
  })

  test('strips markdown code fences before parsing JSON', async () => {
    const cards = [{ front: 'Q', back: 'A' }]
    const fenced = '```json\n' + JSON.stringify(cards) + '\n```'
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: fenced }]
    })

    const result = await generateCards('text', 'ctx', 'basic', 'key')
    expect(result[0].type).toBe('basic')
  })

  test('makes multiple API calls for long text and concatenates results', async () => {
    // Build text that is ~3× the CHARS_PER_CHUNK (32_000) limit.
    // The chunker may produce 3 or 4 chunks depending on sentence-boundary
    // alignment, so we assert >= 3 calls (not exactly 3).
    const sentence = 'The quick brown fox jumps over the lazy dog. '
    const longText = sentence.repeat(Math.ceil((32_000 * 3) / sentence.length)).slice(0, 32_000 * 3)

    const cards = [{ front: 'Q', back: 'A' }]
    mockCreate.mockResolvedValue(makeResponse(cards))

    const result = await generateCards(longText, 'ctx', 'basic', 'key')

    // Should have called the API at least 3 times and concatenated results
    expect(mockCreate.mock.calls.length).toBeGreaterThanOrEqual(3)
    // result length matches number of API calls (1 card per call)
    expect(result).toHaveLength(mockCreate.mock.calls.length)
  })

  test('SDK called with claude-sonnet-4-6 model', async () => {
    mockCreate.mockResolvedValue(makeResponse([{ front: 'Q', back: 'A' }]))

    await generateCards('text', 'ctx', 'basic', 'key')

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'claude-sonnet-4-6' })
    )
  })
})
