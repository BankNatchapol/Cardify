'use strict'

const {
  audioTargetIdForSlot,
  buildAudioResolver,
  tagAudioInInput
} = require('../src/lib/audioTags.cjs')

function manifest (targets = []) {
  return {
    basePath: '/tmp/audio',
    targets
  }
}

describe('audioTags', () => {
  test('resolves semantic slots to deterministic target ids by card index', () => {
    expect(audioTargetIdForSlot(0, 'front')).toBe('note-0001-front')
    expect(audioTargetIdForSlot(4, 'example_2')).toBe('note-0005-example-02')
    expect(audioTargetIdForSlot(0, 'unknown')).toBe('')
  })

  test('adds semantic front audio to the back pronunciation line and example tags to examples', () => {
    const input = {
      deck: { name: 'HSK 1' },
      notes: [{
        id: 'n1',
        fields: {
          Front: '爱',
          Back: '**พินอิน:** <span class="cf-key">ài</span>\n媽媽，我<span class="cf-key">爱</span>你。\nMāma, wǒ ài nǐ.\nฉันรักแม่'
        }
      }]
    }

    const tagged = tagAudioInInput(input, manifest([
      { id: 'note-0001-front', noteIndex: 0, kind: 'front', text: '爱', file: 'front/note-0001-front.mp3', status: 'success' },
      { id: 'note-0001-example-01', noteIndex: 0, kind: 'example', text: '媽媽，我爱你。', file: 'examples/note-0001-example-01.mp3', status: 'success' }
    ]))

    expect(tagged.notes[0].fields.Front).toBe('爱')
    expect(tagged.notes[0].fields.Back).toContain('**พินอิน:** <span class="cf-key">ài</span> {{audio:front}}')
    expect(tagged.notes[0].fields.Back).toContain('媽媽，我<span class="cf-key">爱</span>你。 {{audio:example_1}}')
    expect(tagged.notes[0].fields.Back).toContain('Māma, wǒ ài nǐ.')
  })

  test('skips missing and failed audio targets', () => {
    const input = {
      notes: [{
        fields: {
          Front: '爱',
          Back: '妈妈，我爱你。'
        }
      }]
    }

    const tagged = tagAudioInInput(input, manifest([
      { id: 'note-0001-front', noteIndex: 0, kind: 'front', text: '爱', file: 'front/note-0001-front.mp3', status: 'error' },
      { id: 'note-0001-example-01', noteIndex: 0, kind: 'example', text: '妈妈，我爱你。', file: 'examples/note-0001-example-01.mp3', status: 'success' }
    ]))

    expect(tagged.notes[0].fields.Front).toBe('爱')
    expect(tagged.notes[0].fields.Back).toBe('妈妈，我爱你。 {{audio:example_1}}')
  })

  test('moves existing front audio tags off the front and does not duplicate semantic audio tags', () => {
    const input = {
      notes: [{
        fields: {
          Front: '爱 {{audio:front}}',
          Back: '**Pinyin:** ai {{audio:front}}\n妈妈，我爱你。 {{audio:example_1}}'
        }
      }]
    }

    const tagged = tagAudioInInput(input, manifest([
      { id: 'note-0001-front', noteIndex: 0, kind: 'front', text: '爱', file: 'front/note-0001-front.mp3', status: 'success' },
      { id: 'note-0001-example-01', noteIndex: 0, kind: 'example', text: '妈妈，我爱你。', file: 'examples/note-0001-example-01.mp3', status: 'success' }
    ]))

    expect(tagged.notes[0].fields.Front).toBe('爱')
    expect((tagged.notes[0].fields.Back.match(/\{\{audio:front\}\}/g) || [])).toHaveLength(1)
    expect((tagged.notes[0].fields.Back.match(/\{\{audio:example_1\}\}/g) || [])).toHaveLength(1)
  })

  test('builds a resolver for successful manifest targets only', () => {
    const resolver = buildAudioResolver(manifest([
      { id: 'note-0001-front', noteIndex: 0, kind: 'front', file: 'front/note-0001-front.mp3', fileUrl: 'file:///tmp/front.mp3', status: 'success' },
      { id: 'note-0001-example-01', noteIndex: 0, kind: 'example', file: 'examples/note-0001-example-01.mp3', status: 'error' }
    ]))

    expect(resolver(0, 'front')).toMatchObject({
      id: 'note-0001-front',
      fileName: 'note-0001-front.mp3',
      fileUrl: 'file:///tmp/front.mp3'
    })
    expect(resolver(0, 'example_1')).toBeNull()
  })
})
