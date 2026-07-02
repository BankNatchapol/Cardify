'use strict'

const fs = require('fs')
const path = require('path')

describe('CardEditor markdown preview UI', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/components/CardEditor.jsx'), 'utf8')

  test('keeps editable textareas and renders markdown previews', () => {
    expect(source).toContain('<textarea')
    expect(source).toContain('MarkdownPreview')
    expect(source).toContain('renderCardMarkdown')
    expect(source).toContain('dangerouslySetInnerHTML')
    expect(source).toContain('Front preview')
    expect(source).toContain('Back preview')
    expect(source).toContain('Cloze preview')
    expect(source).toContain("window.ipc.invoke('read-audio-file'")
    expect(source).toContain('data-audio-path')
    expect(source).toContain('playAudioUntilFinished')
    expect(source).toContain("audio.addEventListener('ended'")
    expect(source).toContain('audio-tag-button--playing')
    expect(source).toContain('audio-tag-button--error')
    expect(fs.readFileSync(path.join(__dirname, '../src/index.css'), 'utf8')).toContain('speaker-2-svgrepo-com.svg')
  })
})
