#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const { tagAudioInInput } = require('../src/lib/audioTags.cjs')

async function main (argv = process.argv.slice(2)) {
  const args = parseArgs(argv)
  if (args.help) {
    console.log(usage())
    return 0
  }
  if (!args.input) throw new Error('Missing required --input')

  const inputPath = path.resolve(args.input)
  const manifestPath = path.resolve(args.manifest || defaultManifestPath(inputPath))
  const outputPath = path.resolve(args.output || defaultOutputPath(inputPath))
  if (inputPath === outputPath) throw new Error('Output path matches input path; choose a different --output')

  const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'))
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  const tagged = tagAudioInInput(input, manifest)

  fs.writeFileSync(outputPath, `${JSON.stringify(tagged, null, 2)}\n`, 'utf8')
  console.log(`Audio-tagged JSON written to ${outputPath}`)
  return 0
}

function parseArgs (argv) {
  const args = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') args.help = true
    else if (arg === '--input') args.input = nextValue(argv, ++i, arg)
    else if (arg === '--manifest') args.manifest = nextValue(argv, ++i, arg)
    else if (arg === '--output') args.output = nextValue(argv, ++i, arg)
    else throw new Error(`Unknown argument: ${arg}`)
  }
  return args
}

function nextValue (argv, index, flag) {
  const value = argv[index]
  if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`)
  return value
}

function defaultManifestPath (inputPath) {
  const parsed = path.parse(inputPath)
  return path.join(parsed.dir, `${parsed.name}.audio`, 'manifest.json')
}

function defaultOutputPath (inputPath) {
  const parsed = path.parse(inputPath)
  return path.join(parsed.dir, `${parsed.name}.audio-tagged${parsed.ext}`)
}

function usage () {
  return [
    'Usage:',
    '  node scripts/tag-audio.js --input decks/HSK1.refined.json',
    '',
    'Options:',
    '  --input <path>     Input Cardify or Anki-style deck JSON.',
    '  --manifest <path>  ElevenLabs manifest. Default: <input-name>.audio/manifest.json beside input.',
    '  --output <path>    Output JSON. Default: <input-name>.audio-tagged.json beside input.',
    '  --help             Show this help.'
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
  defaultManifestPath,
  defaultOutputPath,
  main,
  parseArgs,
  usage
}
