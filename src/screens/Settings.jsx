import React, { useEffect, useState } from 'react'

export default function Settings ({ onBack }) {
  const [apiKey, setApiKey] = useState('')
  const [keySaved, setKeySaved] = useState(false)
  const [claudeCodeStatus, setClaudeCodeStatus] = useState(null)
  const [saving, setSaving] = useState(false)
  const [checking, setChecking] = useState(false)
  const [statusMessage, setStatusMessage] = useState(null)
  const [error, setError] = useState(null)

  const refreshStatus = async () => {
    setChecking(true)
    setError(null)
    try {
      const [keySavedResult, codeStatus] = await Promise.all([
        window.ipc.invoke('get-api-key-set'),
        window.ipc.invoke('get-claude-code-status')
      ])
      const saved = keySavedResult
      setKeySaved(Boolean(saved))
      setClaudeCodeStatus(codeStatus)
    } catch (err) {
      setError(`Could not check auth status: ${err.message}`)
    } finally {
      setChecking(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setChecking(true)
      try {
        const [keySavedResult, codeStatus] = await Promise.all([
          window.ipc.invoke('get-api-key-set'),
          window.ipc.invoke('get-claude-code-status')
        ])
        if (cancelled) return
        const saved = keySavedResult
        setKeySaved(Boolean(saved))
        setClaudeCodeStatus(codeStatus)
      } catch (err) {
        if (!cancelled) setError(`Could not check auth status: ${err.message}`)
      } finally {
        if (!cancelled) setChecking(false)
      }
    })()
    return () => { cancelled = true }
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

  const codeReady = Boolean(claudeCodeStatus?.loggedIn)

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
          <h2 className="settings-section-title">Claude Code</h2>
          <p className="field-hint">
            Cardify uses your local Claude Code login. It does not open a Claude.ai
            browser login or store Claude subscription tokens.
          </p>
          <section
            className={`status-indicator ${codeReady ? 'status-saved' : 'status-empty'}`}
            role="status"
            aria-live="polite"
          >
            <p>
              <span
                className={`status-dot ${codeReady ? 'status-dot-ok' : 'status-dot-empty'}`}
                aria-hidden="true"
              />
              {codeReady ? 'Claude Code is connected' : 'Claude Code is not connected'}
            </p>
            {codeReady && claudeCodeStatus?.email && (
              <p className="status-message">
                {claudeCodeStatus.email}
                {claudeCodeStatus.subscriptionType ? ` · ${claudeCodeStatus.subscriptionType}` : ''}
              </p>
            )}
            {!codeReady && (
              <p className="status-message">Run claude auth login in Terminal, then refresh.</p>
            )}
          </section>
          <div className="settings-actions">
            <button
              type="button"
              className="secondary-btn"
              onClick={refreshStatus}
              disabled={checking}
              aria-disabled={checking}
            >
              {checking ? 'Checking...' : 'Refresh'}
            </button>
          </div>
        </section>

        <section className="field-group">
          <h2 className="settings-section-title">API key fallback</h2>
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
            Optional fallback for direct Anthropic API usage. The key is stored
            encrypted on this device and is never displayed back after saving.
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
          <section
            className={`status-indicator ${keySaved ? 'status-saved' : 'status-empty'}`}
            role="status"
            aria-live="polite"
          >
            <p>
              <span
                className={`status-dot ${keySaved ? 'status-dot-ok' : 'status-dot-empty'}`}
                aria-hidden="true"
              />
              {keySaved ? 'API key is saved' : 'No key saved'}
            </p>
            {statusMessage && <p className="status-message">{statusMessage}</p>}
          </section>
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
