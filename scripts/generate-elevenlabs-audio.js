#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const {
  DEFAULT_ELEVENLABS_CONCURRENCY,
  DEFAULT_ELEVENLABS_MODEL,
  DEFAULT_ELEVENLABS_OUTPUT_FORMAT,
  DEFAULT_ELEVENLABS_RETRY_ATTEMPTS,
  DEFAULT_ELEVENLABS_RETRY_BASE_MS,
  DEFAULT_ELEVENLABS_RETRY_MAX_MS,
  DEFAULT_ELEVENLABS_VOICE_ID,
  extractChineseAudioTargets,
  generateElevenLabsAudio
} = require('../src/lib/elevenlabsAudio')

async function main (argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv)
  if (args.help) {
    console.log(usage())
    return 0
  }
  if (!args.input) throw new Error('Missing required --input')

  const inputPath = path.resolve(args.input)
  const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'))
  const { deck, targets } = extractChineseAudioTargets(input, { projectId: args.projectId })
  const selectedTargets = filterTargets(targets, args)
  const outputDir = path.resolve(args.outputDir || defaultAudioOutputDir(inputPath))
  const runtimeEnv = resolveRuntimeEnv(env)
  const voiceId = args.voiceId || runtimeEnv.ELEVENLABS_VOICE_ID || DEFAULT_ELEVENLABS_VOICE_ID
  const model = args.model || runtimeEnv.ELEVENLABS_MODEL_ID || DEFAULT_ELEVENLABS_MODEL
  const outputFormat = args.outputFormat || runtimeEnv.ELEVENLABS_OUTPUT_FORMAT || DEFAULT_ELEVENLABS_OUTPUT_FORMAT
  const speed = args.speed ?? envOptionalNumber(runtimeEnv.ELEVENLABS_SPEED)
  const concurrency = args.concurrency ?? envNumber(runtimeEnv.ELEVENLABS_CONCURRENCY, DEFAULT_ELEVENLABS_CONCURRENCY)
  const quiet = Boolean(args.quiet)

  if (args.dryRun) {
    printDryRun({ inputPath, outputDir, deck, targets: selectedTargets, voiceId, model, outputFormat, speed })
    return 0
  }

  const apiKey = runtimeEnv.ELEVENLABS_API_KEY
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY is required')

  if (!quiet) {
    console.error(`ElevenLabs audio generation: ${selectedTargets.length} targets using ${voiceId}`)
    console.error(`Output directory: ${outputDir}`)
  }

  const manifest = await generateElevenLabsAudio(targets, {
    apiKey,
    deck,
    sourceFile: inputPath,
    outputDir,
    voiceId,
    model,
    outputFormat,
    speed,
    only: args.only || 'all',
    limit: args.limit,
    force: args.force,
    concurrency,
    retryAttempts: args.retryAttempts ?? envNumber(runtimeEnv.ELEVENLABS_RETRY_ATTEMPTS, DEFAULT_ELEVENLABS_RETRY_ATTEMPTS),
    retryBaseMs: args.retryBaseMs ?? envNumber(runtimeEnv.ELEVENLABS_RETRY_BASE_MS, DEFAULT_ELEVENLABS_RETRY_BASE_MS),
    retryMaxMs: args.retryMaxMs ?? envNumber(runtimeEnv.ELEVENLABS_RETRY_MAX_MS, DEFAULT_ELEVENLABS_RETRY_MAX_MS),
    onProgress: quiet ? null : logProgress,
    onRetry: quiet ? null : logRetry
  })

  const counts = manifest.targets.reduce((acc, target) => {
    acc[target.status] = (acc[target.status] || 0) + 1
    return acc
  }, {})
  console.log(`ElevenLabs audio manifest written to ${path.join(outputDir, 'manifest.json')}`)
  console.log(`Generated ${counts.success || 0}, skipped ${counts.skipped || 0}, failed ${counts.error || 0}`)
  return 0
}

function parseArgs (argv) {
  const args = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') args.help = true
    else if (arg === '--input') args.input = nextValue(argv, ++i, arg)
    else if (arg === '--output-dir') args.outputDir = nextValue(argv, ++i, arg)
    else if (arg === '--voice-id') args.voiceId = nextValue(argv, ++i, arg)
    else if (arg === '--model') args.model = nextValue(argv, ++i, arg)
    else if (arg === '--output-format') args.outputFormat = nextValue(argv, ++i, arg)
    else if (arg === '--speed') args.speed = Number.parseFloat(nextValue(argv, ++i, arg))
    else if (arg === '--only') args.only = parseOnly(nextValue(argv, ++i, arg))
    else if (arg === '--limit') args.limit = Number.parseInt(nextValue(argv, ++i, arg), 10)
    else if (arg === '--concurrency') args.concurrency = Number.parseInt(nextValue(argv, ++i, arg), 10)
    else if (arg === '--retry-attempts') args.retryAttempts = Number.parseInt(nextValue(argv, ++i, arg), 10)
    else if (arg === '--retry-base-ms') args.retryBaseMs = Number.parseInt(nextValue(argv, ++i, arg), 10)
    else if (arg === '--retry-max-ms') args.retryMaxMs = Number.parseInt(nextValue(argv, ++i, arg), 10)
    else if (arg === '--project-id') args.projectId = nextValue(argv, ++i, arg)
    else if (arg === '--dry-run') args.dryRun = true
    else if (arg === '--force') args.force = true
    else if (arg === '--quiet') args.quiet = true
    else throw new Error(`Unknown argument: ${arg}`)
  }
  return args
}

function parseOnly (value) {
  if (!['all', 'front', 'fronts', 'example', 'examples'].includes(value)) {
    throw new Error('--only must be front, examples, or all')
  }
  if (value === 'fronts') return 'front'
  if (value === 'example') return 'examples'
  return value
}

function filterTargets (targets, args = {}) {
  const only = args.only || 'all'
  let selected = only === 'all'
    ? [...targets]
    : targets.filter(target => target.kind === only.replace(/s$/, ''))
  if (Number.isFinite(Number(args.limit)) && Number(args.limit) >= 0) {
    selected = selected.slice(0, Number(args.limit))
  }
  return selected
}

function printDryRun ({ inputPath, outputDir, deck, targets, voiceId, model, outputFormat, speed }) {
  console.log(`Input: ${inputPath}`)
  console.log(`Output directory: ${outputDir}`)
  console.log(`Deck: ${deck?.name || deck?.title || deck?.description?.title || 'Untitled deck'}`)
  console.log(`Voice: ${voiceId}`)
  console.log(`Model: ${model}`)
  console.log(`Output format: ${outputFormat}`)
  if (speed != null) console.log(`Speed: ${speed}`)
  console.log(`Targets: ${targets.length}`)
  targets.slice(0, 20).forEach((target, index) => {
    console.log(`${index + 1}. ${target.kind} ${target.id}: ${target.text}`)
  })
  if (targets.length > 20) console.log(`... ${targets.length - 20} more targets`)
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
  const number = Number.parseFloat(value)
  return Number.isFinite(number) ? number : undefined
}

function nextValue (argv, index, flag) {
  const value = argv[index]
  if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`)
  return value
}

function defaultAudioOutputDir (inputPath) {
  const parsed = path.parse(inputPath)
  return path.join(parsed.dir, `${parsed.name}.audio`)
}

function logProgress (info) {
  const number = `${info.index + 1}/${info.total}`
  if (info.stage === 'start') {
    console.error(`ElevenLabs ${number}: generating ${info.target.kind} "${info.target.text}"`)
  } else if (info.stage === 'skip') {
    console.error(`ElevenLabs ${number}: skipped ${info.target.id}`)
  } else if (info.stage === 'complete') {
    console.error(`ElevenLabs ${number}: wrote ${info.target.file}`)
  } else if (info.stage === 'error') {
    console.error(`ElevenLabs ${number}: failed ${info.target.id}: ${info.target.error}`)
  }
}

function logRetry (info) {
  const status = info.status ? ` status ${info.status}` : ''
  console.error(`ElevenLabs retry ${info.attempt}/${info.retryAttempts}${status}; waiting ${Math.round(info.waitMs)}ms`)
}

function usage () {
  return [
    'Usage:',
    '  ELEVENLABS_API_KEY=... node scripts/generate-elevenlabs-audio.js --input deck.json --voice-id 5ncWmV8ucTKnJsg8AQLM',
    '',
    'Options:',
    '  --input <path>           Input Cardify or Anki-style deck JSON.',
    '  --output-dir <path>      Audio output directory. Default: <input-name>.audio beside input.',
    `  --voice-id <id>          ElevenLabs voice id. Default: ${DEFAULT_ELEVENLABS_VOICE_ID}`,
    `  --model <id>             ElevenLabs model id. Default: ${DEFAULT_ELEVENLABS_MODEL}`,
    `  --output-format <format> Output format. Default: ${DEFAULT_ELEVENLABS_OUTPUT_FORMAT}`,
    '  --speed <n>              Optional voice speed, 0.7 slower to 1.2 faster. Default: voice default.',
    '  --only <mode>            front, examples, or all. Default: all.',
    '  --limit <n>              Generate only the first n extracted targets.',
    `  --concurrency <n>        Parallel requests. Default: ${DEFAULT_ELEVENLABS_CONCURRENCY}`,
    `  --retry-attempts <n>     Retries for 429/5xx transient errors. Default: ${DEFAULT_ELEVENLABS_RETRY_ATTEMPTS}`,
    `  --retry-base-ms <n>      Initial retry backoff in milliseconds. Default: ${DEFAULT_ELEVENLABS_RETRY_BASE_MS}`,
    `  --retry-max-ms <n>       Maximum retry backoff in milliseconds. Default: ${DEFAULT_ELEVENLABS_RETRY_MAX_MS}`,
    '  --dry-run                Print extracted targets without calling ElevenLabs.',
    '  --force                  Regenerate audio even if manifest/file already exists.',
    '  --project-id <id>        Select a project from { "projects": [...] } input.',
    '  --quiet                  Hide progress and retry logs.',
    '  --help                   Show this help.',
    '',
    'Environment:',
    '  .env.local is loaded automatically when running the CLI directly.',
    '  Supported keys: ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID,',
    '  ELEVENLABS_MODEL_ID, ELEVENLABS_OUTPUT_FORMAT, ELEVENLABS_SPEED, ELEVENLABS_CONCURRENCY,',
    '  ELEVENLABS_RETRY_ATTEMPTS, ELEVENLABS_RETRY_BASE_MS, ELEVENLABS_RETRY_MAX_MS.'
  ].join('\n')
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
  defaultAudioOutputDir,
  filterTargets,
  loadDotEnvLocal,
  logProgress,
  logRetry,
  main,
  parseArgs,
  resolveRuntimeEnv,
  usage
}
