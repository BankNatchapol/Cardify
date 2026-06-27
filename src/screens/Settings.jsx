import React, { useEffect, useState } from 'react'

/**
 * Settings screen — Claude API key management.
 *
 * Security:
 * - The raw key is held in component state only while the user is typing.
 * - After Save success, the field is cleared. The key is never re-read from
 *   the main process into the renderer (only a boolean "is a key saved?").
 */
export default function Settings({ onBack }) {
  const [apiKey, setApiKey] = useState('')
  const [keySaved, setKeySaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [statusMessage, setStatusMessage] = useState(null)
  const [error, setError] = useState(null)

  // Check status on mount
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const saved = await window.ipc.invoke('get-api-key-set')
        if (!cancelled) {
          setKeySaved(Boolean(saved))
        }
      } catch (err) {
        if (!cancelled) {
          setError(`Could not check key status: ${err.message}`)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const handleSave = async () => {
    setError(null)
    setStatusMessage(null)
    const trimmed = apiKey.trim()
    if (!trimmed) {
      setError('Please enter an API key before saving.')
      return
    }
    setSaving(true)
    try {
      await window.ipc.invoke('save-api-key', trimmed)
      // Clear the raw key from renderer state once saved.
      setApiKey('')
      setKeySaved(true)
      setStatusMessage('Key saved')
    } catch (err) {
      setError(`Failed to save API key: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }

  const handleClear = async () => {
    setError(null)
    setStatusMessage(null)
    try {
      await window.ipc.invoke('clear-api-key')
      setApiKey('')
      setKeySaved(false)
      setStatusMessage('No key saved')
    } catch (err) {
      setError(`Failed to clear API key: ${err.message}`)
    }
  }

  return (
    <div className="settings-screen">
      <header className="settings-header">
        <button
          type="button"
          className="back-btn"
          onClick={onBack}
          aria-label="Back to Upload"
        >
          ← Back
        </button>
        <h1>Settings</h1>
      </header>

      <main className="settings-main">
        <section className="field-group">
          <label htmlFor="api-key-input" className="field-label">
            Claude API key
          </label>
          <input
            id="api-key-input"
            type="password"
            className="api-key-input"
            placeholder="sk-ant-..."
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
          <p className="field-hint">
            Stored encrypted on this device via Electron safeStorage. The key
            is never displayed back in this window after saving.
          </p>

          <div className="settings-actions">
            <button
              type="button"
              className="primary-btn"
              onClick={handleSave}
              disabled={saving || apiKey.trim().length === 0}
              aria-disabled={saving || apiKey.trim().length === 0}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              className="secondary-btn"
              onClick={handleClear}
              disabled={!keySaved && !statusMessage}
            >
              Clear
            </button>
          </div>
        </section>

        <section
          className={`status-indicator ${keySaved ? 'status-saved' : 'status-empty'}`}
          role="status"
          aria-live="polite"
        >
          {keySaved ? (
            <p>
              <span className="status-dot status-dot-ok" aria-hidden="true" />
              API key is saved
            </p>
          ) : (
            <p>
              <span className="status-dot status-dot-empty" aria-hidden="true" />
              No key saved
            </p>
          )}
          {statusMessage && (
            <p className="status-message">{statusMessage}</p>
          )}
        </section>

        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
      </main>
    </div>
  )
}
