'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  cleanStudyText,
  extractChineseAudioTargets,
  extractExampleTargets,
  extractFrontTarget,
  generateElevenLabsAudio,
  isRetryableElevenLabsError,
  normalizeSpeed,
  requestElevenLabsAudio,
  retryDelayMs,
  selectDeckCards
} = require('../src/lib/elevenlabsAudio')

describe('elevenlabsAudio', () => {
  test('extracts Front and Chinese example lines from current Anki-style notes', () => {
    const input = {
      deck: { name: 'HSK 1' },
      notes: [{
        id: 'note-a',
        noteType: 'basic',
        fields: {
          Front: '爱',
          Back: [
            '**พินอิน:** <span class="cf-key">ài</span>',
            '',
            '**ความหมาย:** <span class="cf-success">รัก</span>',
            '妈妈，我<span class="cf-key">爱</span>你。',
            '<span class="cf-muted">Māma, wǒ ài nǐ.</span>',
            '<span class="cf-muted">(แม่ ฉันรักแม่)</span>',
            '',
            '我<span class="cf-key">爱</span>吃米饭。',
            '<span class="cf-muted">Wǒ ài chī mǐfàn.</span>',
            '<span class="cf-warning">ข้อควรระวัง: 坐 กับ 做 ออกเสียงเหมือนกัน</span>'
          ].join('\n')
        }
      }]
    }

    const { deck, targets } = extractChineseAudioTargets(input)

    expect(deck.name).toBe('HSK 1')
    expect(targets).toEqual([
      expect.objectContaining({
        id: 'note-0001-front',
        noteId: 'note-a',
        kind: 'front',
        text: '爱。',
        relativeFile: path.join('front', 'note-0001-front.mp3')
      }),
      expect.objectContaining({
        id: 'note-0001-example-01',
        kind: 'example',
        text: '妈妈，我爱你。',
        relativeFile: path.join('examples', 'note-0001-example-01.mp3')
      }),
      expect.objectContaining({
        id: 'note-0001-example-02',
        kind: 'example',
        text: '我爱吃米饭。'
      })
    ])
  })

  test('extracts multiple examples and ignores pinyin, Thai, labels, notes, and duplicates', () => {
    expect(extractExampleTargets([
      '**ตัวอย่างประโยค:**',
      '甲：谢谢你！乙：<span class="cf-key">不客气</span>。',
      'Jiǎ: Xièxie nǐ! Yǐ: Bú kèqi.',
      '(ก: ขอบคุณ! ข: ไม่เป็นไร)',
      'หมายเหตุ: 是...的 ใช้เน้นข้อมูลเฉพาะ',
      '甲：谢谢你！乙：不客气。',
      '桌子上有一本书。'
    ].join('\n'))).toEqual([
      '甲：谢谢你！乙：不客气。',
      '桌子上有一本书。'
    ])
  })

  test('supports raw card arrays, cards objects, and projects input', () => {
    expect(selectDeckCards([
      { type: 'basic', front: '喝', back: '我喝茶。' }
    ]).cards[0].front).toBe('喝')

    expect(selectDeckCards({
      description: { title: 'Deck' },
      cards: [{ type: 'basic', front: '喝', back: '我喝茶。' }]
    }).deck.title).toBe('Deck')

    expect(selectDeckCards({
      projects: [
        { id: 'p1', cards: [{ front: '不', back: '我不是学生。' }] },
        { id: 'p2', cards: [{ front: '爱', back: '我爱你。' }] }
      ]
    }, { projectId: 'p2' }).cards[0].front).toBe('爱')
  })

  test('cleans markdown, semantic highlight tags, and semantic audio tags', () => {
    expect(cleanStudyText('**我<span class="cf-key">爱</span>你。** {{audio:example_1}}')).toBe('我爱你。')
    expect(extractChineseAudioTargets({
      notes: [{
        fields: {
          Front: '爱 {{audio:front}}',
          Back: '妈妈，我<span class="cf-key">爱</span>你。 {{audio:example_1}}'
        }
      }]
    }).targets.map(target => target.text)).toEqual(['爱。', '妈妈，我爱你。'])
  })

  test('adds a Chinese full stop to front targets for short TTS prompts', () => {
    expect(extractFrontTarget({ front: '爸爸' })).toBe('爸爸。')
    expect(extractFrontTarget({ front: '你好。' })).toBe('你好。')
    expect(extractFrontTarget({ front: '你好吗？' })).toBe('你好吗？')
  })

  test('generates audio files and manifest with mocked ElevenLabs responses', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cardify-elevenlabs-'))
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      arrayBuffer: async () => Buffer.from('mp3').buffer
    })

    const manifest = await generateElevenLabsAudio([
      { id: 'note-0001-front', noteId: 'n1', kind: 'front', text: '爱', relativeFile: path.join('front', 'note-0001-front.mp3') },
      { id: 'note-0001-example-01', noteId: 'n1', kind: 'example', text: '我爱你。', relativeFile: path.join('examples', 'note-0001-example-01.mp3') }
    ], {
      apiKey: 'test-key',
      outputDir: tmp,
      voiceId: 'voice',
      speed: 0.9,
      fetchImpl
    })

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).voice_settings).toEqual({ speed: 0.9 })
    expect(fs.existsSync(path.join(tmp, 'front', 'note-0001-front.mp3'))).toBe(true)
    expect(fs.existsSync(path.join(tmp, 'examples', 'note-0001-example-01.mp3'))).toBe(true)
    expect(manifest.targets.map(target => target.status)).toEqual(['success', 'success'])
    expect(manifest.speed).toBe(0.9)
    expect(JSON.parse(fs.readFileSync(path.join(tmp, 'manifest.json'), 'utf8')).targets).toHaveLength(2)
  })

  test('skips existing successful files unless force is passed', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cardify-elevenlabs-skip-'))
    fs.mkdirSync(path.join(tmp, 'front'), { recursive: true })
    fs.writeFileSync(path.join(tmp, 'front', 'note-0001-front.mp3'), 'old')
    fs.writeFileSync(path.join(tmp, 'manifest.json'), JSON.stringify({
      targets: [{ id: 'note-0001-front', status: 'success' }]
    }), 'utf8')
    const fetchImpl = jest.fn()

    const manifest = await generateElevenLabsAudio([
      { id: 'note-0001-front', noteId: 'n1', kind: 'front', text: '爱', relativeFile: path.join('front', 'note-0001-front.mp3') }
    ], {
      apiKey: 'test-key',
      outputDir: tmp,
      fetchImpl
    })

    expect(fetchImpl).not.toHaveBeenCalled()
    expect(manifest.targets[0].status).toBe('skipped')
  })

  test('retries retryable ElevenLabs errors and respects Retry-After', async () => {
    const fetchImpl = jest.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        headers: { get: () => '2' },
        text: async () => 'server overload'
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        arrayBuffer: async () => Buffer.from('ok').buffer
      })
    const sleep = jest.fn().mockResolvedValue(undefined)
    const onRetry = jest.fn()

    const audio = await requestElevenLabsAudio('你好。', {
      apiKey: 'test-key',
      voiceId: 'voice',
      fetchImpl,
      sleep,
      onRetry,
      retryAttempts: 1
    })

    expect(Buffer.isBuffer(audio)).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledWith(2000)
    expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({
      attempt: 1,
      status: 503,
      waitMs: 2000
    }))
    expect(isRetryableElevenLabsError({ status: 429 })).toBe(true)
    expect(isRetryableElevenLabsError({ status: 401 })).toBe(false)
    expect(retryDelayMs({ status: 503 }, 2, { retryBaseMs: 100, retryMaxMs: 500 })).toBe(400)
  })

  test('validates optional ElevenLabs speed', () => {
    expect(normalizeSpeed(undefined)).toBeNull()
    expect(normalizeSpeed('')).toBeNull()
    expect(normalizeSpeed('1.1')).toBe(1.1)
    expect(() => normalizeSpeed('fast')).toThrow(/speed must be a number/)
    expect(() => normalizeSpeed(0.6)).toThrow(/between 0.7 and 1.2/)
    expect(() => normalizeSpeed(1.3)).toThrow(/between 0.7 and 1.2/)
  })
})
