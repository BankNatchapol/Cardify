'use strict'

const {
  buildPrompt,
  buildClarificationPrompt,
  buildSamplePrompt,
  buildDeckOverviewPrompt,
  buildIterativeBatchPrompt,
  buildDescriptionCombinePrompt,
  fallbackCombinedDescription,
  chunkTextWithMetadata,
  mergeSeedCards,
  resolveClaudeApiModel,
  DEFAULT_CLAUDE_API_MODEL
} = require('../src/lib/claude')

describe('Claude API fallback prompt', () => {
  test('includes markdown and semantic color guidance for basic cards', () => {
    const prompt = buildPrompt('basic', 'biology exam', 'source text')

    expect(prompt.system).toContain('Write card fields in concise markdown')
    expect(prompt.system).toContain('keep the front short and mostly plain')
    expect(prompt.system).toContain('<span class="cf-key">')
    expect(prompt.system).toContain('Do not use inline styles')
    expect(prompt.system).toContain('When color would improve scanning or retention')
    expect(prompt.system).toContain('highlight the target word or phrase where it appears')
    expect(prompt.system).toContain('Prefer a small number of meaningful highlights over decorating the whole card')
    expect(prompt.system).toContain('Return ONLY a JSON object')
    expect(prompt.messages[0].content).toContain('biology exam')
    expect(prompt.messages[0].content).toContain('source text')
    expect(prompt.system).not.toContain('chunk 1 of')
  })

  test('includes cloze-specific markdown constraints', () => {
    const prompt = buildPrompt('cloze', 'medical exam', 'source text')

    expect(prompt.system).toContain('preserve valid Anki cloze syntax')
    expect(prompt.system).toContain('{{c1::term}}')
    expect(prompt.system).toContain('use markdown sparingly')
  })

  test('includes chunk-local instructions for multi-chunk generation', () => {
    const prompt = buildPrompt('basic', 'biology exam', 'source text', { index: 2, total: 3 })

    expect(prompt.system).toContain('chunk 2 of 3')
    expect(prompt.system).toContain('Generate cards only from this chunk')
    expect(prompt.system).toContain('description is temporary chunk metadata')
    expect(prompt.system).toContain('do not title it as a part, section, chunk, or card range')
  })

  test('full generation prompt includes clarified context and accepted samples', () => {
    const prompt = buildPrompt('basic', 'biology exam', 'source text', null, {
      clarifiedContext: 'Focus on mechanisms',
      sampleFeedback: 'Make backs shorter',
      sampleCards: [{ type: 'basic', front: 'ATP?', back: '**Energy currency**' }]
    })

    expect(prompt.messages[0].content).toContain('Clarified generation requirements')
    expect(prompt.messages[0].content).toContain('Focus on mechanisms')
    expect(prompt.messages[0].content).toContain('User feedback on sample cards')
    expect(prompt.messages[0].content).toContain('Accepted sample cards to preserve and follow as style examples')
    expect(prompt.messages[0].content).toContain('ATP?')
  })

  test('builds clarification prompt with rubric and question cap', () => {
    const prompt = buildClarificationPrompt('HSK learner', 'source text', [], 5)

    expect(prompt.system).toContain('Ask 1-2 targeted questions')
    expect(prompt.system).toContain('Hard cap: 5 total clarification questions')
    expect(prompt.system).toContain('Clarify rubric')
    expect(prompt.system).toContain('output language for cards/explanations when unclear')
    expect(prompt.system).toContain('ask what language or mix of languages to use')
    expect(prompt.system).toContain('audience/level')
    expect(prompt.system).toContain('Avoid asking about details already obvious')
  })

  test('builds sample prompt that requests exactly 3 cards and includes feedback', () => {
    const prompt = buildSamplePrompt('basic', 'HSK learner', 'source text', {
      clarifiedContext: 'Beginner Mandarin',
      sampleFeedback: 'Highlight target words',
      sampleFeedbackHistory: ['Use Chinese-only fronts'],
      previousSampleCards: [{ type: 'basic', front: '旧', back: 'old sample' }],
      sampleCards: [{ type: 'basic', front: '爱', back: '**love**' }]
    })

    expect(prompt.system).toContain('Generate exactly 3 basic sample flashcards')
    expect(prompt.system).toContain('accepted sample cards as style guidance')
    expect(prompt.messages[0].content).toContain('Highlight target words')
    expect(prompt.messages[0].content).toContain('Accumulated user feedback')
    expect(prompt.messages[0].content).toContain('Use Chinese-only fronts')
    expect(prompt.messages[0].content).toContain('Previous sample cards for comparison')
    expect(prompt.messages[0].content).toContain('old sample')
    expect(prompt.messages[0].content).toContain('爱')
  })

  test('builds iterative batch prompt with resume context', () => {
    const prompt = buildIterativeBatchPrompt('basic', 'HSK learner', 'source text', {
      batchSize: 10,
      maxBatches: 20,
      completedBatches: 4,
      clarifiedContext: 'Thai explanations',
      sampleFeedback: 'Highlight target terms',
      acceptedSampleCards: [{ type: 'basic', front: '电影', back: '**movie**' }],
      coverageHistory: [{ batchSummary: 'covered nouns' }],
      duplicateKeys: ['basic:电影\n**movie**']
    })

    expect(prompt.system).toContain('Generate exactly 10 new basic flashcards for batch 5 of 20')
    expect(prompt.system).toContain('do not blindly slice')
    expect(prompt.system).toContain('"coverage"')
    expect(prompt.system).toContain('Do not return deck title or deck description')
    expect(prompt.system).not.toContain('"description"')
    expect(prompt.messages[0].content).toContain('Thai explanations')
    expect(prompt.messages[0].content).toContain('Highlight target terms')
    expect(prompt.messages[0].content).toContain('covered nouns')
    expect(prompt.messages[0].content).toContain('basic:电影')
  })

  test('builds a deck overview prompt without cards or coverage', () => {
    const prompt = buildDeckOverviewPrompt('HSK learner', 'source text', {
      clarifiedContext: 'Chinese to Thai',
      sampleFeedback: 'Use full Thai labels',
      sampleCards: [{ type: 'basic', front: '爱', back: 'รัก' }]
    })

    expect(prompt.system).toContain('global Cardify deck overview')
    expect(prompt.system).toContain('Do not include cards or batch coverage')
    expect(prompt.system).toContain('"description"')
    expect(prompt.system).not.toContain('"cards"')
    expect(prompt.system).not.toContain('"coverage"')
    expect(prompt.messages[0].content).toContain('Chinese to Thai')
    expect(prompt.messages[0].content).toContain('Use full Thai labels')
    expect(prompt.messages[0].content).toContain('爱')
  })

  test('builds a description-only combine prompt', () => {
    const prompt = buildDescriptionCombinePrompt('biology exam', [
      { title: 'Part 1', purpose: 'Cells', contents: ['Organelles'] },
      { title: 'Cell Biology', purpose: 'Review cells', contents: ['Membranes'] }
    ])

    expect(prompt.system).toContain('one final deck overview')
    expect(prompt.system).toContain('Do not include cards')
    expect(prompt.system).toContain('Do not use titles based on part, section, chunk, or numeric/card ranges')
    expect(prompt.messages[0].content).toContain('biology exam')
  })

  test('adds metadata to chunks', () => {
    const text = 'x'.repeat(170000)
    const chunks = chunkTextWithMetadata(text)

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks[0].index).toBe(1)
    expect(chunks[0].total).toBe(chunks.length)
  })

  test('resolves Claude API model from env, settings, then default', () => {
    expect(resolveClaudeApiModel({ apiModel: 'settings-model' }, { CARDIFY_CLAUDE_MODEL: 'env-model' })).toBe('env-model')
    expect(resolveClaudeApiModel({ apiModel: 'settings-model' }, {})).toBe('settings-model')
    expect(resolveClaudeApiModel({}, {})).toBe(DEFAULT_CLAUDE_API_MODEL)
  })

  test('fallback combine avoids chunk-looking titles', () => {
    expect(fallbackCombinedDescription([
      { title: 'Chunk 1: 1-50', purpose: 'First half', contents: ['A'] },
      { title: 'Biology Review', purpose: 'Study key biology concepts', contents: ['B', 'A'] }
    ])).toEqual({
      title: 'Biology Review',
      purpose: 'Study key biology concepts',
      contents: ['A', 'B']
    })
  })

  test('mergeSeedCards preserves edited samples before generated cards and removes exact duplicates', () => {
    expect(mergeSeedCards([
      { type: 'basic', front: 'Q2', back: 'A2' },
      { type: 'basic', front: 'Q1', back: 'A1' }
    ], [
      { type: 'basic', front: 'Q1', back: 'A1' }
    ], 'basic')).toEqual([
      { type: 'basic', front: 'Q1', back: 'A1' },
      { type: 'basic', front: 'Q2', back: 'A2' }
    ])
  })
})
