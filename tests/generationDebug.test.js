'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  createGenerationLogger,
  sanitizeLogRecord
} = require('../src/lib/generationDebug')

describe('generationDebug', () => {
  test('writes JSONL metadata to userData', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cardify-debug-'))
    const logger = createGenerationLogger({
      fs,
      path,
      app: { getPath: () => dir },
      env: {}
    })

    logger.write({
      debugId: 'sample-1',
      stage: 'generate-sample-cards',
      provider: 'claude-code',
      status: 'parse-error',
      stdout: 'secret generated content'
    })

    const logFile = path.join(dir, 'cardify-generation-debug.jsonl')
    const record = JSON.parse(fs.readFileSync(logFile, 'utf8').trim())
    expect(record.debugId).toBe('sample-1')
    expect(record.stage).toBe('generate-sample-cards')
    expect(record.stdout).toBeUndefined()
  })

  test('includes truncated output when debug is enabled', () => {
    const record = sanitizeLogRecord({
      debugId: 'sample-2',
      stdout: 'x'.repeat(5000)
    }, { CARDIFY_GENERATION_DEBUG: '1' })

    expect(record.stdout.startsWith('x'.repeat(4000))).toBe(true)
    expect(record.stdout).toContain('[truncated 1000 chars]')
  })

  test('includes full output only when raw debug is enabled', () => {
    const output = 'x'.repeat(5000)
    const record = sanitizeLogRecord({
      debugId: 'sample-3',
      stdout: output
    }, { CARDIFY_GENERATION_DEBUG_RAW: '1' })

    expect(record.stdout).toBe(output)
  })
})
