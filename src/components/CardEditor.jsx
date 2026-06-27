import React, { useState } from 'react'

/**
 * CardEditor — renders one flashcard with inline editing.
 *
 * Props:
 *   card        {front, back, type: 'basic'} | {text, type: 'cloze'}
 *   onUpdate    (updatedCard) => void  — called on blur after a field changes
 *   onDelete    () => void             — called when Delete button is clicked
 */
export default function CardEditor ({ card, onUpdate, onDelete }) {
  const [localCard, setLocalCard] = useState(card)

  const handleBlur = (field, value) => {
    const updated = { ...localCard, [field]: value }
    setLocalCard(updated)
    onUpdate(updated)
  }

  return (
    <div className="card-editor" data-testid="card-editor">
      <div className="card-fields">
        {card.type === 'basic' ? (
          <>
            <div className="card-field">
              <label className="card-field-label">Front</label>
              <textarea
                className="card-textarea"
                defaultValue={localCard.front}
                onBlur={(e) => handleBlur('front', e.target.value)}
                rows={3}
                aria-label="Card front"
              />
            </div>
            <div className="card-field">
              <label className="card-field-label">Back</label>
              <textarea
                className="card-textarea"
                defaultValue={localCard.back}
                onBlur={(e) => handleBlur('back', e.target.value)}
                rows={3}
                aria-label="Card back"
              />
            </div>
          </>
        ) : (
          <div className="card-field">
            <label className="card-field-label">Cloze text</label>
            <textarea
              className="card-textarea"
              defaultValue={localCard.text}
              onBlur={(e) => handleBlur('text', e.target.value)}
              rows={3}
              aria-label="Cloze text"
            />
          </div>
        )}
      </div>
      <div className="card-actions">
        <button
          className="card-delete-btn"
          onClick={onDelete}
          aria-label="Delete card"
          data-testid="delete-card-btn"
        >
          Delete
        </button>
      </div>
    </div>
  )
}
