import React, { useEffect, useState } from 'react'

/**
 * CardEditor — renders one flashcard with inline editing and delete.
 *
 * Props:
 *   card      — { type: 'basic', front, back } | { type: 'cloze', text }
 *   onUpdate(updatedCard) — called on blur with the new card value
 *   onDelete()           — called when the Delete button is clicked
 */
export default function CardEditor ({ card, onUpdate, onDelete }) {
  const [localCard, setLocalCard] = useState({ ...card })

  useEffect(() => {
    setLocalCard({ ...card })
  }, [card])

  const handleBlur = () => {
    onUpdate(localCard)
  }

  const handleChange = (field, value) => {
    setLocalCard(prev => ({ ...prev, [field]: value }))
  }

  return (
    <div className="card-editor" data-testid="card-editor">
      {card.type === 'cloze' ? (
        <div className="card-field">
          <label className="field-label">Cloze text</label>
          <textarea
            className="card-textarea"
            value={localCard.text ?? ''}
            onChange={e => handleChange('text', e.target.value)}
            onBlur={handleBlur}
            rows={3}
            aria-label="Cloze text"
          />
        </div>
      ) : (
        <>
          <div className="card-field">
            <label className="field-label">Front</label>
            <textarea
              className="card-textarea"
              value={localCard.front ?? ''}
              onChange={e => handleChange('front', e.target.value)}
              onBlur={handleBlur}
              rows={2}
              aria-label="Card front"
            />
          </div>
          <div className="card-field">
            <label className="field-label">Back</label>
            <textarea
              className="card-textarea"
              value={localCard.back ?? ''}
              onChange={e => handleChange('back', e.target.value)}
              onBlur={handleBlur}
              rows={2}
              aria-label="Card back"
            />
          </div>
        </>
      )}
      <button
        type="button"
        className="delete-btn"
        onClick={onDelete}
        aria-label="Delete card"
      >
        Delete
      </button>
    </div>
  )
}
