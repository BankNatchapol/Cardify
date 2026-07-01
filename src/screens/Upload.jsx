import React, { useState, useRef, useCallback, useEffect } from 'react'
import CardEditor from '../components/CardEditor'
import ProgressBar from '../components/ProgressBar'
import StatusTile from '../components/StatusTile'

const ALLOWED_EXTENSIONS = ['.pdf', '.txt']

function getExtension (filePath) {
  const parts = filePath.split('.')
  return parts.length > 1 ? '.' + parts[parts.length - 1].toLowerCase() : ''
}

function stopWizardUndoShortcut (event) {
  const key = String(event.key || '').toLowerCase()
  if ((event.metaKey || event.ctrlKey) && key === 'z') {
    event.stopPropagation()
  }
}

function stopWizardHistoryUndo (event) {
  if (event.nativeEvent?.inputType === 'historyUndo' || event.inputType === 'historyUndo') {
    event.stopPropagation()
  }
}

function escapeInlineHtml (value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderInlineQuestionMarkdown (source) {
  return escapeInlineHtml(source)
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_\n]+)__/g, '<strong>$1</strong>')
    .replace(/(^|[^\w])_([^_\n]+)_/g, '$1<em>$2</em>')
    .replace(/(^|[^\w])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/\n/g, '<br>')
}

function MarkdownQuestionLabel ({ question }) {
  return (
    <span
      className="field-label"
      dangerouslySetInnerHTML={{ __html: renderInlineQuestionMarkdown(question) }}
    />
  )
}

export default function Upload ({
  initialState = {},
  onComplete,
  onOpenProjects,
  onOpenReview,
  onStateChange,
  onGenerate,
  generationState = {},
  wizardState = {},
  generatedCardCount = 0,
  generatedCards = [],
  description = {},
  apiKeySet = false,
  onClarificationAnswerChange,
  onSubmitClarification,
  onSampleCardUpdate,
  onSampleCardDelete,
  onSampleFeedbackChange,
  onRegenerateSamples,
  onAcceptSamples,
  onContinueGeneration,
  onStopIterativeGeneration,
  onCancelGeneration,
  onReviewPartialDeck
}) {
  const [fileError, setFileError] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const [activityOpen, setActivityOpen] = useState(false)

  const fileInputRef = useRef(null)
  const regenerateStartedRef = useRef(false)
  const sampleReviewRef = useRef(null)
  const previousSampleSignatureRef = useRef('')
  const filePath = initialState.filePath || null
  const fileName = initialState.fileName || ''
  const parsedText = initialState.parsedText || null
  const contextPrompt = initialState.contextPrompt || ''
  const cardFormat = initialState.cardFormat || 'basic'
  const generating = Boolean(generationState.generating)
  const generateError = generationState.error
  const wizardStep = wizardState.step || 'idle'
  const progress = wizardState.generationProgress || null
  const progressStatus = progress?.status || ''
  const canContinue = progress?.mode === 'iterative' && ['failed', 'stopped', 'capped'].includes(progressStatus) && !generating

  useEffect(() => {
    const sampleCards = wizardState.sampleCards || []
    const sampleSignature = JSON.stringify(sampleCards.map(card => (
      card?.type === 'cloze'
        ? { type: card.type, text: card.text || '' }
        : { type: card?.type || 'basic', front: card?.front || '', back: card?.back || '' }
    )))
    const previousSignature = previousSampleSignatureRef.current
    previousSampleSignatureRef.current = sampleSignature

    if (
      wizardStep === 'sample_review' &&
      !generating &&
      sampleCards.length > 0 &&
      previousSignature &&
      previousSignature !== sampleSignature
    ) {
      requestAnimationFrame(() => {
        sampleReviewRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
      })
    }
  }, [generating, wizardState.sampleCards, wizardStep])

  const updateUploadState = useCallback((patch) => {
    if (onStateChange) onStateChange(patch)
  }, [onStateChange])

  const isGenerateEnabled =
    (filePath !== null || parsedText !== null || generatedCardCount > 0) &&
    contextPrompt.trim().length >= 10 &&
    cardFormat !== null &&
    apiKeySet &&
    !generating &&
    wizardStep === 'idle'

  const handleFile = useCallback((p, name) => {
    const ext = getExtension(p)
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      setFileError(`File type "${ext}" is not supported. Please select a .pdf or .txt file.`)
      updateUploadState({ filePath: null, fileName: '' })
      return
    }
    setFileError(null)
    updateUploadState({ filePath: p, fileName: name, parsedText: null, charCount: null })
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
   * 2. Ask App.jsx to run the guided clarify/sample flow.
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

  const handleRegenerateSamples = useCallback(() => {
    if (generating || (wizardState.sampleCards || []).length === 0) return
    if (regenerateStartedRef.current) return
    regenerateStartedRef.current = true
    Promise.resolve(onRegenerateSamples?.({ filePath, fileName, parsedText, contextPrompt, cardFormat }))
      .finally(() => {
        regenerateStartedRef.current = false
      })
  }, [cardFormat, contextPrompt, fileName, filePath, generating, onRegenerateSamples, parsedText, wizardState.sampleCards])

  return (
    <div className="upload-screen">
      <header className="upload-header">
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

        {wizardStep !== 'idle' && (
          <section className="generation-wizard" aria-label="Guided generation">
            <div className="wizard-heading">
              <div>
                <h2>Guided generation</h2>
                <p>Cardify clarifies the target, shows samples, then builds the full deck after approval.</p>
              </div>
              <span className="wizard-step">{wizardStep.replace('_', ' ')}</span>
            </div>

            {wizardStep === 'clarifying' && (wizardState.clarificationQuestions || []).length > 0 && (
              <div className="wizard-section">
                <h3>Clarify the deck</h3>
                {(wizardState.clarificationQuestions || []).map((question, index) => (
                  <label className="card-field" key={`${question}-${index}`}>
                    <MarkdownQuestionLabel question={question} />
                    <textarea
                      className="card-textarea"
                      rows={2}
                      value={wizardState.clarificationAnswers?.[index] || ''}
                      onKeyDown={stopWizardUndoShortcut}
                      onBeforeInput={stopWizardHistoryUndo}
                      onChange={(e) => onClarificationAnswerChange?.(index, e.target.value)}
                    />
                  </label>
                ))}
                <button
                  type="button"
                  className="secondary-btn"
                  disabled={generating}
                  onClick={() => onSubmitClarification?.({ filePath, fileName, parsedText, contextPrompt, cardFormat })}
                >
                  Continue to Samples
                </button>
              </div>
            )}

            {wizardStep === 'sampling' && (
              <div className="wizard-section">
                <h3>Generating sample cards</h3>
              </div>
            )}

            {wizardStep === 'generating_full' && (
              <div className="wizard-section iterative-progress">
                <h3>Generating full deck</h3>
                <ProgressBar
                  value={progress?.maxBatches ? (100 * (progress.completedBatches || 0) / progress.maxBatches) : null}
                />
                <div className="iterative-progress-grid">
                  <div>
                    <span className="iterative-label">Cards</span>
                    <strong>{generatedCardCount}</strong>
                  </div>
                  <div>
                    <span className="iterative-label">Batch</span>
                    <strong>{progress?.completedBatches || 0} / {progress?.maxBatches || 20}</strong>
                  </div>
                  <div>
                    <span className="iterative-label">Max cards</span>
                    <strong>{(progress?.batchSize || 10) * (progress?.maxBatches || 20)}</strong>
                  </div>
                  <StatusTile status={progressStatus || (generating ? 'in_progress' : 'idle')} />
                </div>
                {wizardState.latestCoverage?.batchSummary && (
                  <p className="iterative-summary">{wizardState.latestCoverage.batchSummary}</p>
                )}
                <div className="wizard-actions">
                  {generating && (
                    <button
                      type="button"
                      className="secondary-btn"
                      onClick={onStopIterativeGeneration}
                    >
                      Stop and Review
                    </button>
                  )}
                  {canContinue && (
                    <button
                      type="button"
                      className="generate-btn generate-btn--compact"
                      onClick={() => onContinueGeneration?.({ filePath, fileName, parsedText, contextPrompt, cardFormat })}
                    >
                      Continue Generation
                    </button>
                  )}
                  {(canContinue || generatedCardCount > 0) && !generating && (
                    <button
                      type="button"
                      className="secondary-btn"
                      onClick={onReviewPartialDeck}
                    >
                      Review Partial Deck
                    </button>
                  )}
                </div>
              </div>
            )}

            {wizardStep === 'sample_review' && (
              <div className="wizard-section" ref={sampleReviewRef}>
                <h3>{generating ? 'Regenerating sample cards' : 'Review 3 sample cards'}</h3>
                <p className="field-hint">Edit these examples or add feedback. Regenerating keeps edited samples as guidance.</p>
                <div className="sample-card-list">
                  {(wizardState.sampleCards || []).map((card, index) => (
                    <CardEditor
                      key={index}
                      card={card}
                      onUpdate={(updated) => onSampleCardUpdate?.(index, updated)}
                      onDelete={() => onSampleCardDelete?.(index)}
                    />
                  ))}
                </div>
                <label className="card-field">
                  <span className="field-label">Feedback for the next generation</span>
                  <textarea
                    className="context-textarea"
                    rows={3}
                    value={wizardState.sampleFeedback || ''}
                    onKeyDown={stopWizardUndoShortcut}
                    onBeforeInput={stopWizardHistoryUndo}
                    onChange={(e) => onSampleFeedbackChange?.(e.target.value)}
                    placeholder="Example: make backs shorter, highlight target words in examples, avoid overly easy cards"
                  />
                </label>
                <div className="wizard-actions">
                  <button
                    type="button"
                    className="secondary-btn"
                    disabled={generating || (wizardState.sampleCards || []).length === 0}
                    onPointerDown={(event) => {
                      event.preventDefault()
                      handleRegenerateSamples()
                    }}
                    onClick={handleRegenerateSamples}
                  >
                    {generating ? 'Regenerating...' : 'Regenerate Samples'}
                  </button>
                  <button
                    type="button"
                    className="generate-btn generate-btn--compact"
                    disabled={generating || (wizardState.sampleCards || []).length === 0}
                    onClick={() => onAcceptSamples?.({ filePath, fileName, parsedText, contextPrompt, cardFormat })}
                  >
                    Accept & Generate Full Deck
                  </button>
                </div>
              </div>
            )}
          </section>
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
          onClick={generating ? onCancelGeneration : handleGenerate}
          disabled={!generating && !isGenerateEnabled}
          aria-disabled={!generating && !isGenerateEnabled}
          aria-busy={generating}
        >
          {generating
            ? <><span className="spinner" aria-hidden="true" /> Cancel Generation</>
            : 'Start Guided Generation'
          }
        </button>
      </main>
    </div>
  )
}
