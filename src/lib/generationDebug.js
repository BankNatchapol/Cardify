'use strict'

const DEFAULT_OUTPUT_LIMIT = 4000

function createDebugId (prefix = 'gen') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function isDebugEnabled (env = process.env) {
  return env.CARDIFY_GENERATION_DEBUG === '1' || env.CARDIFY_GENERATION_DEBUG_RAW === '1'
}

function isRawDebugEnabled (env = process.env) {
  return env.CARDIFY_GENERATION_DEBUG_RAW === '1'
}

function redactValue (value, env = process.env) {
  if (value === undefined || value === null) return undefined
  const text = String(value)
  if (isRawDebugEnabled(env)) return text
  if (!isDebugEnabled(env)) return undefined
  if (text.length <= DEFAULT_OUTPUT_LIMIT) return text
  return `${text.slice(0, DEFAULT_OUTPUT_LIMIT)}\n...[truncated ${text.length - DEFAULT_OUTPUT_LIMIT} chars]`
}

function sanitizeLogRecord (record, env = process.env) {
  const sanitized = {
    timestamp: new Date().toISOString(),
    ...record
  }

  if (sanitized.error && typeof sanitized.error === 'object') {
    sanitized.error = {
      name: sanitized.error.name,
      code: sanitized.error.code,
      message: sanitized.error.message
    }
  }

  const stdout = redactValue(sanitized.stdout, env)
  const stderr = redactValue(sanitized.stderr, env)
  delete sanitized.stdout
  delete sanitized.stderr
  if (stdout !== undefined) sanitized.stdout = stdout
  if (stderr !== undefined) sanitized.stderr = stderr

  return Object.fromEntries(
    Object.entries(sanitized).filter(([, value]) => value !== undefined)
  )
}

function createGenerationLogger ({ fs, path, app, env = process.env } = {}) {
  function getLogFilePath () {
    if (!app?.getPath) return null
    return path.join(app.getPath('userData'), 'cardify-generation-debug.jsonl')
  }

  function write (record) {
    const file = getLogFilePath()
    if (!file) return null
    const sanitized = sanitizeLogRecord(record, env)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.appendFileSync(file, `${JSON.stringify(sanitized)}\n`, { mode: 0o600 })
    return sanitized
  }

  return { write, getLogFilePath }
}

module.exports = {
  createDebugId,
  createGenerationLogger,
  isDebugEnabled,
  isRawDebugEnabled,
  sanitizeLogRecord
}
