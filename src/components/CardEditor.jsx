import React, { useEffect, useState } from 'react'
import { renderCardMarkdown } from '../lib/cardMarkdown'

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
          <MarkdownPreview source={localCard.text} label="Cloze preview" />
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
            <MarkdownPreview source={localCard.front} label="Front preview" />
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
            <MarkdownPreview source={localCard.back} label="Back preview" />
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

function MarkdownPreview ({ source, label }) {
  return (
    <div className="markdown-preview" aria-label={label}>
      <div className="markdown-preview-label">{label}</div>
      <div
        className="markdown-preview-body"
        dangerouslySetInnerHTML={{ __html: renderCardMarkdown(source, { target: 'preview' }) || '<p class="markdown-preview-empty">No preview</p>' }}
      />
    </div>
  )
}
