'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')

describe('tag-audio CLI', () => {
  test('uses default manifest and output paths beside the input file', () => {
    const { defaultManifestPath, defaultOutputPath } = require('../scripts/tag-audio')
    const input = path.join('/tmp', 'HSK1.refined.json')

    expect(defaultManifestPath(input)).toBe(path.join('/tmp', 'HSK1.refined.audio', 'manifest.json'))
    expect(defaultOutputPath(input)).toBe(path.join('/tmp', 'HSK1.refined.audio-tagged.json'))
  })

  test('writes tagged JSON without mutating the input file', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cardify-audio-tag-'))
    const inputPath = path.join(tmp, 'deck.json')
    const manifestPath = path.join(tmp, 'manifest.json')
    const outputPath = path.join(tmp, 'deck.audio-tagged.json')
    const input = {
      notes: [{
        fields: {
          Front: '爱',
          Back: '妈妈，我爱你。'
        }
      }]
    }
    fs.writeFileSync(inputPath, JSON.stringify(input, null, 2), 'utf8')
    fs.writeFileSync(manifestPath, JSON.stringify({
      targets: [
        { id: 'note-0001-front', noteIndex: 0, kind: 'front', text: '爱', file: 'front/note-0001-front.mp3', status: 'success' },
        { id: 'note-0001-example-01', noteIndex: 0, kind: 'example', text: '妈妈，我爱你。', file: 'examples/note-0001-example-01.mp3', status: 'success' }
      ]
    }), 'utf8')

    const log = jest.spyOn(console, 'log').mockImplementation(() => {})
    const { main } = require('../scripts/tag-audio')
    await main(['--input', inputPath, '--manifest', manifestPath, '--output', outputPath])
    log.mockRestore()

    expect(JSON.parse(fs.readFileSync(inputPath, 'utf8')).notes[0].fields.Front).toBe('爱')
    const output = JSON.parse(fs.readFileSync(outputPath, 'utf8'))
    expect(output.notes[0].fields.Front).toBe('爱')
    expect(output.notes[0].fields.Back).toBe('妈妈，我爱你。 {{audio:front}} {{audio:example_1}}')
  })
})
