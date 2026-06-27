import React, { useCallback, useEffect, useState } from 'react'
import Upload from './screens/Upload'
import Settings from './screens/Settings'

export default function App() {
  const [screen, setScreen] = useState('upload')
  const [uploadState, setUploadState] = useState({
    filePath: null,
    parsedText: null,
    contextPrompt: '',
    cardFormat: 'basic'
  })
  // eslint-disable-next-line no-unused-vars
  const [cards, setCards] = useState([])
  // eslint-disable-next-line no-unused-vars
  const [fileName, setFileName] = useState('')

  // Whether the user has saved a Claude API key (drives Generate gating).
  const [apiKeySet, setApiKeySet] = useState(false)

  const refreshApiKeyStatus = useCallback(async () => {
    try {
      const saved = await window.ipc.invoke('get-api-key-set')
      setApiKeySet(Boolean(saved))
    } catch {
      setApiKeySet(false)
    }
  }, [])

  // Check on mount and whenever we navigate back to upload from settings.
  useEffect(() => {
    refreshApiKeyStatus()
  }, [refreshApiKeyStatus])

  const handleUploadComplete = (state) => {
    setUploadState(state)
    // Stay on upload after Generate — Review wiring lands in Task 4.
  }

  const handleNavigate = (target) => {
    setScreen(target)
    if (target === 'upload') {
      // Coming back from settings — re-check key status.
      refreshApiKeyStatus()
    }
  }

  return (
    <div className="app">
      {screen === 'upload' && (
        <Upload
          initialState={uploadState}
          apiKeySet={apiKeySet}
          onComplete={handleUploadComplete}
          onOpenSettings={() => handleNavigate('settings')}
        />
      )}
      {screen === 'settings' && (
        <Settings onBack={() => handleNavigate('upload')} />
      )}
      {/* Review screen added in Task 4 */}
    </div>
  )
}
