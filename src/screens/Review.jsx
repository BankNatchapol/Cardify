import React, { useState, useCallback } from 'react'
import CardEditor from '../components/CardEditor'
import DeckNameInput from '../components/DeckNameInput'
import UndoSnackbar from '../components/UndoSnackbar'

/**
 * Review screen — shows generated flashcards with inline editing,
 * delete with undo, deck name input, and Push to Anki button.
 *
 * Props:
 *   cards     — Array<{front,back,type}|{text,type}> from generate-cards IPC
 *   fileName  — string, used to pre-populate the deck name
 *   onBack    — called to navigate back to the Upload screen
 *   onPush    — optional external handler; if omitted, uses window.ipc directly
 */
export default function Review ({ cards: initialCards, fileName, onBack, onPush }) {
  const [cards, setCards] = useState(initialCards || [])
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

  // ── Card update ──────────────────────────────────────────────────────────
  const handleUpdate = useCallback((index, updatedCard) => {
    setCards(prev => {
      const next = [...prev]
      next[index] = updatedCard
      return next
    })
  }, [])

  // ── Card delete with undo ─────────────────────────────────────────────────
  const handleDelete = useCallback((index) => {
    const deleted = cards[index]
    setCards(prev => prev.filter((_, i) => i !== index))
    setSnackbar({ card: deleted, index })
  }, [cards])

  const handleUndo = useCallback(() => {
    if (!snackbar) return
    setCards(prev => {
      const next = [...prev]
      // Restore at the original index, clamped to current length
      const insertAt = Math.min(snackbar.index, next.length)
      next.splice(insertAt, 0, snackbar.card)
      return next
    })
    setSnackbar(null)
  }, [snackbar])

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

        {renderPushBanner()}

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
        </div>
      </main>
    </div>
  )
}
