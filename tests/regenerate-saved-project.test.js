'use strict'

const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8')

describe('regenerating saved projects', () => {
  test('Upload defines parsedText and enables generation from saved cards', () => {
    const upload = read('src/screens/Upload.jsx')

    expect(upload).toContain('const parsedText = initialState.parsedText || null')
    expect(upload).toContain('filePath !== null || parsedText !== null || generatedCardCount > 0')
    expect(upload).toContain('await onGenerate({ filePath, fileName, parsedText, contextPrompt, cardFormat })')
  })

  test('App falls back to saved card contents when original source text is unavailable', () => {
    const app = read('src/App.jsx')

    expect(app).toContain('function cardsToRegenerationSource')
    expect(app).toContain('Regenerate these existing flashcards into a polished Cardify deck.')
    expect(app).toContain('Do not merely copy the existing back text unchanged')
    expect(app).toContain('Using saved cards as regeneration source')
    expect(app).toContain('parsedText = cardsToRegenerationSource(cards, description)')
    expect(app).toContain('parsedText,')
    expect(app).toContain('charCount,')
  })

  test('main process passes parsedText to Claude Code and API fallback', () => {
    const main = read('electron/main.js')

    expect(main).toContain('prepareGeneration, generateSampleCards, generateDeckOverview, generateIterativeBatch, ApiKeyError')
    expect(main).toContain('sourceText = typeof parsedText')
    expect(main).toContain('generateCardsClaudeCode(filePath, contextPrompt, cardFormat, sourceText, options)')
    expect(main).toContain('return generateCards(sourceText, contextPrompt, cardFormat, apiKey, options)')
    expect(main).toContain('async function runWithClaudeFallback')
    expect(main).toContain('function isParseError')
    expect(main).toContain('return generationParseErrorResponse(debugId)')
    expect(main).toContain("error: 'generation-parse-error'")
    expect(main).toContain("error: 'claude-code-timeout'")
    expect(main).toContain('return claudeCodeTimeoutResponse(err)')
  })

  test('App generates deck overview before batches and ignores batch descriptions', () => {
    const app = read('src/App.jsx')

    expect(app).toContain("window.ipc.invoke('generate-deck-overview'")
    expect(app).toContain('descriptionRef.current = overviewDescription')
    expect(app).toContain('const nextDescription = descriptionRef.current')
    expect(app).not.toContain('normalizeDescription(payload.description')
  })
})
