'use strict'

function parseJsonFromText (text) {
  const trimmed = String(text || '').trim()
  if (!trimmed) throw new Error('Empty Claude output')

  try {
    return JSON.parse(trimmed)
  } catch {
    // Continue with recovery for output that wraps JSON in prose.
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim())
    } catch {
      // Continue with balanced JSON recovery below.
    }
  }

  const balanced = extractFirstBalancedJson(trimmed)
  if (balanced) return JSON.parse(balanced)

  throw new Error('No balanced JSON object or array found in Claude output')
}

function extractFirstBalancedJson (text) {
  const start = findJsonStart(text)
  if (start < 0) return null

  const opening = text[start]
  const closing = opening === '{' ? '}' : ']'
  let depth = 0
  let inString = false
  let escaped = false

  for (let i = start; i < text.length; i++) {
    const char = text[i]

    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
    } else if (char === opening) {
      depth++
    } else if (char === closing) {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }

  return null
}

function findJsonStart (text) {
  const objectStart = text.indexOf('{')
  const arrayStart = text.indexOf('[')
  if (objectStart < 0) return arrayStart
  if (arrayStart < 0) return objectStart
  return Math.min(objectStart, arrayStart)
}

function unwrapClaudePayload (parsed) {
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    if (parsed.structured_output !== undefined) return parsed.structured_output
    if (typeof parsed.result === 'string') return parseJsonFromText(parsed.result)
    if (parsed.result && typeof parsed.result === 'object') return parsed.result
  }
  return parsed
}

function cardsCandidateFromPayload (payload) {
  if (Array.isArray(payload)) return payload
  if (!payload || typeof payload !== 'object') return null
  return payload.cards || payload.sampleCards || payload.samples || null
}

function descriptionFromPayload (payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  return payload.description || null
}

module.exports = {
  parseJsonFromText,
  extractFirstBalancedJson,
  findJsonStart,
  unwrapClaudePayload,
  cardsCandidateFromPayload,
  descriptionFromPayload
}
