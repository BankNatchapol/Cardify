import React, { useState, useRef, useCallback } from 'react'

const ALLOWED_EXTENSIONS = ['.pdf', '.txt']

function getExtension(filePath) {
  const parts = filePath.split('.')
  return parts.length > 1 ? '.' + parts[parts.length - 1].toLowerCase() : ''
}

export default function Upload({ initialState = {}, onComplete, onOpenSettings, apiKeySet = false }) {
  const [filePath, setFilePath] = useState(initialState.filePath || null)
  const [fileName, setFileName] = useState('')
  const [parsedText, setParsedText] = useState(initialState.parsedText || null)
  const [contextPrompt, setContextPrompt] = useState(initialState.contextPrompt || '')
  const [cardFormat, setCardFormat] = useState(initialState.cardFormat || 'basic')
  const [fileError, setFileError] = useState(null)
  const [parsing, setParsing] = useState(false)
  const [charCount, setCharCount] = useState(null)
  const [dragOver, setDragOver] = useState(false)

  const fileInputRef = useRef(null)

  const isGenerateEnabled =
    filePath !== null &&
    parsedText !== null &&
    contextPrompt.trim().length >= 10 &&
    cardFormat !== null &&
    apiKeySet

  const handleFile = useCallback(async (path, name) => {
    const ext = getExtension(path)
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      setFileError(`File type "${ext}" is not supported. Please select a .pdf or .txt file.`)
      setFilePath(null)
      setFileName('')
      setParsedText(null)
      setCharCount(null)
      return
    }

    setFileError(null)
    setFilePath(path)
    setFileName(name)
    setParsedText(null)
    setCharCount(null)
    setParsing(true)

    try {
      const text = await window.ipc.invoke('parse-file', path)
      setParsedText(text)
      setCharCount(text.length)
    } catch (err) {
      setFileError(`Failed to parse file: ${err.message}`)
      setFilePath(null)
      setFileName('')
    } finally {
      setParsing(false)
    }
  }, [])

  const handleFileInputChange = (e) => {
    const file = e.target.files[0]
    if (file) {
      handleFile(file.path, file.name)
    }
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) {
      handleFile(file.path, file.name)
    }
  }

  const handleDragOver = (e) => {
    e.preventDefault()
    setDragOver(true)
  }

  const handleDragLeave = () => {
    setDragOver(false)
  }

  const handleGenerate = () => {
    if (!isGenerateEnabled) return
    if (onComplete) {
      onComplete({ filePath, parsedText, contextPrompt, cardFormat })
    }
  }

  return (
    <div className="upload-screen">
      <header className="upload-header">
        <button
          type="button"
          className="settings-btn"
          onClick={onOpenSettings}
          aria-label="Open Settings"
          title="Settings"
        >
          ⚙ Settings
        </button>
        <h1>Cardify</h1>
        <p className="subtitle">Generate flashcards from your documents</p>
      </header>

      <main className="upload-main">
        {/* File drop zone */}
        <div
          className={`drop-zone ${dragOver ? 'drag-over' : ''} ${filePath ? 'has-file' : ''}`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
          aria-label="Drop a PDF or text file here or click to browse"
          onKeyDown={(e) => e.key === 'Enter' && fileInputRef.current?.click()}
        >
          {parsing ? (
            <p className="drop-zone-text">Parsing file...</p>
          ) : filePath ? (
            <div className="file-info">
              <p className="file-name">{fileName}</p>
              {charCount !== null && (
                <p className="char-count">{charCount.toLocaleString()} characters extracted</p>
              )}
              <p className="drop-zone-hint">Click or drop to replace</p>
            </div>
          ) : (
            <>
              <p className="drop-zone-text">Drop a PDF or .txt file here</p>
              <p className="drop-zone-hint">or click to browse</p>
            </>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.txt"
            onChange={handleFileInputChange}
            style={{ display: 'none' }}
            aria-hidden="true"
          />
        </div>

        {fileError && (
          <p className="error-message" role="alert">
            {fileError}
          </p>
        )}

        {/* Context prompt */}
        <div className="field-group">
          <label htmlFor="context-prompt" className="field-label">
            Context prompt <span className="required">*</span>
          </label>
          <textarea
            id="context-prompt"
            className="context-textarea"
            rows={4}
            placeholder="Describe your study goal and level — e.g. 'Med student, Step 1 pharmacology, focus on mechanisms not brand names'"
            value={contextPrompt}
            onChange={(e) => setContextPrompt(e.target.value)}
            aria-describedby="context-help"
          />
          <p id="context-help" className="field-hint">
            Minimum 10 characters.{' '}
            {contextPrompt.trim().length < 10 && contextPrompt.length > 0 && (
              <span className="char-warning">
                {10 - contextPrompt.trim().length} more characters needed
              </span>
            )}
          </p>
        </div>

        {/* Card format */}
        <div className="field-group">
          <p className="field-label">Card format <span className="required">*</span></p>
          <div className="radio-group">
            <label className="radio-label">
              <input
                type="radio"
                name="card-format"
                value="basic"
                checked={cardFormat === 'basic'}
                onChange={() => setCardFormat('basic')}
              />
              <span>Basic (front / back)</span>
            </label>
            <label className="radio-label">
              <input
                type="radio"
                name="card-format"
                value="cloze"
                checked={cardFormat === 'cloze'}
                onChange={() => setCardFormat('cloze')}
              />
              <span>Cloze (fill-in-the-blank)</span>
            </label>
          </div>
        </div>

        {/* Generate button */}
        {!apiKeySet && (
          <p className="api-key-warning" role="status">
            Add your Claude API key in Settings first
          </p>
        )}
        <button
          className="generate-btn"
          onClick={handleGenerate}
          disabled={!isGenerateEnabled}
          aria-disabled={!isGenerateEnabled}
        >
          Generate Flashcards
        </button>
      </main>
    </div>
  )
}
