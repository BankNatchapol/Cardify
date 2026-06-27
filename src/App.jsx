import React, { useState } from 'react'
import Upload from './screens/Upload'
import Review from './screens/Review'

export default function App () {
  const [screen, setScreen] = useState('upload')

  // Upload form state — preserved across back-navigation (AC5)
  const [uploadState, setUploadState] = useState({
    filePath: null,
    parsedText: null,
    contextPrompt: '',
    cardFormat: 'basic'
  })
  const [fileName, setFileName] = useState('')

  // Cards produced by generation (Task 3) — passed to Review
  const [cards, setCards] = useState([])

  /**
   * Called by Upload when generation completes successfully.
   * Stores upload state for back-navigation, cards for review.
   */
  const handleUploadComplete = (state) => {
    setUploadState({
      filePath: state.filePath,
      parsedText: state.parsedText,
      contextPrompt: state.contextPrompt,
      cardFormat: state.cardFormat
    })
    setFileName(state.fileName || '')
    setCards(state.cards || [])
    setScreen('review')
  }

  /**
   * Called by Review "Back to Upload" — returns to Upload with preserved state.
   */
  const handleBackToUpload = () => {
    setScreen('upload')
  }

  /**
   * Called by Review "Push to Anki" — wired up in Task 5.
   */
  const handlePush = (deckName, confirmedCards) => {
    // Task 5 will implement the actual push; stub for now.
    console.log('Push to Anki:', { deckName, cards: confirmedCards })
  }

  return (
    <div className='app'>
      {screen === 'upload' && (
        <Upload
          initialState={uploadState}
          onComplete={handleUploadComplete}
        />
      )}
      {screen === 'review' && (
        <Review
          cards={cards}
          fileName={fileName}
          onBack={handleBackToUpload}
          onPush={handlePush}
        />
      )}
    </div>
  )
}
