import React, { useEffect, useState, useCallback } from 'react'
import CardEditor from '../components/CardEditor'
import UndoSnackbar from '../components/UndoSnackbar'
import ProgressBar from '../components/ProgressBar'
import StatusTile from '../components/StatusTile'
import { defaultAudioManifestCandidates } from '../lib/audioManifestPaths'

function cardsContainAudioTags (cards = []) {
  return cards.some(card => /\{\{audio:[A-Za-z0-9_-]+\}\}/.test(
    card?.type === 'cloze'
      ? String(card.text || '')
      : `${card?.front || ''}\n${card?.back || ''}`
  ))
}

function countLoadedAudioTargets (manifest) {
  return Array.isArray(manifest?.targets)
    ? manifest.targets.filter(target => target.status === 'success').length
    : 0
}

/**
 * Review screen — shows generated flashcards with inline editing,
 * delete with undo, deck overview editing, and Push to Anki button.
 *
 * Props:
 *   cards     — Array<{front,back,type}|{text,type}> from generate-cards IPC
 *   description — {title,purpose,contents}, editable generated deck overview
 *   fileName  — string, used as a fallback title
 *   onBack    — called to navigate back to the project list
 *   onPush    — optional external handler; if omitted, uses window.ipc directly
 */
export default function Review ({
  cards: initialCards,
  description: initialDescription,
  fileName,
  sourceFilePath,
  onBack,
  onPush,
  onProjectChange,
  generationProgress,
  continuingGeneration = false,
  onContinueGeneration,
  onStopGeneration
}) {
  const [cards, setCards] = useState(initialCards || [])
  const [description, setDescription] = useState(() => normalizeDescription(initialDescription, fileName))

  // Snackbar state: null | { card, index }
  const [snackbar, setSnackbar] = useState(null)

  // Push-to-Anki state
  const [pushing, setPushing] = useState(false)
  const [pushResult, setPushResult] = useState(null) // null | { success, added, errors } | { error }

  // Export for Mobile state
  const [exporting, setExporting] = useState(false)
  const [exportResult, setExportResult] = useState(null) // null | { ok, filePath } | { error }
  const [cardsOpen, setCardsOpen] = useState((initialCards || []).length <= 20)
  const [audioManifest, setAudioManifest] = useState(null)
  const [audioManifestResult, setAudioManifestResult] = useState(null)

  useEffect(() => {
    const nextCards = initialCards || []
    setCards(nextCards)
    setCardsOpen(nextCards.length <= 20)
  }, [initialCards])

  useEffect(() => {
    setDescription(normalizeDescription(initialDescription, fileName))
  }, [initialDescription, fileName])

  useEffect(() => {
    let cancelled = false
    setAudioManifest(null)
    setAudioManifestResult(null)

    if (!sourceFilePath || !cardsContainAudioTags(initialCards || [])) return () => { cancelled = true }

    const candidates = defaultAudioManifestCandidates(sourceFilePath)
    if (candidates.length === 0) return () => { cancelled = true }

    ;(async () => {
      for (const manifestPath of candidates) {
        try {
          const result = await window.ipc.invoke('load-audio-manifest', { path: manifestPath })
          if (cancelled || result?.canceled) return
          const count = countLoadedAudioTargets(result)
          if (count > 0) {
            setAudioManifest(result)
            setAudioManifestResult({ success: true, count, path: result.manifestPath, automatic: true })
            return
          }
        } catch {
          // Missing neighboring manifests are normal; the manual loader remains available.
        }
      }
    })()

    return () => { cancelled = true }
  }, [sourceFilePath])

  const saveDescription = useCallback((nextDescription) => {
    const normalized = normalizeDescription(nextDescription, fileName)
    setDescription(normalized)
    if (onProjectChange) onProjectChange({ cards, fileName, description: normalized })
  }, [cards, fileName, onProjectChange])

  // ── Card update ──────────────────────────────────────────────────────────
  const handleUpdate = useCallback((index, updatedCard) => {
    setCards(prev => {
      const next = [...prev]
      next[index] = updatedCard
      if (onProjectChange) onProjectChange({ cards: next, fileName })
      return next
    })
  }, [fileName, onProjectChange])

  // ── Card delete with undo ─────────────────────────────────────────────────
  const handleDelete = useCallback((index) => {
    const deleted = cards[index]
    const next = cards.filter((_, i) => i !== index)
    setCards(next)
    if (onProjectChange) onProjectChange({ cards: next, fileName })
    setSnackbar({ card: deleted, index })
  }, [cards, fileName, onProjectChange])

  const handleUndo = useCallback(() => {
    if (!snackbar) return
    setCards(prev => {
      const next = [...prev]
      // Restore at the original index, clamped to current length
      const insertAt = Math.min(snackbar.index, next.length)
      next.splice(insertAt, 0, snackbar.card)
      if (onProjectChange) onProjectChange({ cards: next, fileName })
      return next
    })
    setSnackbar(null)
  }, [fileName, onProjectChange, snackbar])

  const handleSnackbarDismiss = useCallback(() => {
    setSnackbar(null)
  }, [])

  // ── Push to Anki ─────────────────────────────────────────────────────────
  const handlePush = async () => {
    const title = description.title.trim()
    if (pushing || !title) return
    setPushResult(null)
    setPushing(true)

    try {
      let result
      if (onPush) {
        result = await onPush(title, cards, { audioManifest })
      } else {
        result = await window.ipc.invoke('push-to-anki', {
          deckName: title,
          cards,
          audioManifest
        })
      }

      if (result && result.error === 'anki-not-running') {
        setPushResult({ error: 'anki-not-running' })
      } else if (result && result.success) {
        setPushResult({ success: true, added: result.added, errors: result.errors || [] })
      } else {
        setPushResult({ error: 'unknown' })
      }
    } catch (err) {
      setPushResult({ error: 'unknown', message: err.message })
    } finally {
      setPushing(false)
    }
  }

  const handleLoadAudioManifest = useCallback(async () => {
    setAudioManifestResult(null)
    try {
      const result = await window.ipc.invoke('load-audio-manifest')
      if (result?.canceled) return
      setAudioManifest(result)
      const count = countLoadedAudioTargets(result)
      setAudioManifestResult({ success: true, count, path: result.manifestPath })
    } catch (err) {
      setAudioManifestResult({ error: err.message })
    }
  }, [])

  // ── Render helpers ────────────────────────────────────────────────────────
  const renderPushBanner = () => {
    if (!pushResult) return null

    if (pushResult.error === 'anki-not-running') {
      return (
        <div className="push-banner push-banner--error" role="alert" data-testid="anki-error-banner">
          Anki isn&apos;t running. Open Anki and make sure the AnkiConnect plugin is installed, then try again.
        </div>
      )
    }

    if (pushResult.error) {
      return (
        <div className="push-banner push-banner--error" role="alert" data-testid="push-error-banner">
          Failed to push cards. Please try again.
        </div>
      )
    }

    const duplicateCount = (pushResult.errors || []).filter(e => e.startsWith('duplicate:')).length
    const msg = duplicateCount > 0
      ? `${pushResult.added} cards added, ${duplicateCount} duplicates skipped`
      : `${pushResult.added} cards added to ${description.title.trim()}`

    return (
      <div className="push-banner push-banner--success" role="status" data-testid="push-success-banner">
        {duplicateCount > 0 ? msg : `✓ ${msg}`}
      </div>
    )
  }

  const renderGenerationPanel = () => {
    if (!generationProgress || generationProgress.status === 'done') return null

    const canContinue = ['failed', 'stopped', 'capped', 'shortfall'].includes(generationProgress.status)
    const completedBatches = generationProgress.completedBatches ?? 0
    const batchSize = generationProgress.batchSize || 10
    const maxBatches = generationProgress.maxBatches || 20
    const generationLimit = batchSize * maxBatches
    const targetCardCount = generationProgress.generationGoal?.targetCardCount || null
    const status = continuingGeneration ? 'in_progress' : (generationProgress.status || 'idle')
    const latestCoverage = Array.isArray(generationProgress.coverageHistory)
      ? generationProgress.coverageHistory.at(-1)
      : null

    return (
      <section className="project-generation-panel" aria-label="Project generation status">
        <div className="project-generation-content">
          <h2>Generation</h2>

          <ProgressBar value={maxBatches ? (100 * completedBatches / maxBatches) : null} />
          <div className="iterative-progress-grid project-generation-grid">
            <div>
              <span className="iterative-label">{targetCardCount ? 'Target cards' : 'Cards'}</span>
              <strong>{targetCardCount ? `${cards.length} / ${targetCardCount}` : cards.length}</strong>
            </div>
            <div>
              <span className="iterative-label">Batch</span>
              <strong>{completedBatches} / {maxBatches}</strong>
            </div>
            <div>
              <span className="iterative-label">Limit</span>
              <strong>{generationLimit}</strong>
            </div>
            <StatusTile status={status} />
          </div>

          {latestCoverage?.batchSummary && (
            <p className="iterative-summary project-generation-summary">{latestCoverage.batchSummary}</p>
          )}
          {latestCoverage?.remainingFocus && (
            <p className="project-generation-focus">
              Remaining focus: {latestCoverage.remainingFocus}
            </p>
          )}
        </div>
        <div className="project-generation-actions">
          {continuingGeneration && (
            <button
              type="button"
              className="secondary-btn project-generation-btn"
              onClick={onStopGeneration}
            >
              Stop and Review
            </button>
          )}
          {canContinue && !continuingGeneration && (
            <button
              type="button"
              className="primary-btn project-generation-btn"
              onClick={onContinueGeneration}
            >
              Continue Generation
            </button>
          )}
        </div>
      </section>
    )
  }

  return (
    <div className="review-screen">
      <header className="review-header">
        <button
          type="button"
          className="back-btn"
          onClick={onBack}
          aria-label="Back to Projects"
        >
          Back
        </button>
        <h1>Review Cards</h1>
        <span className="card-count" data-testid="card-count">
          {cards.length} {cards.length === 1 ? 'card' : 'cards'}
        </span>
      </header>

      <main className="review-main">
        {renderGenerationPanel()}

        <section className="deck-overview" aria-label="Deck overview">
          <div className="deck-overview-heading">
            <div>
              <h2>Deck overview</h2>
              <p>Generated project description saved with these cards.</p>
            </div>
          </div>

          <div className="overview-grid">
            <label className="card-field">
              <span className="field-label">Title</span>
              <input
                className="deck-name-field"
                value={description.title}
                onChange={(e) => setDescription(prev => ({ ...prev, title: e.target.value }))}
                onBlur={() => saveDescription(description)}
                aria-label="Deck overview title"
              />
            </label>
            <label className="card-field">
              <span className="field-label">Purpose</span>
              <textarea
                className="card-textarea"
                value={description.purpose}
                onChange={(e) => setDescription(prev => ({ ...prev, purpose: e.target.value }))}
                onBlur={() => saveDescription(description)}
                rows={2}
                aria-label="Deck overview purpose"
              />
            </label>
            <label className="card-field">
              <span className="field-label">Contents</span>
              <textarea
                className="card-textarea"
                value={description.contents.join('\n')}
                onChange={(e) => setDescription(prev => ({
                  ...prev,
                  contents: e.target.value.split('\n')
                }))}
                onBlur={() => saveDescription(description)}
                rows={3}
                aria-label="Deck overview contents"
              />
            </label>
          </div>
        </section>

        {renderPushBanner()}

        <details
          className="review-card-section"
          open={cardsOpen}
          onToggle={(e) => setCardsOpen(e.currentTarget.open)}
        >
          <summary className="review-card-section-summary">
            <span className="review-card-section-title">Generated cards</span>
            <span className="review-card-section-meta">
              {cards.length} {cards.length === 1 ? 'card' : 'cards'}
            </span>
          </summary>

          <div className="audio-manifest-toolbar">
            <button
              type="button"
              className="secondary-btn"
              onClick={handleLoadAudioManifest}
            >
              Load Audio Manifest
            </button>
            {audioManifestResult?.success && (
              <span className="audio-manifest-status">
                {audioManifestResult.count} audio clips loaded{audioManifestResult.automatic ? ' automatically' : ''}
              </span>
            )}
            {audioManifestResult?.error && (
              <span className="audio-manifest-status audio-manifest-status--error">
                Audio manifest failed: {audioManifestResult.error}
              </span>
            )}
          </div>

          <div className="card-list">
            {cards.map((card, index) => (
              <CardEditor
                key={index}
                card={card}
                cardIndex={index}
                audioManifest={audioManifest}
                onUpdate={(updated) => handleUpdate(index, updated)}
                onDelete={() => handleDelete(index)}
              />
            ))}
          </div>
        </details>

        {snackbar && (
          <UndoSnackbar
            onUndo={handleUndo}
            onDismiss={handleSnackbarDismiss}
          />
        )}

        <div className="review-actions">
          <button
            type="button"
            className={`push-btn${pushing ? ' loading' : ''}`}
            onClick={handlePush}
            disabled={pushing || !description.title.trim()}
            aria-disabled={pushing || !description.title.trim()}
            aria-busy={pushing}
            data-testid="push-to-anki-btn"
          >
            {pushing
              ? <><span className="spinner" aria-hidden="true" /> Pushing to Anki...</>
              : 'Push to Anki'
            }
          </button>
          <button
            type="button"
            className={`push-btn push-btn--secondary${exporting ? ' loading' : ''}`}
            onClick={async () => {
              setExporting(true)
              setExportResult(null)
              try {
                const result = await window.ipc.invoke('export-mobile-package', {
                  deckName: description.title.trim() || 'Untitled',
                  description,
                  cards,
                  audioManifest
                })
                setExportResult(result)
              } catch (err) {
                setExportResult({ error: err.message })
              } finally {
                setExporting(false)
              }
            }}
            disabled={exporting || cards.length === 0}
            aria-busy={exporting}
          >
            {exporting ? <><span className="spinner" aria-hidden="true" /> Exporting...</> : 'Export for Mobile'}
          </button>
        </div>
        {exportResult?.ok && (
          <p className="push-banner push-banner--success" role="status">
            Saved to {exportResult.filePath} — import this file in the Cardify mobile app.
          </p>
        )}
        {exportResult?.error && (
          <p className="push-banner push-banner--error" role="alert">
            Export failed: {exportResult.error}
          </p>
        )}
      </main>
    </div>
  )
}

function normalizeDescription (description, fallbackTitle = '') {
  if (!description || typeof description !== 'object' || Array.isArray(description)) {
    return {
      title: fallbackTitle ? fallbackTitle.replace(/\.[^.]+$/, '') : '',
      purpose: '',
      contents: []
    }
  }

  return {
    title: String(description.title || fallbackTitle || '').replace(/\.[^.]+$/, ''),
    purpose: String(description.purpose || ''),
    contents: Array.isArray(description.contents)
      ? description.contents.map(item => String(item || '').trim()).filter(Boolean)
      : []
  }
}
