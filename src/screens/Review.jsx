import React, { useEffect, useState, useCallback } from 'react'
import CardEditor from '../components/CardEditor'
import DeckNameInput from '../components/DeckNameInput'
import UndoSnackbar from '../components/UndoSnackbar'

/**
 * Review screen — shows generated flashcards with inline editing,
 * delete with undo, deck name input, and Push to Anki button.
 *
 * Props:
 *   cards     — Array<{front,back,type}|{text,type}> from generate-cards IPC
 *   description — {title,purpose,contents}, editable generated deck overview
 *   fileName  — string, used to pre-populate the deck name
 *   onBack    — called to navigate back to the Upload screen
 *   onPush    — optional external handler; if omitted, uses window.ipc directly
 */
export default function Review ({ cards: initialCards, description: initialDescription, fileName, onBack, onPush, onProjectChange }) {
  const [cards, setCards] = useState(initialCards || [])
  const [description, setDescription] = useState(() => normalizeDescription(initialDescription, fileName))
  const [deckName, setDeckName] = useState(() => {
    if (!fileName) return ''
    // Strip extension
    return fileName.replace(/\.[^.]+$/, '')
  })

  // Snackbar state: null | { card, index }
  const [snackbar, setSnackbar] = useState(null)

  // Push-to-Anki state
  const [pushing, setPushing] = useState(false)
  const [pushResult, setPushResult] = useState(null) // null | { success, added, errors } | { error }

  // Export for Mobile state
  const [exporting, setExporting] = useState(false)
  const [exportResult, setExportResult] = useState(null) // null | { ok, filePath } | { error }
  const [cardsOpen, setCardsOpen] = useState((initialCards || []).length <= 20)

  useEffect(() => {
    const nextCards = initialCards || []
    setCards(nextCards)
    setCardsOpen(nextCards.length <= 20)
  }, [initialCards])

  useEffect(() => {
    setDescription(normalizeDescription(initialDescription, fileName))
  }, [initialDescription, fileName])

  useEffect(() => {
    setDeckName(fileName ? fileName.replace(/\.[^.]+$/, '') : '')
  }, [fileName])

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
    if (pushing || !deckName.trim()) return
    setPushResult(null)
    setPushing(true)

    try {
      let result
      if (onPush) {
        result = await onPush(deckName.trim(), cards)
      } else {
        result = await window.ipc.invoke('push-to-anki', {
          deckName: deckName.trim(),
          cards
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
      : `${pushResult.added} cards added to ${deckName}`

    return (
      <div className="push-banner push-banner--success" role="status" data-testid="push-success-banner">
        {duplicateCount > 0 ? msg : `✓ ${msg}`}
      </div>
    )
  }

  return (
    <div className="review-screen">
      <header className="review-header">
        <button
          type="button"
          className="back-btn"
          onClick={onBack}
          aria-label="Back to Upload"
        >
          Back to Upload
        </button>
        <h1>Review Cards</h1>
        <span className="card-count" data-testid="card-count">
          {cards.length} {cards.length === 1 ? 'card' : 'cards'}
        </span>
      </header>

      <main className="review-main">
        <DeckNameInput value={deckName} onChange={setDeckName} />

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

          <div className="card-list">
            {cards.map((card, index) => (
              <CardEditor
                key={index}
                card={card}
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
            disabled={pushing || !deckName.trim()}
            aria-disabled={pushing || !deckName.trim()}
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
                  deckName: deckName.trim() || description.title || 'Untitled',
                  description,
                  cards
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
