import React, { useEffect, useState } from 'react'

function defaultGenerationSettings () {
  return {
    batchSize: 10,
    maxBatches: 20,
    claudeCodeModel: 'default',
    apiModel: 'claude-sonnet-4-6'
  }
}

function normalizeGenerationSettings (settings = {}) {
  const defaults = defaultGenerationSettings()
  const batchSize = Math.min(50, Math.max(1, Number.parseInt(settings.batchSize, 10) || defaults.batchSize))
  const maxBatches = Math.min(100, Math.max(1, Number.parseInt(settings.maxBatches, 10) || defaults.maxBatches))
  const claudeCodeModel = String(settings.claudeCodeModel || defaults.claudeCodeModel).trim() || defaults.claudeCodeModel
  const apiModel = String(settings.apiModel || defaults.apiModel).trim() || defaults.apiModel
  return { batchSize, maxBatches, claudeCodeModel, apiModel }
}

function getModelSelectOptions (apiModels, currentModel) {
  const models = Array.isArray(apiModels) ? apiModels : []
  const options = models
    .map(model => ({
      id: String(model.id || '').trim(),
      label: String(model.displayName || model.id || '').trim()
    }))
    .filter(model => model.id && model.label)

  if (currentModel && !options.some(model => model.id === currentModel)) {
    options.unshift({
      id: currentModel,
      label: currentModel === 'default' ? 'Default' : currentModel
    })
  }

  return options
}

export default function Settings ({ generationSettings: initialGenerationSettings, onGenerationSettingsChange }) {
  const [apiKey, setApiKey] = useState('')
  const [keyStatus, setKeyStatus] = useState({ available: false, saved: false, source: null })
  const [claudeCodeStatus, setClaudeCodeStatus] = useState(null)
  const [generationSettings, setGenerationSettings] = useState(() => normalizeGenerationSettings(initialGenerationSettings))
  const [modelOptions, setModelOptions] = useState([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [modelListMessage, setModelListMessage] = useState(null)
  const [saving, setSaving] = useState(false)
  const [savingGenerationSettings, setSavingGenerationSettings] = useState(false)
  const [statusMessage, setStatusMessage] = useState(null)
  const [generationSettingsMessage, setGenerationSettingsMessage] = useState(null)
  const [error, setError] = useState(null)

  const refreshModelOptions = async () => {
    setLoadingModels(true)
    setModelListMessage(null)
    try {
      const result = await window.ipc.invoke('list-claude-api-models')
      const models = Array.isArray(result?.models) ? result.models : []
      setModelOptions(models)
      if (result?.error === 'no-api-key') {
        setModelListMessage('Save an API key to load available models.')
      } else if (result?.error === 'invalid-api-key') {
        setModelListMessage('Saved API key could not list models. Check the key and try again.')
      } else if (result?.error) {
        setModelListMessage(result.message || 'Could not load models. You can keep the saved model.')
      } else if (models.length === 0) {
        setModelListMessage('No API models were returned.')
      } else if (result?.keySource === 'saved') {
        setModelListMessage('Loaded models from the saved API key.')
      }
    } catch (err) {
      setModelListMessage(`Could not load models: ${err.message}`)
    } finally {
      setLoadingModels(false)
    }
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [keySavedResult, codeStatus, savedGenerationSettings, modelList] = await Promise.all([
          window.ipc.invoke('get-api-key-status'),
          window.ipc.invoke('get-claude-code-status'),
          window.ipc.invoke('get-generation-settings'),
          window.ipc.invoke('list-claude-api-models')
        ])
        if (cancelled) return
        setKeyStatus(keySavedResult || { available: false, saved: false, source: null })
        setClaudeCodeStatus(codeStatus)
        const normalized = normalizeGenerationSettings(savedGenerationSettings)
        setGenerationSettings(normalized)
        const models = Array.isArray(modelList?.models) ? modelList.models : []
        setModelOptions(models)
        if (modelList?.error === 'no-api-key') setModelListMessage('Save an API key to load available models.')
        else if (modelList?.keySource === 'saved') setModelListMessage('Loaded models from the saved API key.')
        onGenerationSettingsChange?.(normalized)
      } catch (err) {
        if (!cancelled) setError(`Could not check auth status: ${err.message}`)
      }
    })()
    return () => { cancelled = true }
  }, [onGenerationSettingsChange])

  useEffect(() => {
    setGenerationSettings(normalizeGenerationSettings(initialGenerationSettings))
  }, [initialGenerationSettings])

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
      setKeyStatus({ available: true, saved: true, source: 'saved' })
      setStatusMessage('Key saved')
      refreshModelOptions()
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
      setKeyStatus({ available: false, saved: false, source: null })
      setModelOptions([])
      setModelListMessage('Save an API key to load available models.')
      setStatusMessage('No API key available')
    } catch (err) {
      setError(`Failed to clear API key: ${err.message}`)
    }
  }

  const handleGenerationSettingChange = (key, value) => {
    setGenerationSettingsMessage(null)
    setGenerationSettings(prev => normalizeGenerationSettings({ ...prev, [key]: value }))
  }

  const handleModelChange = (value) => {
    setGenerationSettingsMessage(null)
    setGenerationSettings(prev => normalizeGenerationSettings({
      ...prev,
      claudeCodeModel: value,
      apiModel: value
    }))
  }

  const handleSaveGenerationSettings = async () => {
    setError(null)
    setGenerationSettingsMessage(null)
    setSavingGenerationSettings(true)
    try {
      const unifiedSettings = {
        ...generationSettings,
        apiModel: generationSettings.claudeCodeModel
      }
      const saved = await window.ipc.invoke('save-generation-settings', unifiedSettings)
      const normalized = normalizeGenerationSettings(saved)
      setGenerationSettings(normalized)
      onGenerationSettingsChange?.(normalized)
      setGenerationSettingsMessage('Generation settings saved')
    } catch (err) {
      setError(`Failed to save generation settings: ${err.message}`)
    } finally {
      setSavingGenerationSettings(false)
    }
  }

  const codeReady = Boolean(claudeCodeStatus?.loggedIn)
  const keyAvailable = Boolean(keyStatus.available)
  const generationLimit = generationSettings.batchSize * generationSettings.maxBatches
  const hasLoadedModelOptions = modelOptions.length > 0
  const modelSelectOptions = keyAvailable && hasLoadedModelOptions
    ? getModelSelectOptions(modelOptions, generationSettings.claudeCodeModel)
    : []
  const modelSelectDisabled = loadingModels || !keyAvailable || !hasLoadedModelOptions
  const modelSelectValue = modelSelectOptions.length > 0 ? generationSettings.claudeCodeModel : ''

  return (
    <div className="settings-screen">
      <header className="settings-header">
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
              <p className="status-message">Run claude auth login in Terminal, then reopen Settings.</p>
            )}
          </section>
          <label className="card-field" htmlFor="claude-code-model-input">
            <span className="field-label">Claude model</span>
            <select
              id="claude-code-model-input"
              className="api-key-input"
              value={modelSelectValue}
              onChange={(e) => handleModelChange(e.target.value)}
              disabled={modelSelectDisabled}
            >
              {modelSelectOptions.length === 0 && (
                <option value="">
                  {keyAvailable ? 'Refresh models to choose' : 'Save API key to load models'}
                </option>
              )}
              {modelSelectOptions.map(model => (
                <option key={model.id} value={model.id}>
                  {model.label}
                </option>
              ))}
            </select>
          </label>
          <p className="field-hint">
            Save an Anthropic API key below to load available models. This model is used for Claude Code generation and the API fallback.
          </p>
          <div className="settings-actions">
            <button
              type="button"
              className="secondary-btn"
              onClick={refreshModelOptions}
              disabled={loadingModels || !keyAvailable}
              aria-disabled={loadingModels || !keyAvailable}
            >
              {loadingModels ? 'Loading models...' : 'Refresh Models'}
            </button>
          </div>
          {modelListMessage && <p className="status-message">{modelListMessage}</p>}
        </section>

        <section className="field-group">
          <h2 className="settings-section-title">Generation limits</h2>
          <p className="field-hint">
            These settings apply to new guided generations. Existing projects keep their saved progress settings.
          </p>
          <div className="settings-number-grid">
            <label className="card-field" htmlFor="batch-size-input">
              <span className="field-label">Batch size</span>
              <input
                id="batch-size-input"
                type="number"
                className="settings-number-input"
                min="1"
                max="50"
                step="1"
                value={generationSettings.batchSize}
                onChange={(e) => handleGenerationSettingChange('batchSize', e.target.value)}
              />
            </label>
            <label className="card-field" htmlFor="max-batches-input">
              <span className="field-label">Max batches</span>
              <input
                id="max-batches-input"
                type="number"
                className="settings-number-input"
                min="1"
                max="100"
                step="1"
                value={generationSettings.maxBatches}
                onChange={(e) => handleGenerationSettingChange('maxBatches', e.target.value)}
              />
            </label>
          </div>
          <section className="settings-calculation" aria-label="Generation limit">
            <span>Generation limit</span>
            <strong>{generationLimit}</strong>
          </section>
          <div className="settings-actions">
            <button
              type="button"
              className="primary-btn"
              onClick={handleSaveGenerationSettings}
              disabled={savingGenerationSettings}
              aria-disabled={savingGenerationSettings}
            >
              {savingGenerationSettings ? 'Saving...' : 'Save Generation Settings'}
            </button>
          </div>
          {generationSettingsMessage && <p className="status-message">{generationSettingsMessage}</p>}
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
            Optional fallback for direct Anthropic API usage and loading the API model list. The key is stored
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
              disabled={!keyStatus.saved}
            >
              Clear saved key
            </button>
          </div>
          <section
            className={`status-indicator ${keyAvailable ? 'status-saved' : 'status-empty'}`}
            role="status"
            aria-live="polite"
          >
            <p>
              <span
                className={`status-dot ${keyAvailable ? 'status-dot-ok' : 'status-dot-empty'}`}
                aria-hidden="true"
              />
              {keyStatus.saved
                ? 'API key is saved'
                : 'No API key available'}
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
