import React, { useCallback, useEffect, useState } from 'react'

function playSuccessChime () {
  try {
    const ctx = new AudioContext()
    const playNote = (freq, startTime, duration) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      osc.connect(gain)
      gain.connect(ctx.destination)
      gain.gain.setValueAtTime(0.3, startTime)
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration)
      osc.start(startTime)
      osc.stop(startTime + duration)
    }
    const now = ctx.currentTime
    playNote(880, now, 0.25)
    playNote(1108, now + 0.15, 0.3)
  } catch {
    // Audio unavailable — fail silently
  }
}
import Upload from './screens/Upload'
import Settings from './screens/Settings'
import Review from './screens/Review'
import Projects from './screens/Projects'

function defaultDescription () {
  return {
    title: '',
    purpose: '',
    contents: []
  }
}

function normalizeDescription (description, fallbackTitle = '') {
  if (!description || typeof description !== 'object' || Array.isArray(description)) {
    return {
      ...defaultDescription(),
      title: fallbackTitle
    }
  }

  return {
    title: String(description.title || fallbackTitle || '').trim(),
    purpose: String(description.purpose || '').trim(),
    contents: Array.isArray(description.contents)
      ? description.contents.map(item => String(item || '').trim()).filter(Boolean)
      : []
  }
}

function normalizeGenerationResult (result, fallbackTitle = '') {
  if (Array.isArray(result)) {
    return {
      description: normalizeDescription(null, fallbackTitle),
      cards: result
    }
  }

  return {
    description: normalizeDescription(result?.description, fallbackTitle),
    cards: Array.isArray(result?.cards) ? result.cards : null
  }
}

export default function App () {
  const [screen, setScreen] = useState('upload')
  const [uploadState, setUploadState] = useState({
    filePath: null,
    fileName: '',
    parsedText: null,
    charCount: null,
    contextPrompt: '',
    cardFormat: 'basic'
  })
  const [cards, setCards] = useState([])
  const [description, setDescription] = useState(defaultDescription())
  const [fileName, setFileName] = useState('')
  const [project, setProject] = useState(null)
  const [generationState, setGenerationState] = useState({
    generating: false,
    stage: '',
    logs: [],
    error: null
  })

  // Whether the user has any usable Claude auth method (drives Generate gating).
  const [apiKeySet, setApiKeySet] = useState(false)

  const loadProject = useCallback((nextProject) => {
    setProject(nextProject)
    setCards(Array.isArray(nextProject.cards) ? nextProject.cards : [])
    setFileName(nextProject.fileName || '')
    setDescription(normalizeDescription(nextProject.description, nextProject.title || nextProject.fileName || ''))
    setUploadState(prev => ({
      ...prev,
      filePath: nextProject.filePath || null,
      fileName: nextProject.fileName || '',
      parsedText: nextProject.parsedText || null,
      charCount: nextProject.charCount ?? null,
      contextPrompt: nextProject.contextPrompt || '',
      cardFormat: nextProject.cardFormat || 'basic'
    }))
  }, [])

  const refreshApiKeyStatus = useCallback(async () => {
    try {
      const [keySaved, claudeCodeStatus] = await Promise.all([
        window.ipc.invoke('get-api-key-set'),
        window.ipc.invoke('get-claude-code-status')
      ])
      setApiKeySet(Boolean(claudeCodeStatus?.loggedIn) || Boolean(keySaved))
    } catch {
      setApiKeySet(false)
    }
  }, [])

  // Check on mount and whenever we navigate back to upload from settings.
  useEffect(() => {
    refreshApiKeyStatus()
  }, [refreshApiKeyStatus])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const latest = await window.ipc.invoke('get-latest-project')
        if (cancelled || !latest) return
        loadProject(latest)
      } catch {
        // Project restore is best-effort; a corrupt cache should not block app use.
      }
    })()
    return () => { cancelled = true }
  }, [loadProject])

  const handleUploadStateChange = useCallback((patch) => {
    setUploadState(prev => ({ ...prev, ...patch }))
  }, [])

  const pushGenerationLog = useCallback((message) => {
    setGenerationState(prev => ({
      ...prev,
      stage: message,
      logs: [...prev.logs, `${new Date().toLocaleTimeString()} ${message}`]
    }))
  }, [])

  const handleGenerateCards = useCallback(async (state) => {
    setGenerationState({
      generating: true,
      stage: 'Preparing source text',
      logs: [`${new Date().toLocaleTimeString()} Preparing source text`],
      error: null
    })

    try {
      pushGenerationLog('Sending request to Claude Code')
      const result = await window.ipc.invoke('generate-cards', {
        filePath: state.filePath,
        contextPrompt: state.contextPrompt,
        cardFormat: state.cardFormat
      })

      pushGenerationLog('Reading generated cards')

      if (result && result.error === 'invalid-api-key') {
        setGenerationState(prev => ({
          ...prev,
          generating: false,
          stage: 'Generation failed',
          error: 'Invalid API key — check Settings'
        }))
        return
      }

      if (result && result.error === 'claude-code-unavailable') {
        setGenerationState(prev => ({
          ...prev,
          generating: false,
          stage: 'Generation failed',
          error: 'Claude Code is not available. Install Claude Code and run claude auth login in Terminal.'
        }))
        return
      }

      const name = state.fileName || (state.filePath
        ? state.filePath.split('/').pop().split('\\').pop()
        : '')
      const generation = normalizeGenerationResult(result, name || 'Untitled Cardify Project')

      if (!Array.isArray(generation.cards)) {
        setGenerationState(prev => ({
          ...prev,
          generating: false,
          stage: 'Generation failed',
          error: 'Unexpected response from Claude — please try again.'
        }))
        return
      }

      setCards(generation.cards)
      setDescription(generation.description)
      setFileName(name)
      const savedProject = await window.ipc.invoke('save-project', {
        id: project?.id,
        title: generation.description.title || name || 'Untitled Cardify Project',
        description: generation.description,
        filePath: state.filePath,
        fileName: name,
        contextPrompt: state.contextPrompt,
        cardFormat: state.cardFormat,
        cards: generation.cards
      })
      setProject(savedProject)
      playSuccessChime()
      setGenerationState(prev => ({
        ...prev,
        generating: false,
        stage: `Generated ${generation.cards.length} ${generation.cards.length === 1 ? 'card' : 'cards'}`,
        logs: [...prev.logs, `${new Date().toLocaleTimeString()} Generated ${generation.cards.length} cards`],
        error: null
      }))
      setScreen('review')
    } catch (err) {
      setGenerationState(prev => ({
        ...prev,
        generating: false,
        stage: 'Generation failed',
        error: `Failed to generate cards: ${err.message}`,
        logs: [...prev.logs, `${new Date().toLocaleTimeString()} Failed: ${err.message}`]
      }))
    }
  }, [project?.id, pushGenerationLog])

  const handleUploadComplete = (state) => {
    if (Array.isArray(state.cards)) {
      setCards(state.cards)
    }
    if (state.description) {
      setDescription(normalizeDescription(state.description, state.fileName || ''))
    }
    const name = state.fileName || (state.filePath
      ? state.filePath.split('/').pop().split('\\').pop()
      : '')
    setFileName(name)
    setScreen('review')
  }

  const handleProjectChange = useCallback(async ({ cards: nextCards, fileName: nextFileName, description: nextDescription }) => {
    const finalCards = Array.isArray(nextCards) ? nextCards : cards
    const finalDescription = nextDescription
      ? normalizeDescription(nextDescription, nextFileName || fileName)
      : description

    setCards(finalCards)
    setDescription(finalDescription)
    if (nextFileName !== undefined) setFileName(nextFileName)
    const savedProject = await window.ipc.invoke('save-project', {
      id: project?.id,
      title: finalDescription.title || nextFileName || fileName || 'Untitled Cardify Project',
      description: finalDescription,
      filePath: uploadState.filePath,
      fileName: nextFileName || fileName,
      parsedText: uploadState.parsedText,
      charCount: uploadState.charCount,
      contextPrompt: uploadState.contextPrompt,
      cardFormat: uploadState.cardFormat,
      cards: finalCards
    })
    setProject(savedProject)
  }, [cards, description, fileName, project?.id, uploadState])

  const handleNavigate = (target) => {
    setScreen(target)
    if (target === 'upload') {
      // Coming back from settings or review — re-check key status.
      refreshApiKeyStatus()
    }
  }

  const handleOpenProject = useCallback((nextProject) => {
    loadProject(nextProject)
    setGenerationState({
      generating: false,
      stage: nextProject.cards?.length ? `Loaded ${nextProject.cards.length} cards` : '',
      logs: nextProject.cards?.length ? [`${new Date().toLocaleTimeString()} Loaded saved project`] : [],
      error: null
    })
    setScreen('review')
  }, [loadProject])

  const handleNewProject = useCallback(() => {
    setProject(null)
    setCards([])
    setDescription(defaultDescription())
    setFileName('')
    setUploadState({
      filePath: null,
      fileName: '',
      parsedText: null,
      charCount: null,
      contextPrompt: '',
      cardFormat: 'basic'
    })
    setGenerationState({ generating: false, stage: '', logs: [], error: null })
    setScreen('upload')
  }, [])

  const activeSection = screen === 'review' ? 'projects' : screen

  return (
    <div className="app">
      <header className="app-shell-header">
        <div className="app-brand">
          <span className="app-brand-mark">C</span>
          <span>Cardify</span>
        </div>
        <nav className="app-tabs" aria-label="Primary">
          <button
            type="button"
            className={activeSection === 'upload' ? 'app-tab app-tab--active' : 'app-tab'}
            onClick={() => handleNavigate('upload')}
          >
            Upload
          </button>
          <button
            type="button"
            className={activeSection === 'projects' ? 'app-tab app-tab--active' : 'app-tab'}
            onClick={() => handleNavigate('projects')}
          >
            Projects
          </button>
          <button
            type="button"
            className={activeSection === 'settings' ? 'app-tab app-tab--active' : 'app-tab'}
            onClick={() => handleNavigate('settings')}
          >
            Settings
          </button>
        </nav>
      </header>

      {screen === 'upload' && (
        <Upload
          initialState={uploadState}
          apiKeySet={apiKeySet}
          generationState={generationState}
          generatedCardCount={cards.length}
          generatedCards={cards}
          description={description}
          onStateChange={handleUploadStateChange}
          onGenerate={handleGenerateCards}
          onComplete={handleUploadComplete}
          onOpenReview={() => setScreen('review')}
          onOpenProjects={() => handleNavigate('projects')}
          onOpenSettings={() => handleNavigate('settings')}
        />
      )}
      {screen === 'projects' && (
        <Projects
          activeProjectId={project?.id}
          onOpenProject={handleOpenProject}
          onNewProject={handleNewProject}
        />
      )}
      {screen === 'settings' && (
        <Settings onBack={() => handleNavigate('upload')} />
      )}
      {screen === 'review' && (
        <Review
          cards={cards}
          description={description}
          fileName={fileName}
          onProjectChange={handleProjectChange}
          onBack={() => handleNavigate('upload')}
        />
      )}
    </div>
  )
}
