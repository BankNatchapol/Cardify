'use strict'

const fs = require('fs')
const path = require('path')

function read (relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8')
}

describe('guided generation flow wiring', () => {
  test('App stores wizard state and calls clarification/sample/full generation IPCs', () => {
    const app = read('src/App.jsx')

    expect(app).toContain('function defaultWizardState')
    expect(app).toContain('clarificationQuestions')
    expect(app).toContain('acceptedSampleCards')
    expect(app).toContain("window.ipc.invoke('prepare-generation'")
    expect(app).toContain("window.ipc.invoke('generate-sample-cards'")
    expect(app).toContain("window.ipc.invoke('generate-deck-overview'")
    expect(app).toContain("window.ipc.invoke('start-iterative-generation'")
    expect(app).toContain('defaultIterativeProgress')
    expect(app).toContain('acceptedSampleCards')
    expect(app).toContain("sampleFeedback: sampleFeedbackHistory.join('\\n')")
    expect(app).toContain('sampleFeedbackHistory')
    expect(app).toContain('previousSampleCards')
  })

  test('Upload starts guided generation and renders editable sample cards', () => {
    const upload = read('src/screens/Upload.jsx')

    expect(upload).toContain("import CardEditor from '../components/CardEditor'")
    expect(upload).toContain('Start Guided Generation')
    expect(upload).toContain('Guided generation')
    expect(upload).toContain('Continue to Samples')
    expect(upload).toContain('Regenerate Samples')
    expect(upload).toContain('Accept & Generate Full Deck')
    expect(upload).toContain('Continue Generation')
    expect(upload).toContain('Stop and Review')
    expect(upload).toContain('Review Partial Deck')
    expect(upload).toContain('Max cards')
    expect(upload).toContain('<CardEditor')
  })

  test('Projects opens rows and Review owns resumable generation actions', () => {
    const app = read('src/App.jsx')
    const projects = read('src/screens/Projects.jsx')
    const review = read('src/screens/Review.jsx')

    expect(app).toContain("setScreen('review')")
    expect(app).toContain('activeProject={project ?')
    expect(app).toContain("onBack={() => handleNavigate('projects')}")
    expect(app).toContain("onContinueGeneration={() => handleContinueGeneration(uploadState, { targetScreen: 'review' })}")
    expect(projects).toContain('projectProgressStatus')
    expect(projects).toContain('role="button"')
    expect(projects).toContain('onOpenProject(rowProject)')
    expect(projects).toContain('event.stopPropagation()')
    expect(review).toContain('Continue Generation')
    expect(review).toContain('Stop and Review')
    expect(review).toContain('project-generation-grid')
    expect(review).toContain('Max cards')
    expect(review).toContain('latestCoverage.batchSummary')
    expect(review).toContain('Remaining focus:')
    expect(review).toContain('aria-label="Back to Projects"')
    expect(review).toContain('Back')
  })

  test('deck overview is generated once before iterative batches and batch updates keep it stable', () => {
    const app = read('src/App.jsx')
    const claude = read('src/lib/claude.js')
    const claudeCode = read('src/lib/claudeCode.js')

    expect(app).toContain("window.ipc.invoke('generate-deck-overview'")
    expect(app).toContain('descriptionRef.current = overviewDescription')
    expect(app).toContain('const nextDescription = descriptionRef.current')
    expect(app).not.toContain('normalizeDescription(payload.description')
    expect(claude).toContain('Do not return deck title or deck description')
    expect(claudeCode).toContain('Do not return deck title or deck description')
  })

  test('guided full-deck generation seeds the project overview before the first batch returns', () => {
    const app = read('src/App.jsx')

    expect(app).toContain('function guidedInitialDescription')
    expect(app).toContain('purpose = String(clarifiedContext || state.contextPrompt || \'\').trim()')
    expect(app).toContain('contents = [...new Set(')
    expect(app).toContain('const initialDescription = guidedInitialDescription')
    expect(app).toContain('let overviewDescription = initialDescription')
    expect(app).toContain('setDescription(overviewDescription)')
  })

  test('Upload keeps undo shortcuts local inside guided textareas', () => {
    const upload = read('src/screens/Upload.jsx')

    expect(upload).toContain('function stopWizardUndoShortcut')
    expect(upload).toContain("key === 'z'")
    expect(upload).toContain('function stopWizardHistoryUndo')
    expect(upload).toContain('onKeyDown={stopWizardUndoShortcut}')
    expect(upload).toContain('onBeforeInput={stopWizardHistoryUndo}')
  })

  test('Upload renders clarification question markdown as inline HTML', () => {
    const upload = read('src/screens/Upload.jsx')

    expect(upload).toContain('function renderInlineQuestionMarkdown')
    expect(upload).toContain('<strong>$1</strong>')
    expect(upload).toContain('<MarkdownQuestionLabel question={question} />')
  })

  test('Electron exposes guided generation IPC channels', () => {
    const main = read('electron/main.js')
    const preload = read('electron/preload.js')

    expect(main).toContain("ipcMain.handle('prepare-generation'")
    expect(main).toContain("ipcMain.handle('generate-sample-cards'")
    expect(main).toContain("ipcMain.handle('generate-deck-overview'")
    expect(main).toContain("ipcMain.handle('start-iterative-generation'")
    expect(main).toContain("ipcMain.handle('stop-iterative-generation'")
    expect(main).toContain("event.sender.send('generation-batch'")
    expect(main).toContain('function sampleParseErrorResponse')
    expect(main).toContain('Claude returned sample cards in a format Cardify could not read')
    expect(main).toContain('debugId')
    expect(main).toContain('function fallbackClarificationResponse')
    expect(main).toContain('function contextMentionsLanguagePreference')
    expect(main).toContain('What language or mix of languages should Cardify use')
    expect(main).toContain('if (answered > 0)')
    expect(main).toContain("result?.error === 'generation-parse-error'")
    expect(preload).toContain("'prepare-generation'")
    expect(preload).toContain("'generate-sample-cards'")
    expect(preload).toContain("'generate-deck-overview'")
    expect(preload).toContain("'start-iterative-generation'")
    expect(preload).toContain("'stop-iterative-generation'")
    expect(preload).toContain('onGenerationBatch')
    expect(preload).toContain('offGenerationBatch')
  })

  test('App clears wizard state when guided preparation fails', () => {
    const app = read('src/App.jsx')

    expect(app).toContain('setWizardState(defaultWizardState())')
    expect(app).toContain("stage: 'Guided generation failed'")
  })

  test('App moves to samples when clarification questions repeat after answers', () => {
    const app = read('src/App.jsx')

    expect(app).toContain('function hasNewClarificationQuestions')
    expect(app).toContain("result.status === 'questions' && hasNewClarificationQuestions")
    expect(app).toContain('clarificationContextFromHistory')
    expect(app).toContain("clarificationHistory: history,\n      step: 'sampling'")
  })

  test('App keeps regeneration guidance separate from accepted sample cards', () => {
    const app = read('src/App.jsx')
    const upload = read('src/screens/Upload.jsx')
    const main = read('electron/main.js')
    const preload = read('electron/preload.js')

    expect(app).toContain('previousSampleCards = mergeCardsUnique')
    expect(app).toContain('sampleFeedbackHistory.join')
    expect(app).toContain('const acceptedSampleCards = mergeCardsUnique(wizardState.sampleCards)')
    expect(app).toContain('clearSampleFeedbackOnSuccess')
    expect(app).toContain('keepSampleReview: true')
    expect(app).toContain('sampleFeedback: feedback')
    expect(app).toContain("stage: 'Sample regeneration failed'")
    expect(app).toContain("stage: 'Regenerating sample cards'")
    expect(app).toContain("step: options.keepSampleReview ? 'sample_review' : 'sampling'")
    expect(app).toContain("step: prev.sampleCards.length > 0 ? 'sample_review' : prev.step")
    expect(upload).toContain('Feedback for the next generation')
    expect(upload).toContain('onPointerDown')
    expect(upload).toContain('handleRegenerateSamples')
    expect(upload).toContain('Regenerating sample cards')
    expect(upload).toContain('Regenerating...')
    expect(upload).toContain('sampleReviewRef.current?.scrollIntoView')
    expect(upload).toContain('Cancel Generation')
    expect(app).toContain("window.ipc.invoke('cancel-generation')")
    expect(main).toContain("ipcMain.handle('cancel-generation'")
    expect(preload).toContain("'cancel-generation'")
  })
})
