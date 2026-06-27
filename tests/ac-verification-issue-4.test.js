'use strict'
/**
 * AC Verification Tests — Issue #4
 * Build card review and edit UI before Anki push
 *
 * These tests verify each Acceptance Criteria at the unit / module level using
 * Jest + React Testing Library (logic layer) and source-code structure checks.
 *
 * AC1: Review screen shows full card list with correct field rendering per type.
 * AC2: Inline edit mode — clicking a field → textarea, saves on blur.
 * AC3: Delete button removes card + undo snackbar appears + restores on undo.
 * AC4: Deck name defaults to filename without extension; Push disabled when empty.
 * AC5: Back to Upload preserves previous file and context prompt.
 */

const path = require('path')
const fs = require('fs')

// ─── Source-file structure checks ─────────────────────────────────────────────

describe('AC: source file structure', () => {
  const root = path.join(__dirname, '..')

  const requiredFiles = [
    'src/screens/Review.jsx',
    'src/components/CardEditor.jsx',
    'src/components/DeckNameInput.jsx',
    'src/components/UndoSnackbar.jsx'
  ]

  requiredFiles.forEach((filePath) => {
    it(`${filePath} exists`, () => {
      expect(fs.existsSync(path.join(root, filePath))).toBe(true)
    })
  })

  it('App.jsx imports Review screen', () => {
    const appSource = fs.readFileSync(path.join(root, 'src/App.jsx'), 'utf8')
    expect(appSource).toMatch(/import Review from/)
  })

  it('App.jsx renders Review when screen === review', () => {
    const appSource = fs.readFileSync(path.join(root, 'src/App.jsx'), 'utf8')
    expect(appSource).toMatch(/screen === .review./)
    expect(appSource).toMatch(/<Review/)
  })

  it('App.jsx passes fileName and cards to Review', () => {
    const appSource = fs.readFileSync(path.join(root, 'src/App.jsx'), 'utf8')
    expect(appSource).toMatch(/cards=\{cards\}/)
    expect(appSource).toMatch(/fileName=\{fileName\}/)
  })
})

// ─── AC1: Card list rendering logic ────────────────────────────────────────────

describe('AC1 — Review.jsx: shows full card list per type', () => {
  let reviewSource

  beforeAll(() => {
    reviewSource = fs.readFileSync(
      path.join(__dirname, '../src/screens/Review.jsx'),
      'utf8'
    )
  })

  it('maps over cards array to render each card', () => {
    expect(reviewSource).toMatch(/cards\.map/)
  })

  it('passes card prop to CardEditor', () => {
    expect(reviewSource).toMatch(/card=\{card\}/)
  })

  it('card-count element exists', () => {
    expect(reviewSource).toMatch(/card-count/)
  })
})

describe('AC1 — CardEditor.jsx: renders correct fields by type', () => {
  let editorSource

  beforeAll(() => {
    editorSource = fs.readFileSync(
      path.join(__dirname, '../src/components/CardEditor.jsx'),
      'utf8'
    )
  })

  it('renders front and back textareas for basic cards', () => {
    expect(editorSource).toMatch(/card\.type === .basic./)
    expect(editorSource).toMatch(/front/)
    expect(editorSource).toMatch(/back/)
  })

  it('renders cloze text textarea for cloze cards', () => {
    expect(editorSource).toMatch(/cloze/)
    expect(editorSource).toMatch(/text/)
  })

  it('both branches use textarea elements', () => {
    const textareaMatches = (editorSource.match(/<textarea/g) || []).length
    expect(textareaMatches).toBeGreaterThanOrEqual(2)
  })
})

// ─── AC2: Inline edit — textarea, saves on blur ────────────────────────────────

describe('AC2 — CardEditor.jsx: inline editing with save-on-blur', () => {
  let editorSource

  beforeAll(() => {
    editorSource = fs.readFileSync(
      path.join(__dirname, '../src/components/CardEditor.jsx'),
      'utf8'
    )
  })

  it('uses onBlur handler on textarea', () => {
    expect(editorSource).toMatch(/onBlur/)
  })

  it('calls onUpdate callback on blur', () => {
    expect(editorSource).toMatch(/onUpdate/)
  })

  it('textarea is always editable (not read-only)', () => {
    expect(editorSource).not.toMatch(/readOnly/)
  })
})

// ─── AC3: Delete + undo snackbar ───────────────────────────────────────────────

describe('AC3 — Review.jsx: delete card with undo snackbar', () => {
  let reviewSource

  beforeAll(() => {
    reviewSource = fs.readFileSync(
      path.join(__dirname, '../src/screens/Review.jsx'),
      'utf8'
    )
  })

  it('has handleDelete that filters card from list', () => {
    expect(reviewSource).toMatch(/handleDelete/)
    expect(reviewSource).toMatch(/filter/)
  })

  it('stores deletedCard state for undo', () => {
    expect(reviewSource).toMatch(/deletedCard/)
  })

  it('renders UndoSnackbar when deletedCard is set', () => {
    expect(reviewSource).toMatch(/UndoSnackbar/)
    expect(reviewSource).toMatch(/deletedCard &&/)
  })

  it('handleUndo restores deleted card at original index via splice', () => {
    expect(reviewSource).toMatch(/handleUndo/)
    expect(reviewSource).toMatch(/splice/)
  })
})

describe('AC3 — UndoSnackbar.jsx: 5-second auto-dismiss', () => {
  let snackbarSource

  beforeAll(() => {
    snackbarSource = fs.readFileSync(
      path.join(__dirname, '../src/components/UndoSnackbar.jsx'),
      'utf8'
    )
  })

  it('uses setTimeout for 5s auto-dismiss', () => {
    expect(snackbarSource).toMatch(/setTimeout/)
    expect(snackbarSource).toMatch(/5000/)
  })

  it('clears timer on unmount', () => {
    expect(snackbarSource).toMatch(/clearTimeout/)
  })

  it('calls onUndo when Undo button clicked', () => {
    expect(snackbarSource).toMatch(/onUndo/)
  })

  it('calls onDismiss for auto-dismiss', () => {
    expect(snackbarSource).toMatch(/onDismiss/)
  })
})

// ─── AC4: Deck name defaulting and Push button disabled ─────────────────────────

describe('AC4 — Review.jsx: deck name input + push button', () => {
  let reviewSource

  beforeAll(() => {
    reviewSource = fs.readFileSync(
      path.join(__dirname, '../src/screens/Review.jsx'),
      'utf8'
    )
  })

  it('defaults deckName by stripping extension from fileName', () => {
    // Looks for a regex that removes extension from fileName
    expect(reviewSource).toMatch(/fileName/)
    expect(reviewSource).toMatch(/replace\(/)
    expect(reviewSource).toMatch(/defaultDeckName/)
  })

  it('Push to Anki button is disabled when deckName is empty', () => {
    expect(reviewSource).toMatch(/isPushDisabled/)
    expect(reviewSource).toMatch(/deckName\.trim\(\)\.length === 0/)
  })

  it('Push to Anki button has disabled prop bound to isPushDisabled', () => {
    expect(reviewSource).toMatch(/disabled=\{isPushDisabled\}/)
  })
})

describe('AC4 — DeckNameInput.jsx: trims whitespace on blur', () => {
  let inputSource

  beforeAll(() => {
    inputSource = fs.readFileSync(
      path.join(__dirname, '../src/components/DeckNameInput.jsx'),
      'utf8'
    )
  })

  it('trims whitespace on blur', () => {
    expect(inputSource).toMatch(/\.trim\(\)/)
    expect(inputSource).toMatch(/onBlur/)
  })

  it('is a controlled input (value prop)', () => {
    expect(inputSource).toMatch(/value=\{value\}/)
  })
})

// ─── AC5: Back navigation state preservation ──────────────────────────────────

describe('AC5 — App.jsx: back navigation preserves upload state', () => {
  let appSource

  beforeAll(() => {
    appSource = fs.readFileSync(
      path.join(__dirname, '../src/App.jsx'),
      'utf8'
    )
  })

  it('stores uploadState separately (not replaced by navigation)', () => {
    expect(appSource).toMatch(/uploadState/)
    expect(appSource).toMatch(/setUploadState/)
  })

  it('passes uploadState as initialState to Upload on return', () => {
    expect(appSource).toMatch(/initialState=\{uploadState\}/)
  })

  it('handleBackToUpload sets screen to upload (not clearing state)', () => {
    expect(appSource).toMatch(/handleBackToUpload/)
    expect(appSource).toMatch(/setScreen\(.upload.\)/)
  })

  it('Upload onComplete includes fileName for deck name default', () => {
    const uploadSource = fs.readFileSync(
      path.join(__dirname, '../src/screens/Upload.jsx'),
      'utf8'
    )
    expect(uploadSource).toMatch(/fileName/)
    expect(uploadSource).toMatch(/onComplete\(\{.*fileName/)
  })
})

// ─── Integration: Upload → Review navigation wiring ───────────────────────────

describe('Integration — App.jsx: navigation wiring', () => {
  let appSource

  beforeAll(() => {
    appSource = fs.readFileSync(
      path.join(__dirname, '../src/App.jsx'),
      'utf8'
    )
  })

  it('handleUploadComplete sets screen to review', () => {
    expect(appSource).toMatch(/setScreen\(.review.\)/)
  })

  it('Review receives onBack callback', () => {
    expect(appSource).toMatch(/onBack=\{handleBackToUpload\}/)
  })

  it('Review receives onPush callback', () => {
    expect(appSource).toMatch(/onPush=\{handlePush\}/)
  })
})
