const path = require('path')
const fs = require('fs')
const os = require('os')

// We need to require parser after setting up mocks
let parseFile
let UnsupportedFileTypeError

beforeAll(() => {
  // Mock pdf-parse for unit tests
  jest.mock('pdf-parse', () => {
    return jest.fn().mockResolvedValue({ text: 'Extracted PDF text content for testing.' })
  })

  const parser = require('../src/lib/parser')
  parseFile = parser.parseFile
  UnsupportedFileTypeError = parser.UnsupportedFileTypeError
})

describe('parser.js', () => {
  describe('parseFile — .txt files', () => {
    it('returns the file contents for a .txt file', async () => {
      const tmpFile = path.join(os.tmpdir(), 'cardify-test-' + Date.now() + '.txt')
      const content = 'Hello, this is a test text file.\nIt has multiple lines.'
      fs.writeFileSync(tmpFile, content, 'utf8')

      try {
        const result = await parseFile(tmpFile)
        expect(result).toBe(content)
      } finally {
        fs.unlinkSync(tmpFile)
      }
    })

    it('returns empty string for an empty .txt file', async () => {
      const tmpFile = path.join(os.tmpdir(), 'cardify-empty-' + Date.now() + '.txt')
      fs.writeFileSync(tmpFile, '', 'utf8')

      try {
        const result = await parseFile(tmpFile)
        expect(result).toBe('')
      } finally {
        fs.unlinkSync(tmpFile)
      }
    })
  })

  describe('parseFile — .pdf files', () => {
    it('returns a non-empty string for a .pdf file', async () => {
      // pdf-parse is mocked to return 'Extracted PDF text content for testing.'
      const fakePdfPath = path.join(os.tmpdir(), 'cardify-test-' + Date.now() + '.pdf')
      // Write a placeholder file so fs.readFileSync doesn't throw
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

  describe('parseFile — unsupported file types', () => {
    it('throws UnsupportedFileTypeError for .docx', async () => {
      const fakePath = '/fake/path/document.docx'
      await expect(parseFile(fakePath)).rejects.toThrow(UnsupportedFileTypeError)
    })

    it('throws UnsupportedFileTypeError for .jpg', async () => {
      const fakePath = '/fake/path/image.jpg'
      await expect(parseFile(fakePath)).rejects.toThrow(UnsupportedFileTypeError)
    })

    it('throws UnsupportedFileTypeError for .png', async () => {
      const fakePath = '/fake/path/image.png'
      await expect(parseFile(fakePath)).rejects.toThrow(UnsupportedFileTypeError)
    })

    it('error message includes the unsupported extension', async () => {
      const fakePath = '/fake/path/data.csv'
      let caught = null
      try {
        await parseFile(fakePath)
      } catch (err) {
        caught = err
      }
      expect(caught).not.toBeNull()
      expect(caught).toBeInstanceOf(UnsupportedFileTypeError)
      expect(caught.message).toContain('.csv')
    })
  })
})
