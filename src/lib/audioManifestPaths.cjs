'use strict'

const path = require('path')

function defaultAudioManifestCandidates (sourcePath) {
  const value = String(sourcePath || '')
  if (!/\.json$/i.test(value)) return []

  const withoutJson = value.replace(/\.json$/i, '')
  const bases = []
  if (/\.audio-tagged$/i.test(withoutJson)) {
    bases.push(withoutJson.replace(/\.audio-tagged$/i, ''))
  }
  bases.push(withoutJson)

  return Array.from(new Set(
    bases.map(base => path.join(`${base}.audio`, 'manifest.json'))
  ))
}

module.exports = { defaultAudioManifestCandidates }
