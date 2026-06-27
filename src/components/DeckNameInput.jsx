import React from 'react'

/**
 * DeckNameInput — controlled input for the Anki deck name.
 *
 * Props:
 *   value     string   — current deck name value
 *   onChange  (str) => void
 */
export default function DeckNameInput ({ value, onChange }) {
  const handleBlur = (e) => {
    // Trim whitespace on blur
    const trimmed = e.target.value.trim()
    if (trimmed !== value) {
      onChange(trimmed)
    }
  }

  return (
    <div className="deck-name-group">
      <label htmlFor="deck-name-input" className="deck-name-label">
        Deck name <span className="required">*</span>
      </label>
      <input
        id="deck-name-input"
        type="text"
        className="deck-name-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={handleBlur}
        placeholder="Enter deck name"
        aria-required="true"
        data-testid="deck-name-input"
      />
    </div>
  )
}
