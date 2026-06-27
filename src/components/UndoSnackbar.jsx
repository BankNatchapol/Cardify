import React, { useEffect } from 'react'

/**
 * UndoSnackbar — transient notification with an undo action.
 * Auto-dismisses after 5 seconds.
 *
 * Props:
 *   onUndo    — called when the user clicks "Undo"
 *   onDismiss — called when the snackbar auto-dismisses or is closed
 */
export default function UndoSnackbar ({ onUndo, onDismiss }) {
  useEffect(() => {
    const timer = setTimeout(() => {
      onDismiss()
    }, 5000)
    return () => clearTimeout(timer)
  }, [onDismiss])

  return (
    <div className="undo-snackbar" role="status" aria-live="polite">
      <span>Card deleted.</span>
      <button
        type="button"
        className="undo-btn"
        onClick={onUndo}
      >
        Undo
      </button>
    </div>
  )
}
