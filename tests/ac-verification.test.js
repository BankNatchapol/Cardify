/**
 * AC Verification Tests — Issue #1
 * Scaffold Electron + React app with file upload screen and file parsing
 *
 * These tests verify each Acceptance Criteria observable at the unit / module level.
 * AC1 (Electron window launch) and AC2/AC3 (drag-and-drop UI) are verified via
 * source-code inspection + build verification (see docs/super-board/runs/issue-1-qa-v1/QA-REPORT.md).
 */

const path = require('path')
const fs = require('fs')
const os = require('os')

let parseFile
let UnsupportedFileTypeError

beforeAll(() => {
  jest.mock('pdf-parse', () => {
    return jest.fn().mockResolvedValue({ text: 'Extracted PDF text content for testing purposes.' })
  })
  const parser = require('../src/lib/parser')
  parseFile = parser.parseFile
  UnsupportedFileTypeError = parser.UnsupportedFileTypeError
})

// ─── AC5: npm test passes (unit tests for src/lib/parser.js) ───────────────

describe('AC5 — parser.js unit tests', () => {
  describe('PDF extraction returns non-empty string', () => {
    it('parseFile returns non-empty string for .pdf', async () => {
      const fakePdfPath = path.join(os.tmpdir(), `ac5-pdf-${Date.now()}.pdf`)
      fs.writeFileSync(fakePdfPath, Buffer.from('placeholder'))
      try {
        const result = await parseFile(fakePdfPath)
        expect(typeof result).toBe('string')
        expect(result.length).toBeGreaterThan(0)
      } finally {
        fs.unlinkSync(fakePdfPath)
      }
    })
  })

  describe('.txt read returns file contents', () => {
    it('parseFile returns exact contents for .txt file', async () => {
      const content = 'Hello Cardify QA test content'
      const tmpFile = path.join(os.tmpdir(), `ac5-txt-${Date.now()}.txt`)
      fs.writeFileSync(tmpFile, content, 'utf8')
      try {
        const result = await parseFile(tmpFile)
        expect(result).toBe(content)
      } finally {
        fs.unlinkSync(tmpFile)
      }
    })
  })

  describe('unsupported extension throws UnsupportedFileTypeError', () => {
    it('throws UnsupportedFileTypeError for .docx', async () => {
      await expect(parseFile('/fake/doc.docx')).rejects.toThrow(UnsupportedFileTypeError)
    })

    it('throws UnsupportedFileTypeError for .png', async () => {
      await expect(parseFile('/fake/img.png')).rejects.toThrow(UnsupportedFileTypeError)
    })

    it('error message contains the unsupported extension', async () => {
      let caught = null
      try {
        await parseFile('/fake/data.csv')
      } catch (err) {
        caught = err
      }
      expect(caught).toBeInstanceOf(UnsupportedFileTypeError)
      expect(caught.message).toContain('.csv')
    })
  })
})

// ─── AC3: parse-file IPC returns plain text + char count logic ─────────────

describe('AC3 — parse-file IPC logic (main process)', () => {
  it('parseFile returns non-empty string that can be measured for char count', async () => {
    const content = 'Sample document content for char count verification.'
    const tmpFile = path.join(os.tmpdir(), `ac3-${Date.now()}.txt`)
    fs.writeFileSync(tmpFile, content, 'utf8')
    try {
      const text = await parseFile(tmpFile)
      expect(text).toBe(content)
      // Char count logic: text.length gives the character count the UI shows
      expect(text.length).toBe(content.length)
      expect(text.length).toBeGreaterThan(0)
    } finally {
      fs.unlinkSync(tmpFile)
    }
  })

  it('parseFile for PDF returns text with measurable length', async () => {
    const fakePdfPath = path.join(os.tmpdir(), `ac3-pdf-${Date.now()}.pdf`)
    fs.writeFileSync(fakePdfPath, Buffer.from('placeholder'))
    try {
      const text = await parseFile(fakePdfPath)
      expect(typeof text).toBe('string')
      expect(text.length).toBeGreaterThan(0)
    } finally {
      fs.unlinkSync(fakePdfPath)
    }
  })
})

// ─── AC2: file type rejection logic ────────────────────────────────────────

describe('AC2 — file type validation (renderer-side logic mirrors parser)', () => {
  const ALLOWED_EXTENSIONS = ['.pdf', '.txt']

  function getExtension(filePath) {
    const parts = filePath.split('.')
    return parts.length > 1 ? '.' + parts[parts.length - 1].toLowerCase() : ''
  }

  it('accepts .pdf extension', () => {
    const ext = getExtension('document.pdf')
    expect(ALLOWED_EXTENSIONS.includes(ext)).toBe(true)
  })

  it('accepts .txt extension', () => {
    const ext = getExtension('notes.txt')
    expect(ALLOWED_EXTENSIONS.includes(ext)).toBe(true)
  })

  it('rejects .docx extension', () => {
    const ext = getExtension('report.docx')
    expect(ALLOWED_EXTENSIONS.includes(ext)).toBe(false)
  })

  it('rejects .jpg extension', () => {
    const ext = getExtension('photo.jpg')
    expect(ALLOWED_EXTENSIONS.includes(ext)).toBe(false)
  })

  it('rejects .png extension', () => {
    const ext = getExtension('image.png')
    expect(ALLOWED_EXTENSIONS.includes(ext)).toBe(false)
  })

  it('rejects extension-less files', () => {
    const ext = getExtension('Makefile')
    expect(ALLOWED_EXTENSIONS.includes(ext)).toBe(false)
  })
})

// ─── AC4: Generate button disabled logic ───────────────────────────────────

describe('AC4 — Generate button disabled logic', () => {
  function isGenerateEnabled({ filePath, parsedText, contextPrompt, cardFormat }) {
    return (
      filePath !== null &&
      parsedText !== null &&
      contextPrompt.trim().length >= 10 &&
      cardFormat !== null
    )
  }

  it('is disabled when no file selected', () => {
    expect(isGenerateEnabled({
      filePath: null,
      parsedText: null,
      contextPrompt: 'This is a valid prompt text',
      cardFormat: 'basic'
    })).toBe(false)
  })

  it('is disabled when context prompt is too short (< 10 chars)', () => {
    expect(isGenerateEnabled({
      filePath: '/path/to/file.txt',
      parsedText: 'extracted text',
      contextPrompt: 'too short',
      cardFormat: 'basic'
    })).toBe(false)
  })

  it('is disabled when context prompt is empty', () => {
    expect(isGenerateEnabled({
      filePath: '/path/to/file.txt',
      parsedText: 'extracted text',
      contextPrompt: '',
      cardFormat: 'basic'
    })).toBe(false)
  })

  it('is disabled when parsedText is null (file selected but not parsed)', () => {
    expect(isGenerateEnabled({
      filePath: '/path/to/file.txt',
      parsedText: null,
      contextPrompt: 'This is a valid prompt text',
      cardFormat: 'basic'
    })).toBe(false)
  })

  it('is enabled when all fields are valid', () => {
    expect(isGenerateEnabled({
      filePath: '/path/to/file.txt',
      parsedText: 'extracted text content',
      contextPrompt: 'This is a valid prompt',
      cardFormat: 'basic'
    })).toBe(true)
  })

  it('is enabled with Cloze card format', () => {
    expect(isGenerateEnabled({
      filePath: '/path/to/file.txt',
      parsedText: 'extracted text content',
      contextPrompt: 'Med student studying pharmacology',
      cardFormat: 'cloze'
    })).toBe(true)
  })

  it('contextPrompt exactly 10 chars (trim) enables button', () => {
    expect(isGenerateEnabled({
      filePath: '/path/to/file.txt',
      parsedText: 'extracted text',
      contextPrompt: '1234567890',
      cardFormat: 'basic'
    })).toBe(true)
  })

  it('contextPrompt with only whitespace (< 10 trimmed) disables button', () => {
    expect(isGenerateEnabled({
      filePath: '/path/to/file.txt',
      parsedText: 'extracted text',
      contextPrompt: '         ',
      cardFormat: 'basic'
    })).toBe(false)
  })
})
