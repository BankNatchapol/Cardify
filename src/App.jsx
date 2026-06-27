import React, { useCallback, useEffect, useState } from 'react'
import Upload from './screens/Upload'
import Settings from './screens/Settings'
import Review from './screens/Review'

export default function App () {
  const [screen, setScreen] = useState('upload')
  const [uploadState, setUploadState] = useState({
    filePath: null,
    parsedText: null,
    contextPrompt: '',
    cardFormat: 'basic'
  })
  const [cards, setCards] = useState([])
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

  /**
   * Called by Upload screen after a successful generate-cards IPC call.
   * Navigates to the Review screen with the generated cards.
   */
  const handleUploadComplete = (state) => {
    setUploadState({
      filePath: state.filePath,
      parsedText: state.parsedText,
      contextPrompt: state.contextPrompt,
      cardFormat: state.cardFormat
    })
    if (Array.isArray(state.cards)) {
      setCards(state.cards)
    }
    // Extract filename from path
    const name = state.filePath
      ? state.filePath.split('/').pop().split('\\').pop()
      : ''
    setFileName(name)
    setScreen('review')
  }

  const handleNavigate = (target) => {
    setScreen(target)
    if (target === 'upload') {
      // Coming back from settings or review — re-check key status.
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
      {screen === 'review' && (
        <Review
          cards={cards}
          fileName={fileName}
          onBack={() => handleNavigate('upload')}
        />
      )}
    </div>
  )
}
