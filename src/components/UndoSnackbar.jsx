import React, { useEffect, useRef } from 'react'

/**
 * UndoSnackbar — shows "Card deleted. Undo?" for 5 seconds then auto-dismisses.
 *
 * Props:
 *   onUndo    () => void   — called when Undo is clicked
 *   onDismiss () => void   — called when auto-timeout fires or Dismiss is clicked
 */
export default function UndoSnackbar ({ onUndo, onDismiss }) {
  const timerRef = useRef(null)

  useEffect(() => {
    timerRef.current = setTimeout(() => {
      onDismiss()
    }, 5000)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [onDismiss])

  const handleUndo = () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    onUndo()
  }

  return (
    <div className="undo-snackbar" role="status" aria-live="polite" data-testid="undo-snackbar">
      <span className="snackbar-text">Card deleted.</span>
      <button
        className="snackbar-undo-btn"
        onClick={handleUndo}
        aria-label="Undo card deletion"
      >
        Undo
      </button>
    </div>
  )
}
