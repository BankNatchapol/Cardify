import React, { useCallback, useEffect, useRef, useState } from 'react'

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
import {
  detectGenerationGoal,
  extractGenerationGoalFromClarifications,
  generationGoalStats,
  normalizeGenerationGoal
} from './lib/generationGoal'

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

function cardsToRegenerationSource (cards, description) {
  const lines = []
  const normalizedDescription = normalizeDescription(description)
  lines.push('Regenerate these existing flashcards into a polished Cardify deck.')
  lines.push('Keep the same learning intent, but improve the backs with concise markdown formatting where useful.')
  lines.push('Use **bold** for key terms, bullets for multiple facts, `inline code` for literal terms, and semantic highlights like <span class="cf-key">only when they add clarity</span>.')
  lines.push('Do not merely copy the existing back text unchanged if markdown structure would make it easier to review.')
  lines.push('')
  if (normalizedDescription.title) lines.push(`# ${normalizedDescription.title}`)
  if (normalizedDescription.purpose) lines.push(normalizedDescription.purpose)
  if (normalizedDescription.contents.length > 0) {
    lines.push('Topics:')
    normalizedDescription.contents.forEach(item => lines.push(`- ${item}`))
  }
  if (lines.length > 0) lines.push('')
  lines.push('Existing flashcards to regenerate and improve:')
  cards.forEach((card, index) => {
    lines.push(`\nCard ${index + 1}`)
    if (card.type === 'cloze') {
      lines.push(`Cloze: ${card.text || ''}`)
    } else {
      lines.push(`Front: ${card.front || ''}`)
      lines.push(`Back: ${card.back || ''}`)
    }
  })
  return lines.join('\n')
}

function defaultWizardState () {
  return {
    step: 'idle',
    clarificationQuestions: [],
    clarificationAnswers: {},
    clarificationHistory: [],
    clarifiedContext: '',
    sampleCards: [],
    acceptedSampleCards: [],
    sampleFeedback: '',
    sampleFeedbackHistory: [],
    previousSampleCards: [],
    generationGoal: normalizeGenerationGoal(),
    generationProgress: null,
    latestCoverage: null
  }
}

function cardDuplicateKey (card) {
  if (!card) return ''
  return card.type === 'cloze'
    ? `cloze:${card.text || ''}`
    : `basic:${card.front || ''}\n${card.back || ''}`
}

function mergeCardsUnique (cards) {
  const seen = new Set()
  const merged = []
  for (const card of cards.filter(Boolean)) {
    const key = cardDuplicateKey(card)
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(card)
  }
  return merged
}

function sampleCardTopic (card) {
  if (!card) return ''
  if (card.type === 'cloze') {
    return String(card.text || '')
      .replace(/\{\{c\d+::([^}:]+)(?:::[^}]+)?\}\}/g, '$1')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80)
  }
  return String(card.front || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
}

function guidedInitialDescription ({ state = {}, clarifiedContext = '', acceptedSampleCards = [] } = {}) {
  const fallbackTitle = state.fileName || (state.filePath
    ? state.filePath.split('/').pop().split('\\').pop()
    : '')
  const purpose = String(clarifiedContext || state.contextPrompt || '').trim()
  const contents = [...new Set(
    acceptedSampleCards
      .map(sampleCardTopic)
      .filter(Boolean)
  )].slice(0, 12)

  return normalizeDescription({
    title: fallbackTitle,
    purpose,
    contents
  }, fallbackTitle)
}

function defaultIterativeProgress ({ clarifiedContext = '', sampleFeedback = '', acceptedSampleCards = [] } = {}) {
  return {
    mode: 'iterative',
    status: 'in_progress',
    batchSize: 10,
    maxBatches: 20,
    completedBatches: 0,
    coverageHistory: [],
    clarifiedContext,
    sampleFeedback,
    acceptedSampleCards,
    duplicateKeys: acceptedSampleCards.map(cardDuplicateKey).filter(Boolean),
    currentCardCount: acceptedSampleCards.length,
    generationGoal: normalizeGenerationGoal()
  }
}

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

function clarificationContextFromHistory (contextPrompt, history) {
  return [
    contextPrompt,
    'Clarification answers:',
    ...history.map(item => `Q: ${item.question}\nA: ${item.answer}`)
  ].join('\n')
}

function hasNewClarificationQuestions (questions, history) {
  const previous = new Set(history.map(item => String(item.question || '').trim().toLowerCase()))
  return (questions || []).some(question => !previous.has(String(question || '').trim().toLowerCase()))
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
  const [generationSettings, setGenerationSettings] = useState(defaultGenerationSettings)
  const [wizardState, setWizardState] = useState(defaultWizardState)
  const cardsRef = useRef(cards)
  const descriptionRef = useRef(description)
  const uploadStateRef = useRef(uploadState)
  const wizardStateRef = useRef(wizardState)
  const fileNameRef = useRef(fileName)
  const projectRef = useRef(project)

  // Whether the user has any usable Claude auth method (drives Generate gating).
  const [apiKeySet, setApiKeySet] = useState(false)

  useEffect(() => { cardsRef.current = cards }, [cards])
  useEffect(() => { descriptionRef.current = description }, [description])
  useEffect(() => { uploadStateRef.current = uploadState }, [uploadState])
  useEffect(() => { wizardStateRef.current = wizardState }, [wizardState])
  useEffect(() => { fileNameRef.current = fileName }, [fileName])
  useEffect(() => { projectRef.current = project }, [project])

  const loadProject = useCallback((nextProject) => {
    setProject(nextProject)
    const nextCards = Array.isArray(nextProject.cards) ? nextProject.cards : []
    const nextDescription = normalizeDescription(nextProject.description, nextProject.title || nextProject.fileName || '')
    setCards(nextCards)
    setFileName(nextProject.fileName || '')
    setDescription(nextDescription)
    setUploadState(prev => ({
      ...prev,
      filePath: nextProject.filePath || null,
      fileName: nextProject.fileName || '',
      parsedText: nextProject.parsedText || null,
      charCount: nextProject.charCount ?? null,
      contextPrompt: nextProject.contextPrompt || '',
      cardFormat: nextProject.cardFormat || 'basic'
    }))
    const nextWizardState = {
      ...defaultWizardState(),
      generationProgress: nextProject.generationProgress || null,
      latestCoverage: nextProject.generationProgress?.coverageHistory?.at?.(-1) || null,
      step: nextProject.generationProgress?.status && nextProject.generationProgress.status !== 'done'
        ? 'generating_full'
        : 'idle'
    }
    setWizardState(nextWizardState)
    cardsRef.current = nextCards
    descriptionRef.current = nextDescription
    fileNameRef.current = nextProject.fileName || ''
    projectRef.current = nextProject
    wizardStateRef.current = nextWizardState
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
        const saved = await window.ipc.invoke('get-generation-settings')
        if (!cancelled) setGenerationSettings(normalizeGenerationSettings(saved))
      } catch {
        if (!cancelled) setGenerationSettings(defaultGenerationSettings())
      }
    })()
    return () => { cancelled = true }
  }, [])

  const handleUploadStateChange = useCallback((patch) => {
    const activeElement = document.activeElement
    const editingWizardField = Boolean(activeElement?.closest?.('.generation-wizard'))
    const ignoreContextUndoDuringWizard =
      patch.contextPrompt !== undefined &&
      wizardStateRef.current.step !== 'idle' &&
      editingWizardField

    const effectivePatch = ignoreContextUndoDuringWizard
      ? { ...patch, contextPrompt: uploadStateRef.current.contextPrompt }
      : patch

    setUploadState(prev => ({ ...prev, ...effectivePatch }))
    if (
      effectivePatch.filePath !== undefined ||
      effectivePatch.parsedText !== undefined ||
      (!ignoreContextUndoDuringWizard && effectivePatch.contextPrompt !== undefined) ||
      effectivePatch.cardFormat !== undefined
    ) {
      setWizardState(defaultWizardState())
    }
  }, [])

  const pushGenerationLog = useCallback((message) => {
    setGenerationState(prev => ({
      ...prev,
      stage: message,
      logs: [...prev.logs, `${new Date().toLocaleTimeString()} ${message}`]
    }))
  }, [])

  const resolveGenerationSource = useCallback(async (state) => {
    let parsedText = typeof state.parsedText === 'string' && state.parsedText.length > 0
      ? state.parsedText
      : null
    let charCount = parsedText ? parsedText.length : null

    if (!parsedText && state.filePath) {
      try {
        pushGenerationLog('Reading source file')
        parsedText = await window.ipc.invoke('parse-file', state.filePath)
        charCount = parsedText.length
        setUploadState(prev => ({ ...prev, parsedText, charCount }))
      } catch {
        // Main-process generation can still try the file path directly.
      }
    }

    if (!parsedText && cards.length > 0) {
      pushGenerationLog('Using saved cards as regeneration source')
      parsedText = cardsToRegenerationSource(cards, description)
      charCount = parsedText.length
    }

    return { parsedText, charCount }
  }, [cards, description, pushGenerationLog])

  const saveProjectSnapshot = useCallback(async ({ nextCards, nextDescription, progress, sourceState, charCount, name }) => {
    const state = sourceState || uploadStateRef.current
    const finalCards = Array.isArray(nextCards) ? nextCards : cardsRef.current
    const finalDescription = normalizeDescription(nextDescription || descriptionRef.current, name || fileNameRef.current)
    const finalName = name || state.fileName || fileNameRef.current || (state.filePath
      ? state.filePath.split('/').pop().split('\\').pop()
      : '')
    const savedProject = await window.ipc.invoke('save-project', {
      id: projectRef.current?.id,
      title: finalDescription.title || finalName || 'Untitled Cardify Project',
      description: finalDescription,
      filePath: state.filePath,
      fileName: finalName,
      parsedText: state.parsedText,
      charCount: charCount ?? state.charCount,
      contextPrompt: state.contextPrompt,
      cardFormat: state.cardFormat,
      cards: finalCards,
      generationProgress: progress || null
    })
    setProject(savedProject)
    projectRef.current = savedProject
    return savedProject
  }, [])

  useEffect(() => {
    if (!window.ipc?.onGenerationBatch) return
    const handleBatch = async (payload) => {
      const activeProjectId = projectRef.current?.id
      if (!payload || !activeProjectId || payload.projectId !== activeProjectId) return

      const progress = payload.generationProgress || null
      const mergedCards = mergeCardsUnique([
        ...cardsRef.current,
        ...(Array.isArray(payload.cards) ? payload.cards : [])
      ])
      const nextDescription = descriptionRef.current

      cardsRef.current = mergedCards
      setCards(mergedCards)
      setWizardState(prev => ({
        ...prev,
        step: 'generating_full',
        generationProgress: progress,
        latestCoverage: payload.coverage || prev.latestCoverage
      }))

      if (payload.status === 'failed') {
        setGenerationState(prev => ({
          ...prev,
          generating: false,
          stage: 'Generation failed',
          error: payload.error || 'A generation batch failed. You can continue from the last successful batch.',
          logs: [...prev.logs, `${new Date().toLocaleTimeString()} Batch ${payload.batchNumber} failed`]
        }))
      } else if (payload.status === 'stopped') {
        setGenerationState(prev => ({
          ...prev,
          generating: false,
          stage: 'Generation stopped',
          error: null,
          logs: [...prev.logs, `${new Date().toLocaleTimeString()} Stopped after ${mergedCards.length} cards`]
        }))
        setScreen('review')
      } else {
        const running = ['in_progress', 'repairing_shortfall'].includes(payload.status)
        setGenerationState(prev => ({
          ...prev,
          generating: running,
          stage: running
            ? `Generated batch ${payload.batchNumber} of ${payload.maxBatches}`
            : `Generation ${payload.status}`,
          error: null,
          logs: [...prev.logs, `${new Date().toLocaleTimeString()} Generated batch ${payload.batchNumber} of ${payload.maxBatches}`]
        }))
      }

      try {
        await saveProjectSnapshot({
          nextCards: mergedCards,
          nextDescription,
          progress,
          sourceState: uploadStateRef.current,
          name: fileNameRef.current
        })
      } catch {
        // Batch progress remains visible even if a checkpoint save fails.
      }
    }

    window.ipc.onGenerationBatch(handleBatch)
    return () => window.ipc.offGenerationBatch?.(handleBatch)
  }, [saveProjectSnapshot])

  const handleGenerateCards = useCallback(async (state, options = {}) => {
    setGenerationState({
      generating: true,
      stage: options.guided ? 'Generating full deck' : (cards.length > 0 ? 'Preparing regeneration' : 'Preparing source text'),
      logs: [`${new Date().toLocaleTimeString()} ${options.guided ? 'Generating full deck' : (cards.length > 0 ? 'Preparing regeneration' : 'Preparing source text')}`],
      error: null
    })
    if (options.guided) setWizardState(prev => ({ ...prev, step: 'generating_full' }))

    try {
      const { parsedText, charCount } = await resolveGenerationSource(state)

      pushGenerationLog('Sending request to Claude Code')
      const result = await window.ipc.invoke('generate-cards', {
        filePath: state.filePath,
        parsedText,
        contextPrompt: state.contextPrompt,
        cardFormat: state.cardFormat,
        clarifiedContext: options.clarifiedContext,
        sampleCards: options.sampleCards,
        sampleFeedback: options.sampleFeedback
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

      if (result && result.error === 'generation-parse-error') {
        setGenerationState(prev => ({
          ...prev,
          generating: false,
          stage: 'Generation failed',
          error: result.message || 'Claude returned a response Cardify could not read as cards. Please try again.',
          logs: result.debugId
            ? [...prev.logs, `${new Date().toLocaleTimeString()} Debug ID: ${result.debugId}`]
            : prev.logs
        }))
        return
      }

      if (result && result.error === 'claude-code-timeout') {
        setGenerationState(prev => ({
          ...prev,
          generating: false,
          stage: 'Generation timed out',
          error: result.message || 'Claude Code timed out while generating cards. Try again with fewer cards or a longer timeout.'
        }))
        return
      }

      if (result && result.error === 'generation-cancelled') {
        setGenerationState(prev => ({
          ...prev,
          generating: false,
          stage: 'Generation cancelled',
          error: null,
          logs: [...prev.logs, `${new Date().toLocaleTimeString()} Generation cancelled`]
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
        parsedText,
        charCount,
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
      setWizardState(defaultWizardState())
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
  }, [cards.length, project?.id, pushGenerationLog, resolveGenerationSource])

  const handleGenerateSampleCards = useCallback(async (state, options = {}) => {
    setGenerationState(prev => ({
      ...prev,
      generating: true,
      stage: 'Generating sample cards',
      logs: [...prev.logs, `${new Date().toLocaleTimeString()} Generating sample cards`],
      error: null
    }))
    setWizardState(prev => ({
      ...prev,
      step: options.keepSampleReview ? 'sample_review' : 'sampling'
    }))

    try {
      const parsedText = options.parsedText || (await resolveGenerationSource(state)).parsedText
      const result = await window.ipc.invoke('generate-sample-cards', {
        filePath: state.filePath,
        parsedText,
        contextPrompt: state.contextPrompt,
        cardFormat: state.cardFormat,
        clarifiedContext: options.clarifiedContext,
        acceptedSampleCards: options.acceptedSampleCards,
        previousSampleCards: options.previousSampleCards,
        sampleFeedbackHistory: options.sampleFeedbackHistory,
        sampleFeedback: options.sampleFeedback
      })

      if (result?.error) {
        if (result.error === 'generation-cancelled') {
          setWizardState(prev => ({
            ...prev,
            step: prev.sampleCards.length > 0 ? 'sample_review' : prev.step
          }))
          setGenerationState(prev => ({
            ...prev,
            generating: false,
            stage: 'Sample generation cancelled',
            error: null,
            logs: [...prev.logs, `${new Date().toLocaleTimeString()} Cancelled sample generation`]
          }))
          return
        }
        setWizardState(prev => ({
          ...prev,
          step: prev.sampleCards.length > 0 ? 'sample_review' : prev.step
        }))
        setGenerationState(prev => ({
          ...prev,
          generating: false,
          stage: 'Sample generation failed',
          error: result.message || 'Could not generate sample cards.',
          logs: result.debugId
            ? [...prev.logs, `${new Date().toLocaleTimeString()} Debug ID: ${result.debugId}`]
            : prev.logs
        }))
        return
      }

      setWizardState(prev => ({
        ...prev,
        step: 'sample_review',
        clarifiedContext: options.clarifiedContext || prev.clarifiedContext,
        sampleCards: Array.isArray(result.cards) ? result.cards : [],
        sampleFeedback: options.clearSampleFeedbackOnSuccess ? '' : prev.sampleFeedback
      }))
      setGenerationState(prev => ({
        ...prev,
        generating: false,
        stage: 'Review sample cards',
        logs: [...prev.logs, `${new Date().toLocaleTimeString()} Generated 3 sample cards`],
        error: null
      }))
    } catch (err) {
      setWizardState(prev => ({
        ...prev,
        step: prev.sampleCards.length > 0 ? 'sample_review' : prev.step
      }))
      setGenerationState(prev => ({
        ...prev,
        generating: false,
        stage: 'Sample generation failed',
        error: `Failed to generate samples: ${err.message}`,
        logs: [...prev.logs, `${new Date().toLocaleTimeString()} Failed: ${err.message}`]
      }))
    }
  }, [pushGenerationLog, resolveGenerationSource])

  const handleStartGuidedGeneration = useCallback(async (state) => {
    setGenerationState({
      generating: true,
      stage: 'Preparing guided generation',
      logs: [`${new Date().toLocaleTimeString()} Preparing guided generation`],
      error: null
    })
    setWizardState(prev => ({ ...prev, step: 'clarifying', clarificationQuestions: [], clarificationAnswers: {} }))

    try {
      const { parsedText } = await resolveGenerationSource(state)
      pushGenerationLog('Asking clarification questions')
      const result = await window.ipc.invoke('prepare-generation', {
        filePath: state.filePath,
        parsedText,
        contextPrompt: state.contextPrompt,
        cardFormat: state.cardFormat,
        clarificationHistory: []
      })

      if (result?.error) {
        setGenerationState(prev => ({ ...prev, generating: false, stage: 'Guided generation failed', error: result.message || 'Could not prepare generation.' }))
        setWizardState(defaultWizardState())
        return
      }

      if (result.status === 'questions') {
        setWizardState(prev => ({
          ...prev,
          step: 'clarifying',
          clarificationQuestions: result.questions || [],
          clarificationAnswers: {},
          generationGoal: normalizeGenerationGoal(result.generationGoal)
        }))
        setGenerationState(prev => ({ ...prev, generating: false, stage: 'Clarification needed', error: null }))
        return
      }

      const clarifiedContext = result.clarifiedContext || state.contextPrompt
      setWizardState(prev => ({ ...prev, clarifiedContext, generationGoal: normalizeGenerationGoal(result.generationGoal), step: 'sampling' }))
      await handleGenerateSampleCards(state, { parsedText, clarifiedContext })
    } catch (err) {
      setGenerationState(prev => ({
        ...prev,
        generating: false,
        stage: 'Guided generation failed',
        error: `Failed to prepare generation: ${err.message}`,
        logs: [...prev.logs, `${new Date().toLocaleTimeString()} Failed: ${err.message}`]
      }))
    }
  }, [handleGenerateSampleCards, pushGenerationLog, resolveGenerationSource])

  const handleClarificationAnswerChange = useCallback((index, value) => {
    setWizardState(prev => ({
      ...prev,
      clarificationAnswers: {
        ...prev.clarificationAnswers,
        [index]: value
      }
    }))
  }, [])

  const handleSubmitClarification = useCallback(async (state) => {
    const answered = wizardState.clarificationQuestions.map((question, index) => ({
      question,
      answer: wizardState.clarificationAnswers[index] || ''
    })).filter(item => item.answer.trim().length > 0)
    const history = [...wizardState.clarificationHistory, ...answered].slice(0, 5)

    if (history.length >= 5) {
      const clarifiedContext = clarificationContextFromHistory(state.contextPrompt, history)
      const generationGoal = extractGenerationGoalFromClarifications(history)
      setWizardState(prev => ({ ...prev, clarificationHistory: history, clarifiedContext, generationGoal, step: 'sampling' }))
      await handleGenerateSampleCards(state, { clarifiedContext })
      return
    }

    setWizardState(prev => ({
      ...prev,
      clarificationHistory: history,
      step: 'sampling'
    }))
    setGenerationState({
      generating: true,
      stage: 'Checking clarification',
      logs: [`${new Date().toLocaleTimeString()} Checking clarification`],
      error: null
    })

    try {
      const { parsedText } = await resolveGenerationSource(state)
      const result = await window.ipc.invoke('prepare-generation', {
        filePath: state.filePath,
        parsedText,
        contextPrompt: state.contextPrompt,
        cardFormat: state.cardFormat,
        clarificationHistory: history
      })

      if (result?.error) {
        setGenerationState(prev => ({ ...prev, generating: false, stage: 'Guided generation failed', error: result.message || 'Could not prepare generation.' }))
        setWizardState(defaultWizardState())
        return
      }

      if (result.status === 'questions' && hasNewClarificationQuestions(result.questions, history)) {
        setWizardState(prev => ({
          ...prev,
          step: 'clarifying',
          clarificationHistory: history,
          clarificationQuestions: result.questions || [],
          clarificationAnswers: {},
          generationGoal: normalizeGenerationGoal(result.generationGoal)
        }))
        setGenerationState(prev => ({ ...prev, generating: false, stage: 'Clarification needed', error: null }))
        return
      }

      const clarifiedContext = result.clarifiedContext || clarificationContextFromHistory(state.contextPrompt, history)
      const generationGoal = normalizeGenerationGoal(result.generationGoal?.targetCardCount ? result.generationGoal : extractGenerationGoalFromClarifications(history))
      setWizardState(prev => ({ ...prev, clarificationHistory: history, clarifiedContext, generationGoal, step: 'sampling' }))
      await handleGenerateSampleCards(state, { parsedText, clarifiedContext })
    } catch (err) {
      setWizardState(prev => ({ ...prev, step: 'clarifying' }))
      setGenerationState(prev => ({
        ...prev,
        generating: false,
        stage: 'Guided generation failed',
        error: `Failed to process clarification: ${err.message}`,
        logs: [...prev.logs, `${new Date().toLocaleTimeString()} Failed: ${err.message}`]
      }))
    }
  }, [handleGenerateSampleCards, resolveGenerationSource, wizardState])

  const handleSampleCardUpdate = useCallback((index, updatedCard) => {
    setWizardState(prev => {
      const next = [...prev.sampleCards]
      next[index] = updatedCard
      return { ...prev, sampleCards: next }
    })
  }, [])

  const handleSampleCardDelete = useCallback((index) => {
    setWizardState(prev => ({
      ...prev,
      sampleCards: prev.sampleCards.filter((_, sampleIndex) => sampleIndex !== index)
    }))
  }, [])

  const handleSampleFeedbackChange = useCallback((value) => {
    setWizardState(prev => ({ ...prev, sampleFeedback: value }))
  }, [])

  const handleRegenerateSamples = useCallback(async (state) => {
    setGenerationState(prev => ({
      ...prev,
      generating: true,
      stage: 'Regenerating sample cards',
      logs: [...prev.logs, `${new Date().toLocaleTimeString()} Regenerating sample cards`],
      error: null
    }))
    const feedback = String(wizardState.sampleFeedback || '').trim()
    const sampleFeedbackHistory = feedback
      ? [...wizardState.sampleFeedbackHistory, feedback]
      : wizardState.sampleFeedbackHistory
    const previousSampleCards = mergeCardsUnique([
      ...wizardState.previousSampleCards,
      ...wizardState.sampleCards
    ])
    setWizardState(prev => ({
      ...prev,
      sampleFeedbackHistory,
      previousSampleCards
    }))
    try {
      await handleGenerateSampleCards(state, {
        clarifiedContext: wizardState.clarifiedContext,
        previousSampleCards,
        sampleFeedback: feedback,
        sampleFeedbackHistory,
        keepSampleReview: true,
        clearSampleFeedbackOnSuccess: true
      })
    } catch (err) {
      setGenerationState(prev => ({
        ...prev,
        generating: false,
        stage: 'Sample regeneration failed',
        error: `Failed to regenerate samples: ${err.message}`,
        logs: [...prev.logs, `${new Date().toLocaleTimeString()} Failed to start sample regeneration: ${err.message}`]
      }))
    }
  }, [handleGenerateSampleCards, wizardState])

  const startIterativeGeneration = useCallback(async (state, progress, options = {}) => {
    setGenerationState(prev => ({
      ...prev,
      generating: true,
      stage: `Generating batch ${(progress.completedBatches || 0) + 1} of ${progress.maxBatches || 20}`,
      logs: prev.logs.length > 0
        ? [...prev.logs, `${new Date().toLocaleTimeString()} Starting iterative generation`]
        : [`${new Date().toLocaleTimeString()} Starting iterative generation`],
      error: null
    }))
    setWizardState(prev => ({ ...prev, step: 'generating_full', generationProgress: progress }))

    try {
      const { parsedText, charCount } = await resolveGenerationSource(state)
      const name = state.fileName || (state.filePath
        ? state.filePath.split('/').pop().split('\\').pop()
        : fileNameRef.current)
      const sourceState = { ...state, parsedText, charCount }
      const savedProject = await saveProjectSnapshot({
        nextCards: cardsRef.current,
        nextDescription: descriptionRef.current,
        progress,
        sourceState,
        charCount,
        name
      })
      setScreen(options.targetScreen || 'projects')
      const result = await window.ipc.invoke('start-iterative-generation', {
        projectId: savedProject.id,
        filePath: state.filePath,
        parsedText,
        contextPrompt: state.contextPrompt,
        cardFormat: state.cardFormat,
        generationProgress: progress
      })

      const finalProgress = result?.generationProgress || progress
      setWizardState(prev => ({ ...prev, generationProgress: finalProgress }))
      if (result?.status === 'done') {
        playSuccessChime()
        setGenerationState(prev => ({
          ...prev,
          generating: false,
          stage: `Generated ${cardsRef.current.length} cards`,
          logs: [...prev.logs, `${new Date().toLocaleTimeString()} Generation complete`],
          error: null
        }))
        setScreen('review')
      } else if (result?.status === 'capped') {
        setGenerationState(prev => ({
          ...prev,
          generating: false,
          stage: 'Generation reached batch cap',
          logs: [...prev.logs, `${new Date().toLocaleTimeString()} Reached batch cap`],
          error: null
        }))
      } else if (result?.status === 'shortfall') {
        const finalProgress = result?.generationProgress || progress
        const stats = generationGoalStats(finalProgress, cardsRef.current.length)
        setGenerationState(prev => ({
          ...prev,
          generating: false,
          stage: 'Generation shortfall',
          logs: [...prev.logs, `${new Date().toLocaleTimeString()} Generation ended at ${stats.currentCardCount} / ${stats.targetCardCount || 'unknown'} cards`],
          error: stats.targetCardCount
            ? `Generation ended below target: ${stats.currentCardCount} / ${stats.targetCardCount} cards.`
            : 'Generation ended below the requested target.'
        }))
      } else if (result?.status === 'failed') {
        setGenerationState(prev => ({
          ...prev,
          generating: false,
          stage: 'Generation failed',
          error: result.error || 'A generation batch failed. You can continue from the last successful batch.',
          logs: [...prev.logs, `${new Date().toLocaleTimeString()} Generation failed`]
        }))
      } else if (result?.status === 'stopped') {
        setGenerationState(prev => ({
          ...prev,
          generating: false,
          stage: 'Generation stopped',
          error: null
        }))
      }
    } catch (err) {
      setGenerationState(prev => ({
        ...prev,
        generating: false,
        stage: 'Generation failed',
        error: `Failed to generate cards: ${err.message}`,
        logs: [...prev.logs, `${new Date().toLocaleTimeString()} Failed: ${err.message}`]
      }))
    }
  }, [resolveGenerationSource, saveProjectSnapshot])

  const handleAcceptSamples = useCallback(async (state) => {
    const feedback = String(wizardState.sampleFeedback || '').trim()
    const sampleFeedbackHistory = feedback
      ? [...wizardState.sampleFeedbackHistory, feedback]
      : wizardState.sampleFeedbackHistory
    const acceptedSampleCards = mergeCardsUnique(wizardState.sampleCards)
    const progress = defaultIterativeProgress({
      clarifiedContext: wizardState.clarifiedContext,
      sampleFeedback: sampleFeedbackHistory.join('\n'),
      acceptedSampleCards
    })
    progress.currentCardCount = acceptedSampleCards.length
    progress.generationGoal = normalizeGenerationGoal(
      wizardState.generationGoal?.targetCardCount
        ? wizardState.generationGoal
        : extractGenerationGoalFromClarifications(wizardState.clarificationHistory)
    )
    progress.batchSize = generationSettings.batchSize
    progress.maxBatches = generationSettings.maxBatches
    progress.claudeCodeModel = generationSettings.claudeCodeModel
    progress.apiModel = generationSettings.apiModel
    const initialDescription = guidedInitialDescription({
      state,
      clarifiedContext: wizardState.clarifiedContext,
      acceptedSampleCards
    })
    let overviewDescription = initialDescription
    let generationStateLogs = [`${new Date().toLocaleTimeString()} Preparing full deck generation`]

    cardsRef.current = acceptedSampleCards
    descriptionRef.current = overviewDescription
    setCards(acceptedSampleCards)
    setDescription(overviewDescription)
    setGenerationState({
      generating: true,
      stage: 'Generating deck overview',
      logs: generationStateLogs,
      error: null
    })
    setWizardState(prev => ({
      ...prev,
      acceptedSampleCards,
      sampleFeedbackHistory,
      step: 'generating_full',
      generationProgress: progress
    }))
    setScreen('review')

    try {
      const { parsedText, charCount } = await resolveGenerationSource(state)
      if (!progress.generationGoal.targetCardCount) {
        progress.generationGoal = detectGenerationGoal({
          contextPrompt: state.contextPrompt,
          parsedText
        })
      }
      setWizardState(prev => ({
        ...prev,
        generationProgress: progress
      }))
      generationStateLogs = [...generationStateLogs, `${new Date().toLocaleTimeString()} Generating deck overview`]
      setGenerationState(prev => ({
        ...prev,
        logs: generationStateLogs
      }))
      const overview = await window.ipc.invoke('generate-deck-overview', {
        filePath: state.filePath,
        parsedText,
        contextPrompt: state.contextPrompt,
        cardFormat: state.cardFormat,
        clarifiedContext: wizardState.clarifiedContext,
        acceptedSampleCards,
        sampleFeedbackHistory
      })
      if (overview?.description) {
        overviewDescription = normalizeDescription(overview.description, initialDescription.title)
        descriptionRef.current = overviewDescription
        setDescription(overviewDescription)
        generationStateLogs = [...generationStateLogs, `${new Date().toLocaleTimeString()} Generated deck overview`]
        setGenerationState(prev => ({
          ...prev,
          logs: generationStateLogs
        }))
      }
      state = { ...state, parsedText, charCount }
    } catch (err) {
      generationStateLogs = [...generationStateLogs, `${new Date().toLocaleTimeString()} Deck overview fallback: ${err.message}`]
      setGenerationState(prev => ({
        ...prev,
        logs: generationStateLogs
      }))
    }
    await startIterativeGeneration(state, progress, { targetScreen: 'review' })
  }, [generationSettings, resolveGenerationSource, startIterativeGeneration, wizardState])

  const handleContinueGeneration = useCallback(async (state, options = {}) => {
    const current = wizardState.generationProgress
    if (!current || current.mode !== 'iterative') return
    const progress = {
      ...current,
      status: 'in_progress',
      duplicateKeys: mergeCardsUnique(cardsRef.current).map(cardDuplicateKey).filter(Boolean),
      currentCardCount: mergeCardsUnique(cardsRef.current).length
    }
    await startIterativeGeneration(state, progress, options)
  }, [startIterativeGeneration, wizardState.generationProgress])

  const handleStopIterativeGeneration = useCallback(async () => {
    if (!projectRef.current?.id) return
    await window.ipc.invoke('stop-iterative-generation', { projectId: projectRef.current.id })
    setGenerationState(prev => ({
      ...prev,
      stage: 'Stopping after current batch',
      logs: [...prev.logs, `${new Date().toLocaleTimeString()} Stop requested`]
    }))
  }, [])

  const handleCancelGeneration = useCallback(async () => {
    await window.ipc.invoke('cancel-generation')
    if (projectRef.current?.id) {
      await window.ipc.invoke('stop-iterative-generation', { projectId: projectRef.current.id })
    }
    setGenerationState(prev => ({
      ...prev,
      stage: 'Cancelling generation',
      logs: [...prev.logs, `${new Date().toLocaleTimeString()} Cancel requested`]
    }))
  }, [])

  const handleUploadComplete = (state) => {
    if (Array.isArray(state.cards)) {
      setCards(state.cards)
    }
    if (state.description) {
      setDescription(normalizeDescription(state.description, state.fileName || ''))
    }
    setUploadState(prev => ({
      ...prev,
      filePath: state.filePath || null,
      fileName: state.fileName || '',
      parsedText: state.parsedText || null,
      charCount: state.charCount || null,
      contextPrompt: state.contextPrompt || '',
      cardFormat: state.cardFormat || 'basic'
    }))
    const name = state.fileName || (state.filePath
      ? state.filePath.split('/').pop().split('\\').pop()
      : '')
    setFileName(name)
    setProject(null)
    setWizardState(defaultWizardState())
    setGenerationState({
      generating: false,
      stage: Array.isArray(state.cards) ? `Imported ${state.cards.length} cards` : '',
      logs: Array.isArray(state.cards) ? [`${new Date().toLocaleTimeString()} Imported JSON deck`] : [],
      error: null
    })
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
      cards: finalCards,
      generationProgress: wizardState.generationProgress || null
    })
    setProject(savedProject)
  }, [cards, description, fileName, project?.id, uploadState, wizardState.generationProgress])

  const handleNavigate = (target) => {
    if (target === 'upload' && screen !== 'upload') {
      const progressStatus = projectRef.current?.generationProgress?.status
      if (progressStatus && progressStatus !== 'done') {
        if (generationState.generating) {
          setScreen('review')
          return
        }
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
        setWizardState(defaultWizardState())
        cardsRef.current = []
        descriptionRef.current = defaultDescription()
        fileNameRef.current = ''
        projectRef.current = null
        wizardStateRef.current = defaultWizardState()
      }
    }
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

  const handleImportProject = useCallback(async (filePath, fileName) => {
    const imported = await window.ipc.invoke('import-cardify-json', filePath)
    const importedCards = Array.isArray(imported.cards) ? imported.cards : []
    const importedFileName = fileName || imported.fileName || (filePath
      ? filePath.split('/').pop().split('\\').pop()
      : '')
    const importedDescription = normalizeDescription(imported.description, importedFileName)
    const savedProject = await window.ipc.invoke('save-project', {
      title: importedDescription.title || importedFileName || 'Imported Cardify Project',
      description: importedDescription,
      filePath,
      fileName: importedFileName,
      parsedText: null,
      charCount: null,
      contextPrompt: '',
      cardFormat: imported.cardFormat || 'basic',
      cards: importedCards,
      generationProgress: null
    })

    loadProject(savedProject)
    setGenerationState({
      generating: false,
      stage: `Imported ${importedCards.length} ${importedCards.length === 1 ? 'card' : 'cards'}`,
      logs: [`${new Date().toLocaleTimeString()} Imported JSON project`],
      error: null
    })
    setScreen('review')
    return savedProject
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
    setWizardState(defaultWizardState())
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
          wizardState={wizardState}
          onStateChange={handleUploadStateChange}
          onGenerate={handleStartGuidedGeneration}
          onClarificationAnswerChange={handleClarificationAnswerChange}
          onSubmitClarification={handleSubmitClarification}
          onSampleCardUpdate={handleSampleCardUpdate}
          onSampleCardDelete={handleSampleCardDelete}
          onSampleFeedbackChange={handleSampleFeedbackChange}
          onRegenerateSamples={handleRegenerateSamples}
          onAcceptSamples={handleAcceptSamples}
          onContinueGeneration={handleContinueGeneration}
          onStopIterativeGeneration={handleStopIterativeGeneration}
          onCancelGeneration={handleCancelGeneration}
          onReviewPartialDeck={() => setScreen('review')}
          onComplete={handleUploadComplete}
          onOpenReview={() => setScreen('review')}
          onOpenProjects={() => handleNavigate('projects')}
        />
      )}
      {screen === 'projects' && (
        <Projects
          activeProjectId={project?.id}
          activeProject={project ? {
            ...project,
            cards,
            description,
            fileName,
            filePath: uploadState.filePath,
            parsedText: uploadState.parsedText,
            charCount: uploadState.charCount,
            contextPrompt: uploadState.contextPrompt,
            cardFormat: uploadState.cardFormat,
            generationProgress: wizardState.generationProgress || project.generationProgress || null
          } : null}
          onOpenProject={handleOpenProject}
          onNewProject={handleNewProject}
          onImportProject={handleImportProject}
        />
      )}
      {screen === 'settings' && (
        <Settings
          generationSettings={generationSettings}
          onGenerationSettingsChange={setGenerationSettings}
        />
      )}
      {screen === 'review' && (
        <Review
          cards={cards}
          description={description}
          fileName={fileName}
          sourceFilePath={uploadState.filePath}
          onProjectChange={handleProjectChange}
          generationProgress={wizardState.generationProgress || project?.generationProgress || null}
          continuingGeneration={generationState.generating}
          onContinueGeneration={() => handleContinueGeneration(uploadState, { targetScreen: 'review' })}
          onStopGeneration={handleStopIterativeGeneration}
          onBack={() => handleNavigate('projects')}
        />
      )}
    </div>
  )
}
