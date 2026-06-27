const fs = require('fs')
const path = require('path')

class UnsupportedFileTypeError extends Error {
  constructor(ext) {
    super(`Unsupported file type: "${ext}". Only .pdf and .txt are supported.`)
    this.name = 'UnsupportedFileTypeError'
    this.ext = ext
  }
}

/**
 * Parse a file and return its text content.
 * @param {string} filePath - Absolute path to the file
 * @returns {Promise<string>} Extracted text content
 * @throws {UnsupportedFileTypeError} For unsupported file extensions
 */
async function parseFile(filePath) {
  const ext = path.extname(filePath).toLowerCase()

  if (ext === '.pdf') {
    // Dynamic require to allow Jest to mock it
    const pdfParse = require('pdf-parse')
    const buffer = fs.readFileSync(filePath)
    const data = await pdfParse(buffer)
    return data.text
  }

  if (ext === '.txt') {
    const content = fs.readFileSync(filePath, 'utf8')
    return content
  }

  throw new UnsupportedFileTypeError(ext)
}

module.exports = { parseFile, UnsupportedFileTypeError }
