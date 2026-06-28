'use strict'

const {
  extractGenerationFromClaudeCodeOutput,
  extractCardsFromClaudeCodeOutput,
  outputSchemaForFormat,
  buildClaudeCodePrompt,
  parseMarkdownCards,
  parseJsonFromText,
  getClaudeCodeTimeoutMs,
  isTemplateCard
} = require('../src/lib/claudeCode')

describe('claudeCode output schema', () => {
  it('requires basic front/back cards', () => {
    const schema = outputSchemaForFormat('basic')
    expect(schema.required).toEqual(['description', 'cards'])
    expect(schema.properties.description.required).toEqual(['title', 'purpose', 'contents'])
    expect(schema.properties.cards.items.required).toEqual(['front', 'back'])
  })

  it('requires cloze text cards', () => {
    const schema = outputSchemaForFormat('cloze')
    expect(schema.properties.cards.items.required).toEqual(['text'])
  })
})

describe('getClaudeCodeTimeoutMs', () => {
  const originalTimeout = process.env.CARDIFY_CLAUDE_CODE_TIMEOUT_MS

  afterEach(() => {
    if (originalTimeout === undefined) {
      delete process.env.CARDIFY_CLAUDE_CODE_TIMEOUT_MS
    } else {
      process.env.CARDIFY_CLAUDE_CODE_TIMEOUT_MS = originalTimeout
    }
  })

  it('defaults to ten minutes for long Claude Code generations', () => {
    delete process.env.CARDIFY_CLAUDE_CODE_TIMEOUT_MS
    expect(getClaudeCodeTimeoutMs()).toBe(600000)
  })

  it('allows a safe timeout override', () => {
    process.env.CARDIFY_CLAUDE_CODE_TIMEOUT_MS = '900000'
    expect(getClaudeCodeTimeoutMs()).toBe(900000)
  })
})

describe('buildClaudeCodePrompt', () => {
  it('includes context and source text without requesting tools', () => {
    const prompt = buildClaudeCodePrompt('basic', 'medical exam context', 'source text here')
    expect(prompt).toContain('medical exam context')
    expect(prompt).toContain('source text here')
    expect(prompt).toContain('Return only data matching the provided JSON schema')
    expect(prompt).toContain('Your final answer must begin with "{" and end with "}"')
    expect(prompt).toContain('Put deck/project overview information only in "description"')
    expect(prompt).toContain('Put only real reviewable flashcards in "cards"')
  })
})

describe('extractGenerationFromClaudeCodeOutput', () => {
  it('parses direct schema output with description and cards', () => {
    const output = JSON.stringify({
      description: {
        title: 'HSK 1',
        purpose: 'Practice beginner vocabulary',
        contents: ['Greetings', 'Numbers']
      },
      cards: [{ front: 'Q', back: 'A' }]
    })
    expect(extractGenerationFromClaudeCodeOutput(output, 'basic')).toEqual({
      description: {
        title: 'HSK 1',
        purpose: 'Practice beginner vocabulary',
        contents: ['Greetings', 'Numbers']
      },
      cards: [{ front: 'Q', back: 'A', type: 'basic' }]
    })
  })

  it('parses Claude Code json wrapper result output', () => {
    const output = JSON.stringify({
      result: JSON.stringify({
        description: {
          title: 'Geography',
          purpose: 'Review capitals',
          contents: ['France']
        },
        cards: [{ text: '{{c1::Paris}} is in France' }]
      })
    })
    expect(extractGenerationFromClaudeCodeOutput(output, 'cloze')).toEqual({
      description: {
        title: 'Geography',
        purpose: 'Review capitals',
        contents: ['France']
      },
      cards: [{ text: '{{c1::Paris}} is in France', type: 'cloze' }]
    })
  })

  it('parses Claude Code structured_output', () => {
    const output = JSON.stringify({
      type: 'result',
      structured_output: {
        description: {
          title: 'Structured',
          purpose: 'Test structured output',
          contents: ['Parsing']
        },
        cards: [{ front: 'Q', back: 'A' }]
      }
    })
    expect(extractGenerationFromClaudeCodeOutput(output, 'basic')).toEqual({
      description: {
        title: 'Structured',
        purpose: 'Test structured output',
        contents: ['Parsing']
      },
      cards: [{ front: 'Q', back: 'A', type: 'basic' }]
    })
  })

  it('normalizes legacy cards-only object output', () => {
    const output = JSON.stringify({ cards: [{ front: 'Q', back: 'A' }] })
    expect(extractGenerationFromClaudeCodeOutput(output, 'basic')).toEqual({
      description: {
        title: 'Generated Cardify Project',
        purpose: '',
        contents: []
      },
      cards: [{ front: 'Q', back: 'A', type: 'basic' }]
    })
  })

  it('normalizes legacy array output', () => {
    const output = JSON.stringify([{ front: 'Q', back: 'A' }])
    expect(extractGenerationFromClaudeCodeOutput(output, 'basic')).toEqual({
      description: {
        title: 'Generated Cardify Project',
        purpose: '',
        contents: []
      },
      cards: [{ front: 'Q', back: 'A', type: 'basic' }]
    })
  })

  it('recovers schema JSON when Claude Code wraps it in prose', () => {
    const output = JSON.stringify({
      result: [
        "I've generated a complete Anki deck.",
        '',
        '```json',
        JSON.stringify({
          description: {
            title: 'HSK 1',
            purpose: 'Practice HSK vocabulary',
            contents: ['Greetings']
          },
          cards: [{ front: '你好', back: 'hello' }]
        }),
        '```'
      ].join('\n')
    })

    expect(extractGenerationFromClaudeCodeOutput(output, 'basic')).toEqual({
      description: {
        title: 'HSK 1',
        purpose: 'Practice HSK vocabulary',
        contents: ['Greetings']
      },
      cards: [{ front: '你好', back: 'hello', type: 'basic' }]
    })
  })
})

describe('extractCardsFromClaudeCodeOutput', () => {
  it('keeps legacy card-array extraction available', () => {
    const output = JSON.stringify({
      description: {
        title: 'HSK 1',
        purpose: 'Practice beginner vocabulary',
        contents: ['Greetings']
      },
      cards: [{ front: 'Q', back: 'A' }]
    })
    expect(extractCardsFromClaudeCodeOutput(output, 'basic')).toEqual([
      { front: 'Q', back: 'A', type: 'basic' }
    ])
  })
})

describe('parseMarkdownCards', () => {
  it('recovers basic Front/Back markdown output from Claude Code', () => {
    const text = [
      'Here are your cards:',
      '1. **Front:** 你好',
      '**Back:** hello',
      '',
      '2. **Front:** 谢谢',
      '**Back:** thank you'
    ].join('\n')

    expect(parseMarkdownCards(text, 'basic')).toEqual([
      { front: '你好', back: 'hello', type: 'basic' },
      { front: '谢谢', back: 'thank you', type: 'basic' }
    ])
  })

  it('uses markdown recovery when Claude Code wraps prose in result', () => {
    const output = JSON.stringify({
      result: 'Here are your **150 Anki flashcards**\\n1. **Front:** 你好\\n**Back:** hello'
    })

    expect(extractCardsFromClaudeCodeOutput(output, 'basic')).toEqual([
      { front: '你好', back: 'hello', type: 'basic' }
    ])
  })

  it('rejects structure descriptions that look like cards', () => {
    const text = [
      'Each card is structured as:',
      '- **Front:** Chinese character + pinyin',
      '- **Back:** English meaning + a sample sentence (drawn from the source text) for context',
      'A few study tips for HSK 1:'
    ].join('\n')

    expect(parseMarkdownCards(text, 'basic')).toEqual([])
  })
})

describe('parseJsonFromText', () => {
  it('extracts balanced JSON object from surrounding text', () => {
    expect(parseJsonFromText('Summary first {"description":{"title":"T","purpose":"P","contents":["A"]},"cards":[]} trailing')).toEqual({
      description: {
        title: 'T',
        purpose: 'P',
        contents: ['A']
      },
      cards: []
    })
  })
})

describe('isTemplateCard', () => {
  it('detects generic format/template cards', () => {
    expect(isTemplateCard({
      type: 'basic',
      front: 'Chinese character + pinyin',
      back: 'English meaning + a sample sentence (drawn from the source text) for context'
    })).toBe(true)
  })

  it('allows real content cards', () => {
    expect(isTemplateCard({
      type: 'basic',
      front: '你好 (nǐ hǎo)',
      back: 'hello; used as a greeting'
    })).toBe(false)
  })
})
