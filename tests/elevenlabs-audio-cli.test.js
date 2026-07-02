'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')

describe('generate-elevenlabs-audio CLI', () => {
  afterEach(() => {
    jest.resetModules()
    jest.dontMock('../src/lib/elevenlabsAudio')
  })

  test('requires ELEVENLABS_API_KEY unless dry-run is used', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cardify-elevenlabs-cli-'))
    const inputPath = path.join(tmp, 'deck.json')
    fs.writeFileSync(inputPath, JSON.stringify({
      cards: [{ type: 'basic', front: '爱', back: '我爱你。' }]
    }), 'utf8')

    const { main } = require('../scripts/generate-elevenlabs-audio')
    await expect(main(['--input', inputPath], {})).rejects.toThrow(/ELEVENLABS_API_KEY/)
  })

  test('dry-run prints extracted targets without a network key', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cardify-elevenlabs-dry-'))
    const inputPath = path.join(tmp, 'deck.json')
    fs.writeFileSync(inputPath, JSON.stringify({
      deck: { name: 'HSK 1' },
      notes: [{
        fields: {
          Front: '爱',
          Back: '妈妈，我<span class="cf-key">爱</span>你。\nMāma, wǒ ài nǐ.'
        }
      }]
    }), 'utf8')
    const log = jest.spyOn(console, 'log').mockImplementation(() => {})

    const { main } = require('../scripts/generate-elevenlabs-audio')
    await main(['--input', inputPath, '--dry-run'], {})

    const output = log.mock.calls.map(call => call.join(' ')).join('\n')
    log.mockRestore()
    expect(output).toContain('Targets: 2')
    expect(output).toContain('front note-0001-front: 爱。')
    expect(output).toContain('example note-0001-example-01: 妈妈，我爱你。')
  })

  test('passes CLI options to mocked audio generator', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cardify-elevenlabs-options-'))
    const inputPath = path.join(tmp, 'deck.json')
    const outputDir = path.join(tmp, 'audio')
    fs.writeFileSync(inputPath, JSON.stringify({
      cards: [
        { type: 'basic', front: '爱', back: '我爱你。' },
        { type: 'basic', front: '喝', back: '我喝茶。' }
      ]
    }), 'utf8')

    const generateElevenLabsAudio = jest.fn().mockResolvedValue({
      targets: [
        { status: 'success' },
        { status: 'success' }
      ]
    })

    jest.doMock('../src/lib/elevenlabsAudio', () => {
      const actual = jest.requireActual('../src/lib/elevenlabsAudio')
      return { ...actual, generateElevenLabsAudio }
    })

    const { main, parseArgs, usage } = require('../scripts/generate-elevenlabs-audio')
    expect(parseArgs([
      '--only', 'examples',
      '--speed', '1.1',
      '--limit', '2',
      '--force',
      '--quiet',
      '--concurrency', '1',
      '--retry-attempts', '5',
      '--retry-base-ms', '250',
      '--retry-max-ms', '5000'
    ])).toMatchObject({
      only: 'examples',
      speed: 1.1,
      limit: 2,
      force: true,
      quiet: true,
      concurrency: 1,
      retryAttempts: 5,
      retryBaseMs: 250,
      retryMaxMs: 5000
    })

    await main([
      '--input', inputPath,
      '--output-dir', outputDir,
      '--voice-id', 'voice-123',
      '--model', 'eleven_multilingual_v2',
      '--output-format', 'mp3_44100_128',
      '--speed', '1.1',
      '--only', 'examples',
      '--limit', '2',
      '--force',
      '--concurrency', '1',
      '--retry-attempts', '5',
      '--retry-base-ms', '250',
      '--retry-max-ms', '5000',
      '--quiet'
    ], { ELEVENLABS_API_KEY: 'test-key' })

    expect(generateElevenLabsAudio).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({
      apiKey: 'test-key',
      outputDir,
      voiceId: 'voice-123',
      model: 'eleven_multilingual_v2',
      outputFormat: 'mp3_44100_128',
      speed: 1.1,
      only: 'examples',
      limit: 2,
      force: true,
      concurrency: 1,
      retryAttempts: 5,
      retryBaseMs: 250,
      retryMaxMs: 5000,
      onProgress: null,
      onRetry: null
    }))
    expect(usage()).toContain('--dry-run')
    expect(usage()).toContain('--speed')
    expect(usage()).toContain('ELEVENLABS_API_KEY')
  })

  test('loads ElevenLabs defaults from .env.local', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cardify-elevenlabs-env-'))
    const inputPath = path.join(tmp, 'deck.json')
    fs.writeFileSync(inputPath, JSON.stringify({
      cards: [{ type: 'basic', front: '爱', back: '我爱你。' }]
    }), 'utf8')
    fs.writeFileSync(path.join(tmp, '.env.local'), [
      'ELEVENLABS_API_KEY="test-key-from-file"',
      'ELEVENLABS_VOICE_ID=voice-from-env',
      'ELEVENLABS_MODEL_ID=eleven_multilingual_v2',
      'ELEVENLABS_OUTPUT_FORMAT=mp3_44100_128',
      'ELEVENLABS_SPEED=0.9',
      'ELEVENLABS_CONCURRENCY=1',
      'ELEVENLABS_RETRY_ATTEMPTS=4',
      'ELEVENLABS_RETRY_BASE_MS=300',
      'ELEVENLABS_RETRY_MAX_MS=9000'
    ].join('\n'), 'utf8')

    const generateElevenLabsAudio = jest.fn().mockResolvedValue({
      targets: [{ status: 'success' }]
    })

    jest.doMock('../src/lib/elevenlabsAudio', () => {
      const actual = jest.requireActual('../src/lib/elevenlabsAudio')
      return { ...actual, generateElevenLabsAudio }
    })

    const { loadDotEnvLocal, main, resolveRuntimeEnv } = require('../scripts/generate-elevenlabs-audio')
    const previousCwd = process.cwd()
    const envKeys = [
      'ELEVENLABS_API_KEY',
      'ELEVENLABS_VOICE_ID',
      'ELEVENLABS_MODEL_ID',
      'ELEVENLABS_OUTPUT_FORMAT',
      'ELEVENLABS_SPEED',
      'ELEVENLABS_CONCURRENCY',
      'ELEVENLABS_RETRY_ATTEMPTS',
      'ELEVENLABS_RETRY_BASE_MS',
      'ELEVENLABS_RETRY_MAX_MS'
    ]
    const previousEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]))
    envKeys.forEach(key => delete process.env[key])
    process.chdir(tmp)
    try {
      expect(loadDotEnvLocal(tmp).ELEVENLABS_API_KEY).toBe('test-key-from-file')
      expect(resolveRuntimeEnv({ ELEVENLABS_API_KEY: 'explicit' })).toEqual({ ELEVENLABS_API_KEY: 'explicit' })
      await main(['--input', inputPath, '--quiet'])
    } finally {
      process.chdir(previousCwd)
      envKeys.forEach(key => {
        if (previousEnv[key] === undefined) delete process.env[key]
        else process.env[key] = previousEnv[key]
      })
    }

    expect(generateElevenLabsAudio.mock.calls[0][1]).toMatchObject({
      apiKey: 'test-key-from-file',
      voiceId: 'voice-from-env',
      model: 'eleven_multilingual_v2',
      outputFormat: 'mp3_44100_128',
      speed: 0.9,
      concurrency: 1,
      retryAttempts: 4,
      retryBaseMs: 300,
      retryMaxMs: 9000
    })
  })
})
