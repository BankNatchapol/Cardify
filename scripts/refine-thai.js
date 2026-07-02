#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const {
  DEFAULT_CHUNK_SIZE,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_GEMINI_RETRY_ATTEMPTS,
  DEFAULT_GEMINI_RETRY_BASE_MS,
  DEFAULT_GEMINI_RETRY_MAX_MS,
  DEFAULT_RECENT_EXAMPLE_LIMIT,
  DEFAULT_STYLE_EXAMPLE_LIMIT,
  applyRefinedCardsToInput,
  inferDeckContext,
  refineThaiCardsWithGemini,
  selectCardsTarget
} = require('../src/lib/geminiThaiRefinement')

async function main (argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv)
  if (args.help) {
    console.log(usage())
    return 0
  }

  if (!args.input) throw new Error('Missing required --input')
  if (!args.inPlace && !args.output) throw new Error('Missing required --output unless --in-place is used')
  const runtimeEnv = resolveRuntimeEnv(env)
  const apiKey = runtimeEnv.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY is required')
  const quiet = Boolean(args.quiet)

  const inputPath = path.resolve(args.input)
  const outputPath = path.resolve(args.inPlace ? args.input : args.output)
  if (!args.inPlace && inputPath === outputPath) {
    throw new Error('Output path matches input path; use --in-place to overwrite intentionally')
  }

  const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'))
  selectCardsTarget(input, { projectId: args.projectId })
  const chunkOutputDir = args.chunkOutputDir || defaultChunkOutputDir(outputPath)
  const onChunkComplete = createChunkWriter({
    input,
    outputPath,
    chunkOutputDir,
    projectId: args.projectId,
    quiet
  })
  const refined = await refineThaiCardsWithGemini({
    input,
    projectId: args.projectId,
    deckContext: inferDeckContext(input, { projectId: args.projectId }),
    apiKey,
    model: args.model || runtimeEnv.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
    chunkSize: args.chunkSize || envNumber(runtimeEnv.GEMINI_CHUNK_SIZE, DEFAULT_CHUNK_SIZE),
    styleExampleLimit: args.styleExamples ?? envNumber(runtimeEnv.GEMINI_STYLE_EXAMPLES, DEFAULT_STYLE_EXAMPLE_LIMIT),
    recentExampleLimit: args.recentExamples ?? envNumber(runtimeEnv.GEMINI_RECENT_EXAMPLES, DEFAULT_RECENT_EXAMPLE_LIMIT),
    thinkingBudget: args.thinkingBudget ?? envOptionalNumber(runtimeEnv.GEMINI_THINKING_BUDGET),
    thinkingLevel: args.thinkingLevel || runtimeEnv.GEMINI_THINKING_LEVEL,
    retryAttempts: args.retryAttempts ?? envNumber(runtimeEnv.GEMINI_RETRY_ATTEMPTS, DEFAULT_GEMINI_RETRY_ATTEMPTS),
    retryBaseMs: args.retryBaseMs ?? envNumber(runtimeEnv.GEMINI_RETRY_BASE_MS, DEFAULT_GEMINI_RETRY_BASE_MS),
    retryMaxMs: args.retryMaxMs ?? envNumber(runtimeEnv.GEMINI_RETRY_MAX_MS, DEFAULT_GEMINI_RETRY_MAX_MS),
    onRetry: quiet ? null : logRetry,
    onProgress: quiet ? null : logProgress,
    onChunkComplete
  })

  fs.writeFileSync(outputPath, `${JSON.stringify(refined, null, 2)}\n`, 'utf8')
  console.log(`Refined Thai wording written to ${outputPath}`)
  return 0
}

function parseArgs (argv) {
  const args = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') args.help = true
    else if (arg === '--in-place') args.inPlace = true
    else if (arg === '--input') args.input = nextValue(argv, ++i, arg)
    else if (arg === '--output') args.output = nextValue(argv, ++i, arg)
    else if (arg === '--model') args.model = nextValue(argv, ++i, arg)
    else if (arg === '--chunk-size') args.chunkSize = Number.parseInt(nextValue(argv, ++i, arg), 10)
    else if (arg === '--style-examples') args.styleExamples = Number.parseInt(nextValue(argv, ++i, arg), 10)
    else if (arg === '--recent-examples') args.recentExamples = Number.parseInt(nextValue(argv, ++i, arg), 10)
    else if (arg === '--thinking-budget') args.thinkingBudget = Number.parseInt(nextValue(argv, ++i, arg), 10)
    else if (arg === '--thinking-level') args.thinkingLevel = nextValue(argv, ++i, arg)
    else if (arg === '--retry-attempts') args.retryAttempts = Number.parseInt(nextValue(argv, ++i, arg), 10)
    else if (arg === '--retry-base-ms') args.retryBaseMs = Number.parseInt(nextValue(argv, ++i, arg), 10)
    else if (arg === '--retry-max-ms') args.retryMaxMs = Number.parseInt(nextValue(argv, ++i, arg), 10)
    else if (arg === '--chunk-output-dir') args.chunkOutputDir = nextValue(argv, ++i, arg)
    else if (arg === '--quiet') args.quiet = true
    else if (arg === '--project-id') args.projectId = nextValue(argv, ++i, arg)
    else throw new Error(`Unknown argument: ${arg}`)
  }
  return args
}

function resolveRuntimeEnv (env = process.env) {
  if (env !== process.env) return env
  return {
    ...loadDotEnvLocal(process.cwd()),
    ...env
  }
}

function loadDotEnvLocal (cwd = process.cwd()) {
  const filePath = path.join(cwd, '.env.local')
  if (!fs.existsSync(filePath)) return {}

  const values = {}
  const content = fs.readFileSync(filePath, 'utf8')
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!match) continue
    values[match[1]] = unquoteEnvValue(match[2].trim())
  }
  return values
}

function unquoteEnvValue (value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1)
  }
  return value
}

function envNumber (value, fallback) {
  const number = Number.parseInt(value, 10)
  return Number.isFinite(number) ? number : fallback
}

function envOptionalNumber (value) {
  const number = Number.parseInt(value, 10)
  return Number.isFinite(number) ? number : undefined
}

function nextValue (argv, index, flag) {
  const value = argv[index]
  if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`)
  return value
}

function usage () {
  return [
    'Usage:',
    '  GEMINI_API_KEY=... node scripts/refine-thai.js --input deck.json --output deck.refined.json',
    '',
    'Options:',
    '  --input <path>       Input Cardify JSON file.',
    '  --output <path>      Output JSON file. Required unless --in-place is used.',
    '  --in-place           Overwrite the input file intentionally.',
    `  --model <model>      Gemini model. Default: ${DEFAULT_GEMINI_MODEL}`,
    `  --chunk-size <n>     Cards per Gemini request. Default: ${DEFAULT_CHUNK_SIZE}`,
    `  --style-examples <n> Read-only anchor cards sent with each request. Default: ${DEFAULT_STYLE_EXAMPLE_LIMIT}`,
    `  --recent-examples <n> Recently refined cards sent with the next request. Default: ${DEFAULT_RECENT_EXAMPLE_LIMIT}`,
    '  --thinking-level <level> Gemini 3+ thinking level: minimal, low, medium, or high.',
    '  --thinking-budget <n> Legacy Gemini 2.5 thinking budget. Examples: 0 disables, -1 automatic.',
    `  --retry-attempts <n> Retries for 429/5xx transient errors. Default: ${DEFAULT_GEMINI_RETRY_ATTEMPTS}`,
    `  --retry-base-ms <n> Initial retry backoff in milliseconds. Default: ${DEFAULT_GEMINI_RETRY_BASE_MS}`,
    `  --retry-max-ms <n> Maximum retry backoff in milliseconds. Default: ${DEFAULT_GEMINI_RETRY_MAX_MS}`,
    '  --chunk-output-dir <path> Save completed chunk checkpoints here.',
    '  --quiet             Hide progress and retry logs.',
    '  --project-id <id>    Select a project from { "projects": [...] } input.',
    '',
    'Environment:',
    '  .env.local is loaded automatically when running the CLI directly.',
    '  Supported keys: GEMINI_API_KEY, GEMINI_MODEL, GEMINI_CHUNK_SIZE,',
    '  GEMINI_STYLE_EXAMPLES, GEMINI_RECENT_EXAMPLES, GEMINI_THINKING_LEVEL,',
    '  GEMINI_THINKING_BUDGET, GEMINI_RETRY_ATTEMPTS, GEMINI_RETRY_BASE_MS,',
    '  GEMINI_RETRY_MAX_MS.',
    '  --help              Show this help.'
  ].join('\n')
}

function defaultChunkOutputDir (outputPath) {
  const parsed = path.parse(outputPath)
  return path.join(parsed.dir, `${parsed.name}.chunks`)
}

function createChunkWriter ({ input, outputPath, chunkOutputDir, projectId, quiet }) {
  return info => {
    fs.mkdirSync(chunkOutputDir, { recursive: true })
    const chunkFile = path.join(
      chunkOutputDir,
      `chunk-${String(info.chunkNumber).padStart(3, '0')}-of-${String(info.chunkCount).padStart(3, '0')}.json`
    )
    fs.writeFileSync(chunkFile, `${JSON.stringify({
      chunkNumber: info.chunkNumber,
      chunkCount: info.chunkCount,
      cardIndexes: info.refinedChunk.map(card => card.index),
      cards: info.refinedChunk
    }, null, 2)}\n`, 'utf8')

    const partial = applyRefinedCardsToInput(input, info.refinedCards, { projectId })
    const partialFile = path.join(chunkOutputDir, 'partial.refined.json')
    fs.writeFileSync(partialFile, `${JSON.stringify(partial, null, 2)}\n`, 'utf8')
    if (!quiet) {
      console.error(`Gemini chunk ${info.chunkNumber}/${info.chunkCount}: checkpoint written to ${chunkFile}`)
      console.error(`Gemini partial output written to ${partialFile}`)
    }
  }
}

function logProgress (info) {
  if (info.stage === 'start') {
    console.error(`Gemini Thai refinement: ${info.totalCards} cards in ${info.totalChunks} chunks (${info.chunkSize}/chunk) using ${info.model}`)
  } else if (info.stage === 'chunk-start') {
    const rangeStart = info.refinedCards + 1
    const rangeEnd = info.refinedCards + info.chunkCards
    console.error(`Gemini chunk ${info.chunkNumber}/${info.chunkCount}: refining cards ${rangeStart}-${rangeEnd} of ${info.totalCards}`)
  } else if (info.stage === 'chunk-complete') {
    console.error(`Gemini chunk ${info.chunkNumber}/${info.chunkCount}: complete (${info.refinedCards}/${info.totalCards} cards, ${formatDuration(info.durationMs)})`)
  } else if (info.stage === 'complete') {
    console.error(`Gemini Thai refinement complete: ${info.refinedCards}/${info.totalCards} cards refined`)
  }
}

function logRetry (info) {
  const chunk = info.chunkNumber && info.chunkCount
    ? ` chunk ${info.chunkNumber}/${info.chunkCount}`
    : ''
  const status = info.status ? ` status ${info.status}` : ''
  console.error(`Gemini retry ${info.attempt}/${info.retryAttempts}${chunk}${status}; waiting ${Math.round(info.waitMs)}ms`)
}

function formatDuration (ms) {
  if (!Number.isFinite(Number(ms))) return 'unknown'
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

if (require.main === module) {
  main().then(
    code => process.exit(code),
    err => {
      console.error(err.message)
      process.exit(1)
    }
  )
}

module.exports = {
  main,
  parseArgs,
  createChunkWriter,
  defaultChunkOutputDir,
  resolveRuntimeEnv,
  loadDotEnvLocal,
  logProgress,
  logRetry,
  usage
}
