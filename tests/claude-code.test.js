'use strict'

const {
  extractGenerationFromClaudeCodeOutput,
  extractCardsFromClaudeCodeOutput,
  outputSchemaForFormat,
  outputDescriptionSchema,
  outputClarificationSchema,
  buildClaudeCodePrompt,
  buildClaudeCodeRecoveryPrompt,
  buildClaudeCodeDescriptionCombinePrompt,
  buildClaudeCodeDeckOverviewPrompt,
  buildClaudeCodeClarificationPrompt,
  buildClaudeCodeSamplePrompt,
  buildClaudeCodeIterativeBatchPrompt,
  buildGenerationCommandArgs,
  normalizeClaudeCodeModel,
  extractDescriptionFromClaudeCodeOutput,
  extractClarificationFromClaudeCodeOutput,
  extractIterativeBatchFromClaudeCodeOutput,
  outputIterativeBatchSchema,
  parseMarkdownCards,
  parseJsonFromText,
  getClaudeCodeTimeoutMs,
  isTemplateCard,
  isChunkDescription,
  fallbackCombinedDescription,
  createClaudeCodeEnv,
  claudeCodeResultErrorMessage
} = require('../src/lib/claudeCode')
const { chunkText, chunkTextWithMetadata } = require('../src/lib/claude')

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

  it('has a description-only combine schema', () => {
    const schema = outputDescriptionSchema()
    expect(schema.required).toEqual(['description'])
    expect(schema.properties.cards).toBeUndefined()
  })

  it('has a clarification schema', () => {
    const schema = outputClarificationSchema()
    expect(schema.required).toEqual(['status'])
    expect(schema.properties.questions.items.type).toBe('string')
    expect(schema.properties.clarifiedContext.type).toBe('string')
  })

  it('has an iterative batch schema with coverage metadata', () => {
    const schema = outputIterativeBatchSchema('basic')
    expect(schema.required).toEqual(['cards', 'coverage'])
    expect(schema.properties.description).toBeUndefined()
    expect(schema.properties.coverage.required).toEqual(['batchSummary', 'coveredTopics', 'remainingFocus', 'done'])
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

  it('defaults to twenty minutes for long Claude Code generations', () => {
    delete process.env.CARDIFY_CLAUDE_CODE_TIMEOUT_MS
    expect(getClaudeCodeTimeoutMs()).toBe(1200000)
  })

  it('allows a safe timeout override', () => {
    process.env.CARDIFY_CLAUDE_CODE_TIMEOUT_MS = '900000'
    expect(getClaudeCodeTimeoutMs()).toBe(900000)
  })
})

describe('chunk sizing', () => {
  it('does not split normal deck-sized regeneration text under 160k chars', () => {
    const text = 'x'.repeat(120000)
    expect(chunkText(text)).toHaveLength(1)
    expect(chunkTextWithMetadata(text)).toEqual([
      { text, index: 1, total: 1 }
    ])
  })

  it('still chunks very large sources', () => {
    const text = 'x'.repeat(170000)
    expect(chunkText(text).length).toBeGreaterThan(1)
    const chunks = chunkTextWithMetadata(text)
    expect(chunks[0].index).toBe(1)
    expect(chunks[0].total).toBe(chunks.length)
    expect(chunks[chunks.length - 1].index).toBe(chunks.length)
  })
})

describe('generateCardsClaudeCode source fallback', () => {
  it('accepts sourceText so saved projects can regenerate without reading the original file', () => {
    const fs = require('fs')
    const path = require('path')
    const source = fs.readFileSync(path.join(__dirname, '../src/lib/claudeCode.js'), 'utf8')

    expect(source).toContain('async function generateCardsClaudeCode (filePath, contextPrompt, cardFormat, sourceText = null, options = {})')
    expect(source).toContain('async function readSourceText')
    expect(source).toContain("typeof sourceText === 'string'")
    expect(source).toContain('return sourceText')
    expect(source).toContain("path.extname(filePath || '')")
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
    expect(prompt).toContain('Do not name the project as a part, section, chunk, or card range')
    expect(prompt).toContain('Put only real reviewable flashcards in "cards"')
    expect(prompt).toContain('Write card fields in concise markdown')
    expect(prompt).toContain('<span class="cf-key">')
    expect(prompt).toContain('Keep "front" concise and mostly plain')
    expect(prompt).toContain('When color would improve scanning or retention')
    expect(prompt).toContain('highlight the target word or phrase where it appears')
    expect(prompt).toContain('Prefer a small number of meaningful highlights over decorating the whole card')
    expect(prompt).not.toContain('chunk 1 of')
  })

  it('marks multi-chunk prompts as chunk-local work', () => {
    const prompt = buildClaudeCodePrompt('basic', 'HSK context', 'chunk text', { index: 2, total: 4 })
    expect(prompt).toContain('chunk 2 of 4')
    expect(prompt).toContain('Generate cards only from this chunk')
    expect(prompt).toContain('description is temporary chunk metadata')
    expect(prompt).toContain('Do not name the project as a part, section, chunk, or card range')
  })

  it('includes accepted sample guidance in full-generation prompts', () => {
    const prompt = buildClaudeCodePrompt('basic', 'HSK context', 'source text', null, {
      clarifiedContext: 'Focus on Thai explanations',
      sampleFeedback: 'Highlight target words',
      sampleCards: [{ type: 'basic', front: '爱', back: '**love**' }]
    })

    expect(prompt).toContain('Clarified generation requirements')
    expect(prompt).toContain('Focus on Thai explanations')
    expect(prompt).toContain('User feedback on sample cards')
    expect(prompt).toContain('Accepted sample cards to preserve and follow as style examples')
    expect(prompt).toContain('爱')
  })

  it('preserves cloze syntax while allowing light markdown', () => {
    const prompt = buildClaudeCodePrompt('cloze', 'exam review', 'source text here')
    expect(prompt).toContain('Preserve valid cloze syntax')
    expect(prompt).toContain('{{c1::term}}')
    expect(prompt).toContain('use markdown sparingly')
  })
})

describe('Claude Code iterative generation', () => {
  it('builds a deck overview prompt without cards or coverage', () => {
    const prompt = buildClaudeCodeDeckOverviewPrompt('HSK learner', 'source text', {
      clarifiedContext: 'Chinese to Thai',
      sampleFeedback: 'Use full Thai labels',
      sampleCards: [{ type: 'basic', front: '爱', back: 'รัก' }]
    })

    expect(prompt).toContain('global Cardify deck overview')
    expect(prompt).toContain('Return only "description"; do not include cards or batch coverage')
    expect(prompt).toContain('Chinese to Thai')
    expect(prompt).toContain('Use full Thai labels')
    expect(prompt).toContain('爱')
    expect(prompt).not.toContain('"cards"')
    expect(prompt).not.toContain('"coverage"')
  })

  it('builds a batch prompt with progress, seed samples, feedback, coverage, and duplicate keys', () => {
    const prompt = buildClaudeCodeIterativeBatchPrompt('basic', 'HSK learner', 'source text', {
      batchSize: 10,
      maxBatches: 20,
      completedBatches: 2,
      clarifiedContext: 'Thai explanations',
      sampleFeedback: 'Highlight target words',
      acceptedSampleCards: [{ type: 'basic', front: '爱', back: '**รัก**' }],
      coverageHistory: [{ batchSummary: 'covered greetings' }],
      duplicateKeys: ['basic:爱\n**รัก**']
    })

    expect(prompt).toContain('Generate exactly 10 new basic flashcards for batch 3 of 20')
    expect(prompt).toContain('do not blindly slice')
    expect(prompt).toContain('Thai explanations')
    expect(prompt).toContain('Highlight target words')
    expect(prompt).toContain('covered greetings')
    expect(prompt).toContain('basic:爱')
    expect(prompt).toContain('"coverage"')
    expect(prompt).toContain('Do not return deck title or deck description')
    expect(prompt).not.toContain('"description"')
  })

  it('parses iterative batch output with coverage', () => {
    expect(extractIterativeBatchFromClaudeCodeOutput(JSON.stringify({
      cards: [{ front: 'Q', back: '**A**' }],
      coverage: { batchSummary: 'covered A', coveredTopics: ['A'], remainingFocus: 'B', done: false }
    }), 'basic')).toEqual({
      cards: [{ type: 'basic', front: 'Q', back: '**A**' }],
      coverage: { batchSummary: 'covered A', coveredTopics: ['A'], remainingFocus: 'B', done: false }
    })
  })
})

describe('Claude Code parse recovery', () => {
  it('removes API billing environment variables before launching Claude Code', () => {
    const env = createClaudeCodeEnv({
      PATH: '/bin',
      ANTHROPIC_API_KEY: 'sk-ant-test',
      ANTHROPIC_AUTH_TOKEN: 'token',
      ANTHROPIC_BASE_URL: 'https://example.test',
      CLAUDE_CODE_USE_BEDROCK: '1',
      AWS_ACCESS_KEY_ID: 'aws',
      KEEP_ME: 'yes'
    })

    expect(env.PATH).toContain('/bin')
    expect(env.PATH).toContain('/opt/homebrew/bin')
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined()
    expect(env.CLAUDE_CODE_USE_BEDROCK).toBeUndefined()
    expect(env.AWS_ACCESS_KEY_ID).toBeUndefined()
    expect(env.KEEP_ME).toBe('yes')
  })

  it('detects Claude Code JSON result errors even when the process exits successfully', () => {
    const stdout = JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: true,
      result: 'Credit balance is too low'
    })

    expect(claudeCodeResultErrorMessage(stdout)).toBe('Credit balance is too low')
  })

  it('builds a recovery prompt that demands valid JSON escaping and markdown in strings only', () => {
    const prompt = buildClaudeCodeRecoveryPrompt('basic', 'HSK review', 'Front: 爱\nBack: love')
    expect(prompt).toContain('previous response could not be parsed')
    expect(prompt).toContain('Return only a valid JSON object')
    expect(prompt).toContain('Every quote, newline, and backslash inside string values must be valid JSON escaping')
    expect(prompt).toContain('Markdown is allowed only inside JSON string values')
    expect(prompt).toContain('<span class="cf-key">')
    expect(prompt).toContain('When color would improve scanning or retention')
  })

  it('marks multi-chunk recovery prompts as chunk-local work', () => {
    const prompt = buildClaudeCodeRecoveryPrompt('basic', 'HSK review', 'Front: 爱\nBack: love', { index: 3, total: 5 })
    expect(prompt).toContain('recovery for chunk 3 of 5')
    expect(prompt).toContain('Generate cards only from this chunk')
    expect(prompt).toContain('not the final project overview')
  })

  it('omits json-schema during the recovery command', () => {
    const args = buildGenerationCommandArgs('{"type":"object"}', false)
    expect(args).toContain('--output-format')
    expect(args).not.toContain('--json-schema')
  })

  it('uses Claude Code default model unless a model is selected', () => {
    expect(buildGenerationCommandArgs('{"type":"object"}', true)).not.toContain('--model')
    expect(buildGenerationCommandArgs('{"type":"object"}', true, { claudeCodeModel: 'sonnet' })).toEqual(expect.arrayContaining(['--model', 'sonnet']))
    expect(buildGenerationCommandArgs('{"type":"object"}', true, { claudeCodeModel: 'opus' })).toEqual(expect.arrayContaining(['--model', 'opus']))
    expect(normalizeClaudeCodeModel('')).toBe('default')
  })
})

describe('Claude Code description combine', () => {
  it('builds an overview-only combine prompt', () => {
    const prompt = buildClaudeCodeDescriptionCombinePrompt('exam prep', [
      { title: 'Part 2: 61-100', purpose: 'Vocabulary', contents: ['Numbers'] },
      { title: 'HSK Vocabulary', purpose: 'Practice beginner words', contents: ['Greetings'] }
    ])

    expect(prompt).toContain('one final deck overview')
    expect(prompt).toContain('do not include cards')
    expect(prompt).toContain('Do not use a title based on a part, section, chunk, or numeric/card range')
    expect(prompt).toContain('exam prep')
    expect(prompt).toContain('HSK Vocabulary')
  })

  it('extracts description-only Claude Code output', () => {
    const output = JSON.stringify({
      result: JSON.stringify({
        description: {
          title: 'HSK 1 Vocabulary',
          purpose: 'Practice beginner Chinese',
          contents: ['Greetings']
        }
      })
    })

    expect(extractDescriptionFromClaudeCodeOutput(output)).toEqual({
      title: 'HSK 1 Vocabulary',
      purpose: 'Practice beginner Chinese',
      contents: ['Greetings']
    })
  })

  it('falls back to non-chunk title and preserves merged contents', () => {
    expect(fallbackCombinedDescription([
      { title: 'Part 2: 61-100', purpose: 'Vocabulary', contents: ['Numbers'] },
      { title: 'HSK 1 Vocabulary', purpose: 'Practice beginner Chinese', contents: ['Greetings', 'Numbers'] }
    ])).toEqual({
      title: 'HSK 1 Vocabulary',
      purpose: 'Practice beginner Chinese',
      contents: ['Numbers', 'Greetings']
    })
  })
})

describe('Claude Code clarify and sample prompts', () => {
  it('builds clarification prompt with rubric and cap', () => {
    const prompt = buildClaudeCodeClarificationPrompt('HSK learner', 'source text', [], 5)
    expect(prompt).toContain('Ask 1-2 targeted questions')
    expect(prompt).toContain('Hard cap: 5 total clarification questions')
    expect(prompt).toContain('Clarify rubric')
    expect(prompt).toContain('output language for cards/explanations when unclear')
    expect(prompt).toContain('ask what language or mix of languages to use')
    expect(prompt).toContain('audience/level')
    expect(prompt).toContain('Avoid asking about details already obvious')
  })

  it('extracts clarification questions from Claude Code output', () => {
    const output = JSON.stringify({
      result: JSON.stringify({
        status: 'questions',
        questions: ['What is your level?', 'Should cards be exam-style?']
      })
    })
    expect(extractClarificationFromClaudeCodeOutput(output)).toEqual({
      status: 'questions',
      questions: ['What is your level?', 'Should cards be exam-style?']
    })
  })

  it('extracts clear clarification output', () => {
    const output = JSON.stringify({
      structured_output: {
        status: 'clear',
        clarifiedContext: 'Generate concise HSK 1 cards.'
      }
    })
    expect(extractClarificationFromClaudeCodeOutput(output)).toEqual({
      status: 'clear',
      clarifiedContext: 'Generate concise HSK 1 cards.'
    })
  })

  it('builds sample prompt for exactly three cards with feedback and seeds', () => {
    const prompt = buildClaudeCodeSamplePrompt('basic', 'HSK learner', 'source text', {
      clarifiedContext: 'Beginner Mandarin',
      sampleFeedback: 'Use Thai meanings',
      sampleFeedbackHistory: ['Chinese-only fronts'],
      previousSampleCards: [{ type: 'basic', front: '旧', back: '**old**' }],
      sampleCards: [{ type: 'basic', front: '爱', back: '**love**' }]
    })
    expect(prompt).toContain('Generate exactly 3 basic sample flashcards')
    expect(prompt).toContain('accepted sample cards as style guidance')
    expect(prompt).toContain('Use Thai meanings')
    expect(prompt).toContain('Accumulated user feedback')
    expect(prompt).toContain('Chinese-only fronts')
    expect(prompt).toContain('Previous sample cards for comparison')
    expect(prompt).toContain('旧')
    expect(prompt).toContain('爱')
  })

  it('sample generation has parse recovery', () => {
    const fs = require('fs')
    const path = require('path')
    const source = fs.readFileSync(path.join(__dirname, '../src/lib/claudeCode.js'), 'utf8')

    expect(source).toContain('async function generateSampleCardsClaudeCode')
    expect(source).toContain('const retryPrompt = buildClaudeCodeRecoveryPrompt')
    expect(source).toContain('generation = extractGenerationFromClaudeCodeOutput(retry.stdout, cardFormat)')
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

  it('recovers balanced JSON embedded in prose', () => {
    const output = JSON.stringify({
      result: [
        'Here are the samples:',
        JSON.stringify({
          description: { title: 'Embedded', purpose: 'Study', contents: ['A'] },
          cards: [{ front: 'Q', back: 'A' }]
        }),
        'Done.'
      ].join('\n')
    })

    expect(extractGenerationFromClaudeCodeOutput(output, 'basic')).toEqual({
      description: {
        title: 'Embedded',
        purpose: 'Study',
        contents: ['A']
      },
      cards: [{ front: 'Q', back: 'A', type: 'basic' }]
    })
  })

  it('accepts sampleCards and samples aliases', () => {
    expect(extractGenerationFromClaudeCodeOutput(JSON.stringify({
      description: { title: 'Alias', purpose: 'Study', contents: [] },
      sampleCards: [{ front: 'Q1', back: 'A1' }]
    }), 'basic').cards).toEqual([{ front: 'Q1', back: 'A1', type: 'basic' }])

    expect(extractGenerationFromClaudeCodeOutput(JSON.stringify({
      samples: [{ text: '{{c1::Paris}} is the capital of France' }]
    }), 'cloze').cards).toEqual([{ text: '{{c1::Paris}} is the capital of France', type: 'cloze' }])
  })

  it('rejects empty sample card arrays', () => {
    expect(() => extractGenerationFromClaudeCodeOutput(JSON.stringify({
      description: { title: 'Empty', purpose: '', contents: [] },
      cards: []
    }), 'basic')).toThrow(/Failed to parse Claude response/)
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

describe('isChunkDescription', () => {
  it('detects range and part descriptions', () => {
    expect(isChunkDescription({
      title: 'HSK 1 词汇 — ภาษาจีน-ไทย (ส่วนที่ 2: คำที่ 63–101)',
      purpose: '',
      contents: []
    })).toBe(true)
    expect(isChunkDescription({
      title: 'Biology Basics',
      purpose: 'Part 2 of the source',
      contents: []
    })).toBe(true)
  })

  it('allows normal deck descriptions', () => {
    expect(isChunkDescription({
      title: 'HSK 1 Vocabulary',
      purpose: 'Practice core beginner Chinese vocabulary',
      contents: ['Nouns', 'Verbs']
    })).toBe(false)
  })
})
