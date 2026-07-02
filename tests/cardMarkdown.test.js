'use strict'

const { renderCardMarkdown } = require('../src/lib/cardMarkdown.cjs')

describe('renderCardMarkdown', () => {
  test('renders common markdown blocks and inline formatting', () => {
    const html = renderCardMarkdown([
      '## Key idea',
      '',
      '**Photosynthesis** uses _light_.',
      '',
      '- CO2',
      '- H2O',
      '',
      '> Energy capture',
      '',
      '| Term | Meaning |',
      '| --- | --- |',
      '| ATP | Energy currency |',
      '',
      '`code`',
      '',
      '```js',
      'const x = 1',
      '```'
    ].join('\n'))

    expect(html).toContain('<h2>Key idea</h2>')
    expect(html).toContain('<strong>Photosynthesis</strong>')
    expect(html).toContain('<em>light</em>')
    expect(html).toContain('<ul><li>CO2</li><li>H2O</li></ul>')
    expect(html).toContain('<blockquote>Energy capture</blockquote>')
    expect(html).toContain('<table>')
    expect(html).toContain('<code>code</code>')
    expect(html).toContain('<pre><code class="language-js">const x = 1</code></pre>')
  })

  test('preserves allowed semantic color tags', () => {
    const html = renderCardMarkdown('<mark>high</mark> <span class="cf-key">key</span>')
    expect(html).toContain('<mark>high</mark>')
    expect(html).toContain('<span class="cf-key">key</span>')
  })

  test('converts semantic classes to Anki-safe inline styles', () => {
    const html = renderCardMarkdown('<span class="cf-warning">danger</span>', { target: 'anki' })
    expect(html).toContain('<span class="cf-warning" style="color:#b45309;font-weight:700;">danger</span>')
  })

  test('strips unsafe html and arbitrary styling', () => {
    const html = renderCardMarkdown('<img src=x onerror=alert(1)> <span style="color:red" class="bad">bad</span><script>alert(1)</script>')
    expect(html).not.toContain('<img')
    expect(html).not.toContain('onerror')
    expect(html).not.toContain('<span style=')
    expect(html).not.toContain('script')
    expect(html).not.toContain('&lt;img')
    expect(html).toContain('<p> bad</p>')
  })

  test('preserves Anki cloze syntax', () => {
    const html = renderCardMarkdown('The capital is **{{c1::Paris}}**.', { target: 'anki' })
    expect(html).toContain('<strong>{{c1::Paris}}</strong>')
  })

  test('hides unresolved semantic audio tags', () => {
    const html = renderCardMarkdown('爱 {{audio:front}}')
    expect(html).toBe('<p>爱 </p>')
    expect(html).not.toContain('{{audio:front}}')
  })

  test('renders resolved semantic audio tags as compact preview controls', () => {
    const html = renderCardMarkdown('爱 {{audio:front}}', {
      resolveAudioTag: slot => ({
        slot,
        fileName: 'note-0001-front.mp3',
        filePath: '/tmp/note-0001-front.mp3',
        fileUrl: 'file:///tmp/note-0001-front.mp3'
      })
    })

    expect(html).toContain('class="audio-tag-button"')
    expect(html).toContain('data-audio-src="file:///tmp/note-0001-front.mp3"')
    expect(html).toContain('data-audio-path="/tmp/note-0001-front.mp3"')
    expect(html).toContain('class="audio-tag-icon"')
    expect(html).not.toContain('audio-tag-speaker')
    expect(html).not.toContain('>Play</button>')
  })

  test('converts resolved semantic audio tags to Anki sound references', () => {
    const html = renderCardMarkdown('爱 {{audio:front}}', {
      target: 'anki',
      resolveAudioTag: () => ({ fileName: 'note-0001-front.mp3' })
    })

    expect(html).toBe('<p>爱 [sound:note-0001-front.mp3]</p>')
  })
})
