'use strict'

const {
  buildGeminiChunkPayload,
  buildGeminiThinkingConfig,
  buildThaiRefinementPrompt,
  chunkCards,
  generateContentWithRetry,
  isRetryableGeminiError,
  isRetryableGeminiParseError,
  isRetryableGeminiValidationError,
  parseGeminiJsonResponse,
  refinementResponseSchemaForChunk,
  retryDelayMs,
  selectStyleReferenceCards,
  validateRefinedChunk,
  applyRefinedCardsToInput,
  inferDeckContext,
  noteToCard,
  refineThaiCardsWithGemini
} = require('../src/lib/geminiThaiRefinement')

describe('geminiThaiRefinement', () => {
  test('chunks cards with original indexes and normalized fields', () => {
    const chunks = chunkCards([
      { type: 'basic', front: '爱', back: 'รัก' },
      { type: 'cloze', text: '{{c1::爱}} คือ รัก' },
      { front: 'Q', back: 'A' }
    ], 2)

    expect(chunks).toEqual([
      [
        { index: 0, type: 'basic', front: '爱', back: 'รัก' },
        { index: 1, type: 'cloze', text: '{{c1::爱}} คือ รัก' }
      ],
      [
        { index: 2, type: 'basic', front: 'Q', back: 'A' }
      ]
    ])
  })

  test('builds prompt with deck context and Thai-only constraints', () => {
    const prompt = buildThaiRefinementPrompt({
      description: {
        title: 'HSK 1',
        purpose: 'Thai learner',
        contents: ['Chinese vocabulary', 'example sentences']
      },
      cardFormat: 'basic'
    })

    expect(prompt).toContain('Title: HSK 1')
    expect(prompt).toContain('Purpose: Thai learner')
    expect(prompt).toContain('Chinese vocabulary')
    expect(prompt).toContain('Improve only Thai wording')
    expect(prompt).toContain('Preserve all Chinese, pinyin')
    expect(prompt).toContain('Preserve cloze syntax exactly')
    expect(prompt).toContain('styleReferenceCards')
    expect(prompt).toContain('read-only style examples')
    expect(prompt).toContain('avoid abbreviations')
    expect(prompt).toContain('Keep Thai terminology consistent')
    expect(prompt).toContain('Return JSON only')
  })

  test('selects style reference cards from accepted samples before deck cards', () => {
    const input = {
      generationProgress: {
        acceptedSampleCards: [
          { type: 'basic', front: '爱', back: 'ตัวอย่างที่ยอมรับ' },
          { type: 'basic', front: '喝', back: 'ดื่ม' },
          { type: 'basic', front: '看', back: 'ดู' }
        ]
      },
      cards: [
        { type: 'basic', front: '不', back: 'ไม่' }
      ]
    }

    expect(selectStyleReferenceCards(input, null, 2)).toEqual([
      { type: 'basic', front: '爱', back: 'ตัวอย่างที่ยอมรับ' },
      { type: 'basic', front: '喝', back: 'ดื่ม' }
    ])
  })

  test('falls back to first deck cards as style references', () => {
    expect(selectStyleReferenceCards({
      cards: [
        { type: 'basic', front: '爱', back: 'รัก' },
        { type: 'cloze', text: '{{c1::喝}} คือ ดื่ม' }
      ]
    }, null, 3)).toEqual([
      { type: 'basic', front: '爱', back: 'รัก' },
      { type: 'cloze', text: '{{c1::喝}} คือ ดื่ม' }
    ])
  })

  test('builds a Gemini chunk payload with read-only examples separate from editable cards', () => {
    expect(buildGeminiChunkPayload({
      styleReferenceCards: [{ type: 'basic', front: '爱', back: 'รัก' }],
      recentRefinedCards: [{ type: 'basic', front: '喝', back: 'ดื่ม' }],
      chunk: [{ index: 2, type: 'basic', front: '看', back: 'ดู' }]
    })).toEqual({
      styleReferenceCards: [{ type: 'basic', front: '爱', back: 'รัก' }],
      recentRefinedCards: [{ type: 'basic', front: '喝', back: 'ดื่ม' }],
      cards: [{ index: 2, type: 'basic', front: '看', back: 'ดู' }]
    })
  })

  test('uses exact structured output schemas for refinement chunks', () => {
    const schema = refinementResponseSchemaForChunk([
      { index: 0, type: 'basic', front: '爱', back: 'รัก' },
      { index: 1, type: 'basic', front: '喝', back: 'ดื่ม' }
    ])

    expect(schema.properties.cards.items.required).toEqual(['index', 'type', 'front', 'back', 'changed'])
    expect(schema.properties.cards.items.properties.index.type).toBe('integer')
    expect(schema.properties.cards.items.properties.type.enum).toEqual(['basic'])
    expect(schema.properties.cards.minItems).toBe(2)
    expect(schema.properties.cards.maxItems).toBe(2)
    expect(schema.additionalProperties).toBe(false)

    expect(refinementResponseSchemaForChunk([
      { index: 0, type: 'cloze', text: '{{c1::爱}}' }
    ]).properties.cards.items.required).toEqual(['index', 'type', 'text', 'changed'])

    expect(refinementResponseSchemaForChunk([
      { index: 0, type: 'basic', front: '爱', back: 'รัก' },
      { index: 1, type: 'cloze', text: '{{c1::喝}}' }
    ]).properties.cards.items.anyOf).toHaveLength(2)
  })

  test('builds thinking config by Gemini model family', () => {
    expect(buildGeminiThinkingConfig('gemini-3.1-flash-lite', {
      thinkingLevel: 'minimal',
      thinkingBudget: 0
    })).toEqual({ thinkingLevel: 'MINIMAL' })
    expect(buildGeminiThinkingConfig('gemini-3.5-flash', {
      thinkingLevel: 'low'
    })).toEqual({ thinkingLevel: 'LOW' })
    expect(buildGeminiThinkingConfig('gemini-2.5-flash', {
      thinkingBudget: 0
    })).toEqual({ thinkingBudget: 0 })
    expect(buildGeminiThinkingConfig('gemini-3.1-flash-lite', {
      thinkingBudget: 0
    })).toBeNull()
    expect(() => buildGeminiThinkingConfig('gemini-3.1-flash-lite', {
      thinkingLevel: 'fast'
    })).toThrow(/thinking level/)
  })

  test('detects retryable Gemini errors and retry-after delays', () => {
    expect(isRetryableGeminiError({ status: 429, message: 'rate limit' })).toBe(true)
    expect(isRetryableGeminiError({ response: { status: 503 }, message: 'server overload' })).toBe(true)
    expect(isRetryableGeminiError(new Error('RESOURCE_EXHAUSTED: quota exceeded'))).toBe(true)
    expect(isRetryableGeminiError({ status: 400, message: 'bad request' })).toBe(false)
    expect(retryDelayMs({
      status: 429,
      response: { headers: { 'retry-after': '2' } }
    }, 0, { retryBaseMs: 100, retryMaxMs: 5000 })).toBe(2000)
    expect(retryDelayMs({ status: 503 }, 2, { retryBaseMs: 100, retryMaxMs: 500 })).toBe(400)
    expect(isRetryableGeminiValidationError(new Error('Refined basic card 0 is missing back'))).toBe(true)
    expect(isRetryableGeminiValidationError(new Error('changed type'))).toBe(false)
  })

  test('marks truncated Gemini JSON responses as retryable parse errors', () => {
    const truncatedJson = '{"cards":[{"back":"unterminated'
    expect(() => parseGeminiJsonResponse({ text: truncatedJson })).toThrow(/invalid JSON/)
    try {
      parseGeminiJsonResponse({ text: truncatedJson })
    } catch (err) {
      expect(err.code).toBe('gemini-invalid-json')
      expect(isRetryableGeminiParseError(err)).toBe(true)
    }
  })

  test('retries transient Gemini generation failures and then succeeds', async () => {
    const generateContent = jest.fn()
      .mockRejectedValueOnce({ status: 503, message: 'server overload' })
      .mockRejectedValueOnce({ status: 429, response: { headers: { 'retry-after': '1' } } })
      .mockResolvedValueOnce({ text: '{"cards":[]}' })
    const sleep = jest.fn().mockResolvedValue(undefined)
    const onRetry = jest.fn()

    const response = await generateContentWithRetry({
      models: { generateContent }
    }, {
      model: 'gemini-3.1-flash-lite',
      contents: '{}',
      config: {}
    }, {
      retryAttempts: 2,
      retryBaseMs: 100,
      retryMaxMs: 1000,
      sleep,
      onRetry,
      chunkNumber: 1,
      chunkCount: 3
    })

    expect(response).toEqual({ text: '{"cards":[]}' })
    expect(generateContent).toHaveBeenCalledTimes(3)
    expect(sleep).toHaveBeenNthCalledWith(1, 100)
    expect(sleep).toHaveBeenNthCalledWith(2, 1000)
    expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({
      attempt: 1,
      status: 503,
      chunkNumber: 1,
      chunkCount: 3
    }))
  })

  test('retries a malformed JSON chunk response once and then applies the valid response', async () => {
    const generateContent = jest.fn()
      .mockResolvedValueOnce({
        text: '{"cards":[{"index":0,"type":"basic","front":"爱","back":"unterminated'
      })
      .mockResolvedValueOnce({
        text: JSON.stringify({
          cards: [
            { index: 0, type: 'basic', front: '爱', back: 'ความรัก', changed: true }
          ]
        })
      })
    const sleep = jest.fn().mockResolvedValue(undefined)
    const onRetry = jest.fn()

    const result = await refineThaiCardsWithGemini({
      input: {
        cards: [{ type: 'basic', front: '爱', back: 'รัก' }]
      },
      apiKey: 'test-key',
      chunkSize: 1,
      retryAttempts: 1,
      retryBaseMs: 10,
      sleep,
      onRetry,
      genAI: { models: { generateContent } }
    })

    expect(generateContent).toHaveBeenCalledTimes(2)
    expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({
      status: 'invalid-json',
      chunkNumber: 1
    }))
    expect(result.cards[0].back).toBe('ความรัก')
  })

  test('retries a missing back response once and then applies the valid response', async () => {
    const generateContent = jest.fn()
      .mockResolvedValueOnce({
        text: JSON.stringify({
          cards: [
            { index: 0, type: 'basic', front: '爱', changed: true }
          ]
        })
      })
      .mockResolvedValueOnce({
        text: JSON.stringify({
          cards: [
            { index: 0, type: 'basic', front: '爱', back: 'ความรัก', changed: true }
          ]
        })
      })
    const sleep = jest.fn().mockResolvedValue(undefined)
    const onRetry = jest.fn()

    const result = await refineThaiCardsWithGemini({
      input: {
        cards: [{ type: 'basic', front: '爱', back: 'รัก' }]
      },
      apiKey: 'test-key',
      chunkSize: 1,
      retryAttempts: 1,
      retryBaseMs: 10,
      sleep,
      onRetry,
      genAI: { models: { generateContent } }
    })

    expect(generateContent).toHaveBeenCalledTimes(2)
    expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({
      status: 'invalid-schema',
      message: 'Refined basic card 0 is missing back'
    }))
    expect(result.cards[0].back).toBe('ความรัก')
  })

  test('validates a good refined basic chunk', () => {
    const original = [{ index: 0, type: 'basic', front: '爱', back: '**ài**\nรัก' }]
    const refined = validateRefinedChunk(original, {
      cards: [{ index: 0, type: 'basic', front: '爱', back: '**ài**\nความรัก', changed: true }]
    })

    expect(refined).toEqual([
      { index: 0, type: 'basic', front: '爱', back: '**ài**\nความรัก', changed: true }
    ])
  })

  test('rejects changed card count, changed type, and missing fields', () => {
    const original = [{ index: 0, type: 'basic', front: '爱', back: 'รัก' }]

    expect(() => validateRefinedChunk(original, { cards: [] })).toThrow(/card count changed/)
    expect(() => validateRefinedChunk(original, {
      cards: [{ index: 99, type: 'basic', front: '爱', back: 'รัก', changed: false }]
    })).toThrow(/outside the current chunk/)
    expect(() => validateRefinedChunk(original, {
      cards: [{ index: 0, type: 'cloze', text: '{{c1::爱}}', changed: false }]
    })).toThrow(/changed type/)
    expect(() => validateRefinedChunk(original, {
      cards: [{ index: 0, type: 'basic', front: '爱', changed: false }]
    })).toThrow(/missing back/)
  })

  test('rejects non-Thai front changes and malformed cloze syntax', () => {
    expect(() => validateRefinedChunk(
      [{ index: 0, type: 'basic', front: '爱', back: 'รัก' }],
      { cards: [{ index: 0, type: 'basic', front: 'รัก', back: 'รัก', changed: true }] }
    )).toThrow(/changed a non-Thai front/)

    expect(() => validateRefinedChunk(
      [{ index: 1, type: 'cloze', text: '{{c1::爱}} คือ รัก' }],
      { cards: [{ index: 1, type: 'cloze', text: '爱 คือ รัก', changed: true }] }
    )).toThrow(/cloze marker count/)
  })

  test('rejects broken allowed highlight tags', () => {
    expect(() => validateRefinedChunk(
      [{ index: 0, type: 'basic', front: '爱', back: '<span class="cf-key">รัก</span>' }],
      { cards: [{ index: 0, type: 'basic', front: '爱', back: '<span class="cf-warning">รัก</span>', changed: true }] }
    )).toThrow(/highlight tags/)
  })

  test('preserves input top-level shape for project, raw array, and projects file', () => {
    expect(applyRefinedCardsToInput(
      { description: { title: 'Deck' }, cards: [{ type: 'basic', front: '爱', back: 'รัก' }] },
      [{ index: 0, type: 'basic', front: '爱', back: 'ความรัก' }]
    )).toEqual({
      description: { title: 'Deck' },
      cards: [{ type: 'basic', front: '爱', back: 'ความรัก' }]
    })

    expect(applyRefinedCardsToInput(
      [{ type: 'basic', front: '爱', back: 'รัก' }],
      [{ index: 0, type: 'basic', front: '爱', back: 'ความรัก' }]
    )).toEqual([{ type: 'basic', front: '爱', back: 'ความรัก' }])

    expect(applyRefinedCardsToInput(
      { projects: [{ id: 'p1', cards: [{ type: 'basic', front: '爱', back: 'รัก' }] }] },
      [{ index: 0, type: 'basic', front: '爱', back: 'ความรัก' }],
      { projectId: 'p1' }
    )).toEqual({
      projects: [{ id: 'p1', cards: [{ type: 'basic', front: '爱', back: 'ความรัก' }] }]
    })
  })

  test('preserves mobile package notes shape', () => {
    const input = {
      packageId: 'pkg1',
      deck: {
        name: 'HSK 1',
        description: { title: 'HSK 1', purpose: 'Thai learner', contents: ['vocab'] }
      },
      notes: [
        {
          id: 'n1',
          noteType: 'basic',
          fields: { Front: '爱', Back: 'รัก' },
          tags: ['hsk1']
        }
      ]
    }

    expect(noteToCard(input.notes[0])).toEqual({ type: 'basic', front: '爱', back: 'รัก' })
    expect(inferDeckContext(input)).toEqual({
      description: { title: 'HSK 1', purpose: 'Thai learner', contents: ['vocab'] },
      cardFormat: 'basic'
    })
    expect(applyRefinedCardsToInput(input, [
      { index: 0, type: 'basic', front: '爱', back: 'ความรัก' }
    ])).toEqual({
      packageId: 'pkg1',
      deck: input.deck,
      notes: [
        {
          id: 'n1',
          noteType: 'basic',
          fields: { Front: '爱', Back: 'ความรัก' },
          tags: ['hsk1']
        }
      ]
    })
  })

  test('calls mocked Gemini once per chunk and returns refined JSON', async () => {
    const generateContent = jest.fn()
      .mockResolvedValueOnce({
        text: JSON.stringify({
          cards: [
            { index: 0, type: 'basic', front: '爱', back: 'ความรัก', changed: true }
          ]
        })
      })
      .mockResolvedValueOnce({
        text: JSON.stringify({
          cards: [
            { index: 1, type: 'basic', front: '喝', back: 'ดื่ม', changed: false }
          ]
        })
      })
    const onProgress = jest.fn()

    const result = await refineThaiCardsWithGemini({
      input: {
        description: { title: 'HSK 1' },
        cards: [
          { type: 'basic', front: '爱', back: 'รัก' },
          { type: 'basic', front: '喝', back: 'ดื่ม' }
        ]
      },
      apiKey: 'test-key',
      chunkSize: 1,
      thinkingLevel: 'minimal',
      retryAttempts: 1,
      sleep: jest.fn().mockResolvedValue(undefined),
      onProgress,
      genAI: { models: { generateContent } }
    })

    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({
      stage: 'start',
      totalCards: 2,
      totalChunks: 2
    }))
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({
      stage: 'chunk-start',
      chunkNumber: 1,
      refinedCards: 0
    }))
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({
      stage: 'chunk-complete',
      chunkNumber: 2,
      refinedCards: 2
    }))
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({
      stage: 'complete',
      refinedCards: 2
    }))
    expect(generateContent).toHaveBeenCalledTimes(2)
    expect(generateContent.mock.calls[0][0].model).toBe('gemini-3.1-flash-lite')
    expect(generateContent.mock.calls[0][0].config.responseMimeType).toBe('application/json')
    expect(generateContent.mock.calls[0][0].config.responseSchema).toBeUndefined()
    expect(generateContent.mock.calls[0][0].config.responseJsonSchema.properties.cards.minItems).toBe(1)
    expect(generateContent.mock.calls[0][0].config.thinkingConfig).toEqual({ thinkingLevel: 'MINIMAL' })
    const firstRequest = JSON.parse(generateContent.mock.calls[0][0].contents)
    const secondRequest = JSON.parse(generateContent.mock.calls[1][0].contents)
    expect(firstRequest.styleReferenceCards).toEqual([
      { type: 'basic', front: '爱', back: 'รัก' },
      { type: 'basic', front: '喝', back: 'ดื่ม' }
    ])
    expect(firstRequest.recentRefinedCards).toEqual([])
    expect(secondRequest.recentRefinedCards).toEqual([
      { type: 'basic', front: '爱', back: 'ความรัก' }
    ])
    expect(secondRequest.cards).toEqual([
      { index: 1, type: 'basic', front: '喝', back: 'ดื่ม' }
    ])
    expect(result.cards).toEqual([
      { type: 'basic', front: '爱', back: 'ความรัก' },
      { type: 'basic', front: '喝', back: 'ดื่ม' }
    ])
  })
})
