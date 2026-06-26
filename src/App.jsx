import React, { useState } from 'react'
import Upload from './screens/Upload'

export default function App() {
  const [screen, setScreen] = useState('upload')
  const [uploadState, setUploadState] = useState({
    filePath: null,
    parsedText: null,
    contextPrompt: '',
    cardFormat: 'basic'
  })
  const [cards, setCards] = useState([])
  const [fileName, setFileName] = useState('')

  const handleUploadComplete = (state) => {
    setUploadState(state)
    setScreen('settings')
  }

  return (
    <div className="app">
      {screen === 'upload' && (
        <Upload
          initialState={uploadState}
          onComplete={handleUploadComplete}
        />
      )}
      {/* Settings and Review screens added in later tasks */}
    </div>
  )
}
