'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')

describe('refine-thai CLI', () => {
  afterEach(() => {
    jest.resetModules()
    jest.dontMock('../src/lib/geminiThaiRefinement')
  })

  test('requires GEMINI_API_KEY', async () => {
    const { main } = require('../scripts/refine-thai')
    await expect(main(['--input', 'deck.json', '--output', 'out.json'], {})).rejects.toThrow(/GEMINI_API_KEY/)
  })

  test('writes output file instead of mutating input', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cardify-refine-'))
    const inputPath = path.join(tmp, 'deck.json')
    const outputPath = path.join(tmp, 'deck.refined.json')
    fs.writeFileSync(inputPath, JSON.stringify({
      description: { title: 'Deck' },
      cards: [{ type: 'basic', front: '爱', back: 'รัก' }]
    }), 'utf8')

    jest.doMock('../src/lib/geminiThaiRefinement', () => {
      const actual = jest.requireActual('../src/lib/geminiThaiRefinement')
      return {
        ...actual,
        refineThaiCardsWithGemini: jest.fn().mockImplementation(async ({ onChunkComplete }) => {
          onChunkComplete({
            chunkNumber: 1,
            chunkCount: 1,
            refinedChunk: [{ index: 0, type: 'basic', front: '爱', back: 'ความรัก', changed: true }],
            refinedCards: [{ index: 0, type: 'basic', front: '爱', back: 'ความรัก', changed: true }]
          })
          return {
            description: { title: 'Deck' },
            cards: [{ type: 'basic', front: '爱', back: 'ความรัก' }]
          }
        })
      }
    })

    const { main } = require('../scripts/refine-thai')
    await main(['--input', inputPath, '--output', outputPath], { GEMINI_API_KEY: 'test-key' })

    expect(JSON.parse(fs.readFileSync(outputPath, 'utf8')).cards[0].back).toBe('ความรัก')
    expect(JSON.parse(fs.readFileSync(inputPath, 'utf8')).cards[0].back).toBe('รัก')
    expect(fs.existsSync(path.join(tmp, 'deck.refined.chunks', 'chunk-001-of-001.json'))).toBe(true)
    expect(JSON.parse(fs.readFileSync(path.join(tmp, 'deck.refined.chunks', 'partial.refined.json'), 'utf8')).cards[0].back).toBe('ความรัก')
  })

  test('supports --project-id for projects input', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cardify-refine-'))
    const inputPath = path.join(tmp, 'projects.json')
    const outputPath = path.join(tmp, 'projects.refined.json')
    fs.writeFileSync(inputPath, JSON.stringify({
      projects: [
        { id: 'p1', cards: [{ type: 'basic', front: '喝', back: 'ดื่ม' }] },
        { id: 'p2', cards: [{ type: 'basic', front: '爱', back: 'รัก' }] }
      ]
    }), 'utf8')

    const refineThaiCardsWithGemini = jest.fn().mockResolvedValue({
      projects: [
        { id: 'p1', cards: [{ type: 'basic', front: '喝', back: 'ดื่ม' }] },
        { id: 'p2', cards: [{ type: 'basic', front: '爱', back: 'ความรัก' }] }
      ]
    })

    jest.doMock('../src/lib/geminiThaiRefinement', () => {
      const actual = jest.requireActual('../src/lib/geminiThaiRefinement')
      return { ...actual, refineThaiCardsWithGemini }
    })

    const { main } = require('../scripts/refine-thai')
    await main([
      '--input', inputPath,
      '--output', outputPath,
      '--project-id', 'p2'
    ], { GEMINI_API_KEY: 'test-key' })

    expect(refineThaiCardsWithGemini.mock.calls[0][0].projectId).toBe('p2')
    expect(JSON.parse(fs.readFileSync(outputPath, 'utf8')).projects[1].cards[0].back).toBe('ความรัก')
  })

  test('passes style and recent example limits to refinement', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cardify-refine-'))
    const inputPath = path.join(tmp, 'deck.json')
    const outputPath = path.join(tmp, 'deck.refined.json')
    fs.writeFileSync(inputPath, JSON.stringify({
      cards: [{ type: 'basic', front: '爱', back: 'รัก' }]
    }), 'utf8')

    const refineThaiCardsWithGemini = jest.fn().mockResolvedValue({
      cards: [{ type: 'basic', front: '爱', back: 'รัก' }]
    })

    jest.doMock('../src/lib/geminiThaiRefinement', () => {
      const actual = jest.requireActual('../src/lib/geminiThaiRefinement')
      return { ...actual, refineThaiCardsWithGemini }
    })

    const { main, parseArgs, usage } = require('../scripts/refine-thai')
    expect(parseArgs([
      '--style-examples', '2',
      '--recent-examples', '1',
      '--thinking-level', 'low',
      '--thinking-budget', '0',
      '--retry-attempts', '5',
      '--retry-base-ms', '250',
      '--retry-max-ms', '5000',
      '--chunk-output-dir', 'chunks',
      '--quiet'
    ])).toEqual({
      styleExamples: 2,
      recentExamples: 1,
      thinkingLevel: 'low',
      thinkingBudget: 0,
      retryAttempts: 5,
      retryBaseMs: 250,
      retryMaxMs: 5000,
      chunkOutputDir: 'chunks',
      quiet: true
    })

    await main([
      '--input', inputPath,
      '--output', outputPath,
      '--style-examples', '2',
      '--recent-examples', '1',
      '--thinking-level', 'minimal',
      '--retry-attempts', '5',
      '--retry-base-ms', '250',
      '--retry-max-ms', '5000'
    ], { GEMINI_API_KEY: 'test-key' })

    expect(refineThaiCardsWithGemini.mock.calls[0][0].styleExampleLimit).toBe(2)
    expect(refineThaiCardsWithGemini.mock.calls[0][0].recentExampleLimit).toBe(1)
    expect(refineThaiCardsWithGemini.mock.calls[0][0].thinkingLevel).toBe('minimal')
    expect(refineThaiCardsWithGemini.mock.calls[0][0].retryAttempts).toBe(5)
    expect(refineThaiCardsWithGemini.mock.calls[0][0].retryBaseMs).toBe(250)
    expect(refineThaiCardsWithGemini.mock.calls[0][0].retryMaxMs).toBe(5000)
    expect(typeof refineThaiCardsWithGemini.mock.calls[0][0].onRetry).toBe('function')
    expect(typeof refineThaiCardsWithGemini.mock.calls[0][0].onProgress).toBe('function')
    expect(usage()).toContain('--style-examples')
    expect(usage()).toContain('--recent-examples')
    expect(usage()).toContain('--thinking-level')
    expect(usage()).toContain('--retry-attempts')
    expect(usage()).toContain('--chunk-output-dir')
    expect(usage()).toContain('--quiet')
  })

  test('quiet mode hides progress callbacks', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cardify-refine-quiet-'))
    const inputPath = path.join(tmp, 'deck.json')
    const outputPath = path.join(tmp, 'deck.refined.json')
    fs.writeFileSync(inputPath, JSON.stringify({
      cards: [{ type: 'basic', front: '爱', back: 'รัก' }]
    }), 'utf8')

    const refineThaiCardsWithGemini = jest.fn().mockResolvedValue({
      cards: [{ type: 'basic', front: '爱', back: 'รัก' }]
    })

    jest.doMock('../src/lib/geminiThaiRefinement', () => {
      const actual = jest.requireActual('../src/lib/geminiThaiRefinement')
      return { ...actual, refineThaiCardsWithGemini }
    })

    const { main } = require('../scripts/refine-thai')
    await main([
      '--input', inputPath,
      '--output', outputPath,
      '--quiet'
    ], { GEMINI_API_KEY: 'test-key' })

    expect(refineThaiCardsWithGemini.mock.calls[0][0].onRetry).toBeNull()
    expect(refineThaiCardsWithGemini.mock.calls[0][0].onProgress).toBeNull()
  })

  test('loads Gemini defaults from .env.local without exposing the key', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cardify-refine-env-'))
    const inputPath = path.join(tmp, 'deck.json')
    const outputPath = path.join(tmp, 'deck.refined.json')
    fs.writeFileSync(inputPath, JSON.stringify({
      cards: [{ type: 'basic', front: '爱', back: 'รัก' }]
    }), 'utf8')
    fs.writeFileSync(path.join(tmp, '.env.local'), [
      'GEMINI_API_KEY="test-key-from-file"',
      'GEMINI_MODEL=gemini-3.1-flash-lite',
      'GEMINI_CHUNK_SIZE=7',
      'GEMINI_STYLE_EXAMPLES=2',
      'GEMINI_RECENT_EXAMPLES=1',
      'GEMINI_THINKING_LEVEL=minimal',
      'GEMINI_RETRY_ATTEMPTS=6',
      'GEMINI_RETRY_BASE_MS=300',
      'GEMINI_RETRY_MAX_MS=9000'
    ].join('\n'), 'utf8')

    const refineThaiCardsWithGemini = jest.fn().mockResolvedValue({
      cards: [{ type: 'basic', front: '爱', back: 'รัก' }]
    })

    jest.doMock('../src/lib/geminiThaiRefinement', () => {
      const actual = jest.requireActual('../src/lib/geminiThaiRefinement')
      return { ...actual, refineThaiCardsWithGemini }
    })

    const { main, loadDotEnvLocal, resolveRuntimeEnv, usage } = require('../scripts/refine-thai')
    const previousCwd = process.cwd()
    const envKeys = [
      'GEMINI_API_KEY',
      'GEMINI_MODEL',
      'GEMINI_CHUNK_SIZE',
      'GEMINI_STYLE_EXAMPLES',
      'GEMINI_RECENT_EXAMPLES',
      'GEMINI_THINKING_LEVEL',
      'GEMINI_THINKING_BUDGET',
      'GEMINI_RETRY_ATTEMPTS',
      'GEMINI_RETRY_BASE_MS',
      'GEMINI_RETRY_MAX_MS'
    ]
    const previousEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]))
    envKeys.forEach(key => delete process.env[key])
    process.chdir(tmp)
    try {
      expect(loadDotEnvLocal(tmp).GEMINI_API_KEY).toBe('test-key-from-file')
      expect(resolveRuntimeEnv({ GEMINI_API_KEY: 'explicit-test-key' })).toEqual({ GEMINI_API_KEY: 'explicit-test-key' })
      await main(['--input', inputPath, '--output', outputPath])
    } finally {
      process.chdir(previousCwd)
      envKeys.forEach(key => {
        if (previousEnv[key] === undefined) delete process.env[key]
        else process.env[key] = previousEnv[key]
      })
    }

    expect(refineThaiCardsWithGemini.mock.calls[0][0]).toMatchObject({
      apiKey: 'test-key-from-file',
      model: 'gemini-3.1-flash-lite',
      chunkSize: 7,
      styleExampleLimit: 2,
      recentExampleLimit: 1,
      thinkingLevel: 'minimal',
      retryAttempts: 6,
      retryBaseMs: 300,
      retryMaxMs: 9000
    })
    expect(usage()).toContain('GEMINI_THINKING_LEVEL')
    expect(usage()).toContain('GEMINI_THINKING_BUDGET')
    expect(usage()).toContain('GEMINI_RETRY_ATTEMPTS')
  })
})
