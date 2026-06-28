'use strict'

const { spawn } = require('child_process')
const { chunkText, ParseError } = require('./claude')

const DEFAULT_CLAUDE_CODE_TIMEOUT_MS = 600000

class ClaudeCodeUnavailableError extends Error {
  constructor (message = 'Claude Code is not available or not authenticated') {
    super(message)
    this.name = 'ClaudeCodeUnavailableError'
    this.code = 'claude-code-unavailable'
  }
}

class ClaudeCodeError extends Error {
  constructor (message) {
    super(message)
    this.name = 'ClaudeCodeError'
    this.code = 'claude-code-error'
  }
}

function runClaudeCommand (args, input = '', options = {}) {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      PATH: [
        process.env.PATH || '',
        '/opt/homebrew/bin',
        '/usr/local/bin'
      ].filter(Boolean).join(':')
    }

    const child = spawn('claude', args, {
      cwd: options.cwd || process.cwd(),
      env,
      stdio: ['pipe', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''
    let settled = false
    const timeoutMs = options.timeoutMs || getClaudeCodeTimeoutMs()

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill('SIGTERM')
      setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL')
      }, 5000).unref?.()
      reject(new ClaudeCodeError(`Claude Code timed out after ${Math.round(timeoutMs / 1000)} seconds while generating cards`))
    }, timeoutMs)

    child.stdout.on('data', chunk => { stdout += chunk.toString('utf8') })
    child.stderr.on('data', chunk => { stderr += chunk.toString('utf8') })
    child.on('error', err => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (err.code === 'ENOENT') {
        reject(new ClaudeCodeUnavailableError('Claude Code CLI was not found on PATH'))
      } else {
        reject(new ClaudeCodeError(err.message))
      }
    })
    child.on('close', code => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (code !== 0) {
        const message = (stderr || stdout || `Claude Code exited with code ${code}`).trim()
        if (/not logged in|login|authentication|auth/i.test(message)) {
          reject(new ClaudeCodeUnavailableError(message))
        } else {
          reject(new ClaudeCodeError(message))
        }
        return
      }
      resolve({ stdout, stderr })
    })

    child.stdin.end(input)
  })
}

function getClaudeCodeTimeoutMs () {
  const configured = Number(process.env.CARDIFY_CLAUDE_CODE_TIMEOUT_MS)
  if (Number.isFinite(configured) && configured >= 30000) return configured
  return DEFAULT_CLAUDE_CODE_TIMEOUT_MS
}

function buildClaudeCodePrompt (cardFormat, contextPrompt, textChunk) {
  const formatInstruction =
    cardFormat === 'basic'
      ? 'Each card must have "front" and "back" strings.'
      : 'Each card must have a "text" string using Anki cloze syntax like {{c1::term}}.'

  return [
    `Generate a Cardify project from the source text.`,
    `The project must include both a deck description and ${cardFormat} Anki flashcards.`,
    `Tune both the description and cards to the user's context and study goal.`,
    `Return only data matching the provided JSON schema. No prose.`,
    `Your final answer must begin with "{" and end with "}".`,
    `Do not say "I've generated", "Here is", "Summary", or any other explanatory text.`,
    `Put deck/project overview information only in "description".`,
    `Put only real reviewable flashcards in "cards".`,
    `Do not put card-format examples, headings, study tips, or template descriptions in "cards".`,
    `Every card must contain concrete study content from the source text, not placeholders.`,
    formatInstruction,
    `The description title should be short. The purpose should say what the deck is for. The contents array should name the main topics covered.`,
    '',
    `Context: ${contextPrompt}`,
    '',
    `Source text:`,
    textChunk
  ].join('\n')
}

function outputSchemaForFormat (cardFormat) {
  const cardProperties = cardFormat === 'basic'
    ? {
        front: { type: 'string' },
        back: { type: 'string' }
      }
    : {
        text: { type: 'string' }
      }

  return {
    type: 'object',
    additionalProperties: false,
    required: ['description', 'cards'],
    properties: {
      description: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'purpose', 'contents'],
        properties: {
          title: { type: 'string' },
          purpose: { type: 'string' },
          contents: {
            type: 'array',
            items: { type: 'string' }
          }
        }
      },
      cards: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: Object.keys(cardProperties),
          properties: cardProperties
        }
      }
    }
  }
}

function defaultDescription () {
  return {
    title: 'Generated Cardify Project',
    purpose: '',
    contents: []
  }
}

function normalizeDescription (description) {
  if (!description || typeof description !== 'object' || Array.isArray(description)) {
    return defaultDescription()
  }

  return {
    title: String(description.title || 'Generated Cardify Project').trim() || 'Generated Cardify Project',
    purpose: String(description.purpose || '').trim(),
    contents: Array.isArray(description.contents)
      ? description.contents.map(item => String(item || '').trim()).filter(Boolean)
      : []
  }
}

function normalizeCards (cards, cardFormat) {
  if (!Array.isArray(cards)) return null

  return cards.map(card =>
    cardFormat === 'basic'
      ? { front: String(card.front ?? ''), back: String(card.back ?? ''), type: 'basic' }
      : { text: String(card.text ?? ''), type: 'cloze' }
  ).filter(card => !isTemplateCard(card))
}

function parseJsonFromText (text) {
  const trimmed = text.trim()
  try {
    return JSON.parse(trimmed)
  } catch {
    // Continue with recovery for Claude Code result text that wraps JSON in prose.
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim())
    } catch {
      // Continue with balanced-object recovery below.
    }
  }

  const balanced = extractFirstBalancedJson(trimmed)
  if (balanced) {
    return JSON.parse(balanced)
  }

  throw new ParseError(text)
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

function extractGenerationFromClaudeCodeOutput (stdout, cardFormat) {
  const trimmed = stdout.trim()
  let parsed
  try {
    parsed = parseJsonFromText(trimmed)
  } catch {
    throw new ParseError(stdout)
  }

  let payload = parsed.structured_output || parsed
  if (typeof parsed.result === 'string') {
    const resultText = parsed.result.trim()
    try {
      payload = parseJsonFromText(resultText)
    } catch {
      const markdownCards = parseMarkdownCards(resultText, cardFormat)
      if (markdownCards.length > 0) {
        return {
          description: defaultDescription(),
          cards: markdownCards
        }
      }
      throw new ParseError(parsed.result)
    }
  }

  const cards = normalizeCards(Array.isArray(payload) ? payload : payload.cards, cardFormat)
  if (!cards) throw new ParseError(stdout)

  return {
    description: normalizeDescription(Array.isArray(payload) ? null : payload.description),
    cards
  }
}

function extractCardsFromClaudeCodeOutput (stdout, cardFormat) {
  return extractGenerationFromClaudeCodeOutput(stdout, cardFormat).cards
}

function parseMarkdownCards (text, cardFormat) {
  const normalizedText = text.replace(/\\n/g, '\n')
  if (cardFormat === 'cloze') {
    return normalizedText
      .split('\n')
      .map(line => line.replace(/^\s*(?:[-*]|\d+\.)\s*/, '').trim())
      .filter(line => line.includes('{{c'))
      .map(line => ({ text: line, type: 'cloze' }))
      .filter(card => !isTemplateCard(card))
  }

  const cards = []
  const pairRe = /(?:^|\n)\s*(?:[-*]|\d+\.)?\s*\*\*Front:\*\*\s*([\s\S]*?)(?=\n\s*(?:[-*]|\d+\.)?\s*\*\*Back:\*\*)\n\s*(?:[-*]|\d+\.)?\s*\*\*Back:\*\*\s*([\s\S]*?)(?=\n\s*(?:[-*]|\d+\.)?\s*\*\*Front:\*\*|\n\s*\d+\.\s|\n\s*---|$)/gi
  let match
  while ((match = pairRe.exec(normalizedText)) !== null) {
    const front = match[1].trim()
    const back = match[2].trim()
    if (front && back) cards.push({ front, back, type: 'basic' })
  }
  return cards.filter(card => !isTemplateCard(card))
}

function isTemplateCard (card) {
  const haystack = card.type === 'cloze'
    ? String(card.text || '')
    : `${card.front || ''} ${card.back || ''}`
  const normalized = haystack.toLowerCase()

  return [
    'chinese character + pinyin',
    'english meaning + a sample sentence',
    'sample sentence (drawn from the source text)',
    'study tips for hsk',
    'front:',
    'back:'
  ].some(marker => normalized.includes(marker))
}

async function getClaudeCodeStatus () {
  try {
    const { stdout } = await runClaudeCommand(['auth', 'status'], '', { timeoutMs: 10000 })
    const status = JSON.parse(stdout)
    return {
      available: true,
      loggedIn: Boolean(status.loggedIn),
      authMethod: status.authMethod || null,
      email: status.email || null,
      subscriptionType: status.subscriptionType || null
    }
  } catch (err) {
    return {
      available: false,
      loggedIn: false,
      error: err.message
    }
  }
}

async function generateCardsClaudeCode (filePath, contextPrompt, cardFormat) {
  const fs = require('fs')
  const path = require('path')
  const ext = path.extname(filePath).toLowerCase()

  let text
  if (ext === '.pdf') {
    const { parseFile } = require('./parser')
    text = await parseFile(filePath)
  } else {
    text = fs.readFileSync(filePath, 'utf-8')
  }

  const chunks = chunkText(text)
  const cards = []
  const descriptions = []
  const schema = JSON.stringify(outputSchemaForFormat(cardFormat))

  for (const chunk of chunks) {
    const prompt = buildClaudeCodePrompt(cardFormat, contextPrompt, chunk)
    const { stdout } = await runClaudeCommand([
      '-p',
      '--output-format', 'json',
      '--model', 'sonnet',
      '--no-session-persistence',
      '--permission-mode', 'dontAsk',
      '--disable-slash-commands',
      '--system-prompt', 'You are a strict JSON API for generating Cardify projects. Return exactly one JSON object matching the schema. No markdown, no prose, no summary.',
      '--tools', '',
      '--json-schema', schema
    ], prompt)
    const generation = extractGenerationFromClaudeCodeOutput(stdout, cardFormat)
    descriptions.push(generation.description)
    cards.push(...generation.cards)
  }

  const firstDescription = descriptions.find(description =>
    description.title || description.purpose || description.contents.length > 0
  ) || defaultDescription()
  const contents = [...new Set(descriptions.flatMap(description => description.contents))]

  return {
    description: {
      ...firstDescription,
      contents
    },
    cards
  }
}

module.exports = {
  generateCardsClaudeCode,
  getClaudeCodeStatus,
  buildClaudeCodePrompt,
  extractGenerationFromClaudeCodeOutput,
  extractCardsFromClaudeCodeOutput,
  outputSchemaForFormat,
  parseMarkdownCards,
  parseJsonFromText,
  getClaudeCodeTimeoutMs,
  isTemplateCard,
  normalizeDescription,
  ClaudeCodeUnavailableError,
  ClaudeCodeError
}
