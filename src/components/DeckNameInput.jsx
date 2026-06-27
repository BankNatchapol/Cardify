import React from 'react'

/**
 * DeckNameInput — controlled input for the Anki deck name.
 *
 * Props:
 *   value     — current deck name string
 *   onChange  — called with the new value string
 */
export default function DeckNameInput ({ value, onChange }) {
  const handleBlur = (e) => {
    const trimmed = e.target.value.trim()
    if (trimmed !== e.target.value) {
      onChange(trimmed)
    }
  }

  return (
    <div className="deck-name-input field-group">
      <label htmlFor="deck-name" className="field-label">
        Deck name <span className="required">*</span>
      </label>
      <input
        id="deck-name"
        type="text"
        className="deck-name-field"
        value={value}
        onChange={e => onChange(e.target.value)}
        onBlur={handleBlur}
        placeholder="Enter deck name"
        aria-required="true"
      />
    </div>
  )
}
