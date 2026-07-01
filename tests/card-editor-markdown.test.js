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
  })
})
