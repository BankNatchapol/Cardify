import React, { useState, useCallback } from 'react'
import CardEditor from '../components/CardEditor'
import DeckNameInput from '../components/DeckNameInput'
import UndoSnackbar from '../components/UndoSnackbar'

/**
 * Review screen — shows the generated flashcard list with inline editing,
 * per-card delete with undo snackbar, deck name input, and Push to Anki button.
 *
 * Props:
 *   cards      Array<{front,back,type}|{text,type}>  — initial generated cards
 *   fileName   string  — uploaded filename (without extension becomes deck name default)
 *   onBack     () => void   — navigate back to Upload without data loss
 *   onPush     (deckName, cards) => void   — confirmed push (wired up in Task 5)
 */
export default function Review ({ cards: initialCards, fileName, onBack, onPush }) {
  // Strip extension from filename for the default deck name
  const defaultDeckName = fileName
    ? fileName.replace(/\.[^.]+$/, '')
    : ''

  const [cards, setCards] = useState(initialCards || [])
  const [deckName, setDeckName] = useState(defaultDeckName)
  const [deletedCard, setDeletedCard] = useState(null) // { card, index } for undo

  const handleUpdate = useCallback((index, updatedCard) => {
    setCards(prev => {
      const next = [...prev]
      next[index] = updatedCard
      return next
    })
  }, [])

  const handleDelete = useCallback((index) => {
    setCards(prev => {
      const card = prev[index]
      setDeletedCard({ card, index })
      return prev.filter((_, i) => i !== index)
    })
  }, [])

  const handleUndo = useCallback(() => {
    if (!deletedCard) return
    setCards(prev => {
      const next = [...prev]
      next.splice(deletedCard.index, 0, deletedCard.card)
      return next
    })
    setDeletedCard(null)
  }, [deletedCard])

  const handleSnackbarDismiss = useCallback(() => {
    setDeletedCard(null)
  }, [])

  const isPushDisabled = deckName.trim().length === 0

  const handlePush = () => {
    if (isPushDisabled) return
    if (onPush) onPush(deckName.trim(), cards)
  }

  return (
    <div className="review-screen">
      <header className="review-header">
        <div className="review-header-top">
          <button
            className="back-btn"
            onClick={onBack}
            aria-label="Back to Upload"
          >
            ← Back to Upload
          </button>
          <h1>Review Cards</h1>
        </div>
        <p className="review-card-count" data-testid="card-count">
          {cards.length} {cards.length === 1 ? 'card' : 'cards'}
        </p>
      </header>

      <main className="review-main">
        <DeckNameInput
          value={deckName}
          onChange={setDeckName}
        />

        <div className="card-list" data-testid="card-list">
          {cards.length === 0 ? (
            <p className="no-cards-message">
              All cards deleted. Go back to regenerate or push an empty deck.
            </p>
          ) : (
            cards.map((card, index) => (
              <CardEditor
                key={`${index}-${card.type}`}
                card={card}
                onUpdate={(updated) => handleUpdate(index, updated)}
                onDelete={() => handleDelete(index)}
              />
            ))
          )}
        </div>

        <button
          className="push-btn"
          onClick={handlePush}
          disabled={isPushDisabled}
          aria-disabled={isPushDisabled}
          data-testid="push-to-anki-btn"
        >
          Push to Anki
        </button>
      </main>

      {deletedCard && (
        <UndoSnackbar
          onUndo={handleUndo}
          onDismiss={handleSnackbarDismiss}
        />
      )}
    </div>
  )
}
