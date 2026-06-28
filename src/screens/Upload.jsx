import React, { useState, useRef, useCallback } from 'react'

const ALLOWED_EXTENSIONS = ['.pdf', '.txt']

function getExtension (filePath) {
  const parts = filePath.split('.')
  return parts.length > 1 ? '.' + parts[parts.length - 1].toLowerCase() : ''
}

export default function Upload ({
  initialState = {},
  onComplete,
  onOpenSettings,
  onOpenProjects,
  onOpenReview,
  onStateChange,
  onGenerate,
  generationState = {},
  generatedCardCount = 0,
  generatedCards = [],
  description = {},
  apiKeySet = false
}) {
  const [fileError, setFileError] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const [activityOpen, setActivityOpen] = useState(false)

  const fileInputRef = useRef(null)
  const filePath = initialState.filePath || null
  const fileName = initialState.fileName || ''
  const contextPrompt = initialState.contextPrompt || ''
  const cardFormat = initialState.cardFormat || 'basic'
  const generating = Boolean(generationState.generating)
  const generateError = generationState.error

  const updateUploadState = useCallback((patch) => {
    if (onStateChange) onStateChange(patch)
  }, [onStateChange])

  const isGenerateEnabled =
    filePath !== null &&
    contextPrompt.trim().length >= 10 &&
    cardFormat !== null &&
    apiKeySet &&
    !generating

  const handleFile = useCallback((p, name) => {
    const ext = getExtension(p)
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      setFileError(`File type "${ext}" is not supported. Please select a .pdf or .txt file.`)
      updateUploadState({ filePath: null, fileName: '' })
      return
    }
    setFileError(null)
    updateUploadState({ filePath: p, fileName: name })
  }, [updateUploadState])

  const handleFileInputChange = (e) => {
    const file = e.target.files[0]
    if (file) handleFile(file.path, file.name)
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file.path, file.name)
  }

  const handleDragOver = (e) => {
    e.preventDefault()
    setDragOver(true)
  }

  const handleDragLeave = () => setDragOver(false)

  /**
   * Generate button handler:
   * 1. Show loading spinner.
   * 2. Ask App.jsx to run generate-cards so progress survives navigation.
   */
  const handleGenerate = async () => {
    if (!isGenerateEnabled) return
    setActivityOpen(true)
    if (onGenerate) {
      await onGenerate({ filePath, fileName, parsedText, contextPrompt, cardFormat })
    } else if (onComplete) {
      onComplete({ filePath, fileName, parsedText, contextPrompt, cardFormat, cards: [] })
    }
  }

  return (
    <div className="upload-screen">
      <header className="upload-header">
        <button
          type="button"
          className="settings-btn"
          onClick={onOpenSettings || onOpenProjects}
          aria-label="Open Settings"
          title="Settings"
        >
          Settings
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
          {filePath ? (
            <div className="file-info">
              <p className="file-name">{fileName}</p>
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
            onChange={(e) => updateUploadState({ contextPrompt: e.target.value })}
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
                onChange={() => updateUploadState({ cardFormat: 'basic' })}
              />
              <span>Basic (front / back)</span>
            </label>
            <label className="radio-label">
              <input
                type="radio"
                name="card-format"
                value="cloze"
                checked={cardFormat === 'cloze'}
                onChange={() => updateUploadState({ cardFormat: 'cloze' })}
              />
              <span>Cloze (fill-in-the-blank)</span>
            </label>
          </div>
        </div>

        {/* Generate error banner */}
        {generateError && (
          <p className="error-message" role="alert" data-testid="generate-error">
            {generateError}
          </p>
        )}

        {generatedCardCount > 0 && !generating && (
          <section className="review-ready-panel" aria-label="Generated cards">
            <div className="review-ready-banner" role="status">
              <span>
                {generatedCardCount} {generatedCardCount === 1 ? 'card is' : 'cards are'} ready for review
              </span>
              <button type="button" className="secondary-btn" onClick={onOpenReview}>
                Review Cards
              </button>
            </div>
            {(description.title || description.purpose || (description.contents || []).length > 0) && (
              <div className="deck-overview deck-overview--compact">
                {description.title && <h2>{description.title}</h2>}
                {description.purpose && <p>{description.purpose}</p>}
                {(description.contents || []).length > 0 && (
                  <div className="overview-topic-list" aria-label="Deck contents">
                    {description.contents.map((item, index) => (
                      <span className="overview-topic" key={`${item}-${index}`}>{item}</span>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className="generated-card-preview-list">
              {generatedCards.map((card, index) => (
                <button
                  type="button"
                  className="generated-card-preview"
                  key={index}
                  onClick={onOpenReview}
                >
                  <span className="generated-card-index">{index + 1}</span>
                  <span className="generated-card-content">
                    {card.type === 'cloze'
                      ? card.text
                      : card.front
                    }
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}

        {(generating || generationState.stage || (generationState.logs || []).length > 0) && (
          <details
            className="generation-activity"
            open={activityOpen || generating}
            onToggle={(e) => setActivityOpen(e.currentTarget.open)}
          >
            <summary>
              <span className={generating ? 'activity-dot activity-dot--running' : 'activity-dot'} aria-hidden="true" />
              <span>{generationState.stage || (generating ? 'Starting generation' : 'Generation activity')}</span>
            </summary>
            <ol className="activity-log">
              {(generationState.logs || []).map((log, index) => (
                <li key={`${log}-${index}`}>{log}</li>
              ))}
            </ol>
          </details>
        )}

        {/* API key warning */}
        {/* Legacy copy: Add your Claude API key in Settings first */}
        {!apiKeySet && (
          <p className="api-key-warning" role="status">
            Sign in to Claude Code in Terminal or add a Claude API key in Settings first
          </p>
        )}

        {/* Generate button */}
        <button
          className={`generate-btn${generating ? ' loading' : ''}`}
          onClick={handleGenerate}
          disabled={!isGenerateEnabled}
          aria-disabled={!isGenerateEnabled}
          aria-busy={generating}
        >
          {generating
            ? <><span className="spinner" aria-hidden="true" /> Generating...</>
            : 'Generate Flashcards'
          }
        </button>
      </main>
    </div>
  )
}
