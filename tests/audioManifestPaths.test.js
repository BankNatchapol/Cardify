'use strict'

const path = require('path')
const { defaultAudioManifestCandidates } = require('../src/lib/audioManifestPaths.cjs')

describe('defaultAudioManifestCandidates', () => {
  test('finds a manifest beside normal JSON decks', () => {
    expect(defaultAudioManifestCandidates('/tmp/HSK1.refined.json')).toEqual([
      path.join('/tmp/HSK1.refined.audio', 'manifest.json')
    ])
  })

  test('finds the original audio folder for audio-tagged JSON decks', () => {
    expect(defaultAudioManifestCandidates('/tmp/HSK1.refined.audio-tagged.json')).toEqual([
      path.join('/tmp/HSK1.refined.audio', 'manifest.json'),
      path.join('/tmp/HSK1.refined.audio-tagged.audio', 'manifest.json')
    ])
  })

  test('ignores non-json source paths', () => {
    expect(defaultAudioManifestCandidates('/tmp/source.pdf')).toEqual([])
  })
})
