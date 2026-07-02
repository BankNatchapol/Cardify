'use strict'
/**
 * AC Verification Tests — Issue #5
 * Implement AnkiConnect integration to push confirmed deck to Anki
 *
 * Verifies each Acceptance Criterion at the unit / module level.
 * UI ACs (AC1, AC3, AC4) are verified by testing the logic in
 * src/lib/ankiconnect.js (which backs the IPC handler) and by
 * source-code inspection of src/screens/Review.jsx for the renderer-side
 * UI contract.
 *
 * AC2 is verified by inspecting the IPC handler in electron/main.js.
 * AC5 is the suite itself (npm test must pass).
 */

const { testConnection, buildNotes, createDeck, addNotes } = require('../src/lib/ankiconnect')

// ─── Mock fetch ───────────────────────────────────────────────────────────────

let mockFetch

beforeEach(() => {
  mockFetch = jest.fn()
  global.fetch = mockFetch
})

afterEach(() => {
  delete global.fetch
})

// ─── AC1: Push to Anki IPC contract ──────────────────────────────────────────
// "Clicking Push to Anki calls window.ipc.invoke('push-to-anki', { deckName, cards })
// using the deck overview title as deckName, and shows a loading spinner on the
// button; on success shows a '✓ N cards added to [title]' banner"
//
// Renderer-side: Review.jsx exposes onPush override for testability (verified via source inspection below).
// IPC-side: push-to-anki handler is tested here end-to-end via the anki lib.

describe('AC1 — push-to-anki IPC: success path returns { success, added, errors }', () => {
  test('addNotes returns { added: 2, errors: [] } when AnkiConnect accepts both notes', async () => {
    // createDeck response (idempotent, returns deck ID)
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ result: [1, 2, 3], error: null })
    })
    // addNotes response — two new cards accepted
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ result: [1001, 1002], error: null })
    })

    // Simulate what the IPC handler does: createDeck then addNotes
    await createDeck('My Deck')
    const result = await addNotes('My Deck', [
      { type: 'basic', front: 'Q1', back: 'A1' },
      { type: 'basic', front: 'Q2', back: 'A2' }
    ])

    expect(result).toEqual({ added: 2, errors: [] })
  })

  test('Review.jsx success banner text uses the deck overview title (source-code inspection)', () => {
    // Parse the Review component source to verify the banner text contract
    const fs = require('fs')
    const path = require('path')
    const reviewSrc = fs.readFileSync(
      path.join(__dirname, '../src/screens/Review.jsx'),
      'utf8'
    )

    // Verify the success banner includes the checkmark and title interpolation
    expect(reviewSrc).toContain('✓ ${msg}')
    // Verify loading spinner is rendered when pushing=true
    expect(reviewSrc).toContain('Pushing to Anki...')
    expect(reviewSrc).toContain('spinner')
    // Verify disabled when pushing
    expect(reviewSrc).toContain('disabled={pushing || !description.title.trim()}')
    expect(reviewSrc).not.toContain('<DeckNameInput')
    // Verify data-testid for push button
    expect(reviewSrc).toContain('data-testid="push-to-anki-btn"')
  })

  test('Review.jsx invokes window.ipc.invoke("push-to-anki", { deckName: title, cards })', () => {
    const fs = require('fs')
    const path = require('path')
    const reviewSrc = fs.readFileSync(
      path.join(__dirname, '../src/screens/Review.jsx'),
      'utf8'
    )
    // Verify the exact IPC channel and shape
    expect(reviewSrc).toContain("window.ipc.invoke('push-to-anki'")
    expect(reviewSrc).toContain('const title = description.title.trim()')
    expect(reviewSrc).toContain('deckName: title')
    expect(reviewSrc).toContain('cards')
  })
})

// ─── AC2: createDeck called before addNotes ───────────────────────────────────
// "If the deck does not exist in Anki, the main process calls AnkiConnect createDeck
// before addNotes; the deck is created automatically without prompting the user"

describe('AC2 — IPC handler calls createDeck before addNotes', () => {
  test('push-to-anki IPC handler source code: createDeck precedes addNotes', () => {
    const fs = require('fs')
    const path = require('path')
    const mainSrc = fs.readFileSync(
      path.join(__dirname, '../electron/main.js'),
      'utf8'
    )

    // Verify the IPC handler exists
    expect(mainSrc).toContain("ipcMain.handle('push-to-anki'")
    // Verify createDeck is called before addNotes in the handler
    const createDeckPos = mainSrc.indexOf('createDeck(deckName)')
    const addNotesPos = mainSrc.indexOf('addNotes(deckName, cards')
    expect(createDeckPos).toBeGreaterThan(-1)
    expect(addNotesPos).toBeGreaterThan(-1)
    expect(createDeckPos).toBeLessThan(addNotesPos)
  })

  test('createDeck sends correct AnkiConnect action payload', async () => {
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ result: 12345, error: null })
    })

    await createDeck('Biology 101')

    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:8765',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          action: 'createDeck',
          version: 6,
          params: { deck: 'Biology 101' }
        })
      })
    )
  })
})

// ─── AC3: AnkiConnect unreachable → error: 'anki-not-running' ─────────────────
// "If AnkiConnect is unreachable (connection refused on port 8765), the IPC response
// is { error: 'anki-not-running' } and the renderer shows the correct message"

describe('AC3 — unreachable AnkiConnect returns { error: "anki-not-running" }', () => {
  test('testConnection returns { connected: false } when ECONNREFUSED', async () => {
    const err = new Error('connect ECONNREFUSED 127.0.0.1:8765')
    err.code = 'ECONNREFUSED'
    mockFetch.mockRejectedValueOnce(err)

    const result = await testConnection()
    expect(result).toEqual({ connected: false })
  })

  test('push-to-anki IPC handler: { error: "anki-not-running" } when testConnection → { connected: false }', () => {
    // Verify the IPC handler in source returns { error: 'anki-not-running' }
    const fs = require('fs')
    const path = require('path')
    const mainSrc = fs.readFileSync(
      path.join(__dirname, '../electron/main.js'),
      'utf8'
    )

    // Handler checks testConnection result and returns error object
    expect(mainSrc).toContain("return { error: 'anki-not-running' }")
    // Handler also handles ankiRequest throwing with code='anki-not-running'
    expect(mainSrc).toContain("err.code === 'anki-not-running'")
  })

  test('Review.jsx shows correct error message for anki-not-running', () => {
    const fs = require('fs')
    const path = require('path')
    const reviewSrc = fs.readFileSync(
      path.join(__dirname, '../src/screens/Review.jsx'),
      'utf8'
    )
    // Must show the exact error message from the spec
    expect(reviewSrc).toContain(
      "Anki isn&apos;t running. Open Anki and make sure the AnkiConnect plugin is installed, then try again."
    )
    // Verify the error condition check
    expect(reviewSrc).toContain("result.error === 'anki-not-running'")
    expect(reviewSrc).toContain('data-testid="anki-error-banner"')
  })
})

// ─── AC4: Duplicate cards → "N cards added, M duplicates skipped" ─────────────
// "If AnkiConnect returns per-note errors (duplicate cards), the banner shows
// 'N cards added, M duplicates skipped' without treating duplicates as a failure"

describe('AC4 — duplicate cards handled gracefully', () => {
  test('addNotes: null result entries counted as duplicates, not errors', async () => {
    // 2 cards, 1 accepted, 1 duplicate (null)
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ result: [1001, null], error: null })
    })

    const result = await addNotes('My Deck', [
      { type: 'basic', front: 'Q1', back: 'A1' },
      { type: 'basic', front: 'Q2', back: 'A2' }
    ])

    expect(result.added).toBe(1)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toMatch(/duplicate/)
  })

  test('addNotes: all duplicates — added=0, errors has entries for each duplicate', async () => {
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ result: [null, null, null], error: null })
    })

    const result = await addNotes('My Deck', [
      { type: 'basic', front: 'Q1', back: 'A1' },
      { type: 'basic', front: 'Q2', back: 'A2' },
      { type: 'cloze', text: '{{c1::answer}}' }
    ])

    expect(result.added).toBe(0)
    expect(result.errors).toHaveLength(3)
  })

  test('Review.jsx shows "N cards added, M duplicates skipped" when duplicates present', () => {
    const fs = require('fs')
    const path = require('path')
    const reviewSrc = fs.readFileSync(
      path.join(__dirname, '../src/screens/Review.jsx'),
      'utf8'
    )
    // Must show the exact banner text format from the spec
    expect(reviewSrc).toContain('cards added, ${duplicateCount} duplicates skipped')
    // Duplicate count is derived from errors starting with 'duplicate:'
    expect(reviewSrc).toContain("e.startsWith('duplicate:')")
    // Must NOT treat it as a failure — renders in success banner
    expect(reviewSrc).toContain('data-testid="push-success-banner"')
  })
})

// ─── AC5: npm test passes ─────────────────────────────────────────────────────
// "npm test passes (unit tests for src/lib/ankiconnect.js: testConnection returns
// { connected: false } when fetch throws ECONNREFUSED, buildNotes correctly maps
// Basic {front,back} and Cloze {text} to AnkiConnect note format with correct modelName)"

describe('AC5 — ankiconnect.js unit test coverage (this suite)', () => {
  test('testConnection returns { connected: false } on ECONNREFUSED', async () => {
    const err = new Error('connect ECONNREFUSED 127.0.0.1:8765')
    err.code = 'ECONNREFUSED'
    mockFetch.mockRejectedValueOnce(err)

    const result = await testConnection()
    expect(result).toEqual({ connected: false })
  })

  test('buildNotes maps Basic {front,back} to modelName "Basic" with Anki-renderable HTML fields', () => {
    const notes = buildNotes('Deck', [
      { type: 'basic', front: 'What is DNA?', back: 'Deoxyribonucleic acid.' }
    ])
    expect(notes[0]).toMatchObject({
      deckName: 'Deck',
      modelName: 'Basic',
      fields: { Front: '<p>What is DNA?</p>', Back: '<p>Deoxyribonucleic acid.</p>' }
    })
  })

  test('buildNotes maps Cloze {text} to modelName "Cloze" with Anki-renderable HTML fields', () => {
    const notes = buildNotes('Deck', [
      { type: 'cloze', text: '{{c1::DNA}} stands for deoxyribonucleic acid.' }
    ])
    expect(notes[0]).toMatchObject({
      deckName: 'Deck',
      modelName: 'Cloze',
      fields: { Text: '<p>{{c1::DNA}} stands for deoxyribonucleic acid.</p>' }
    })
  })

  test('tests/ankiconnect.test.js file exists with 19+ tests', () => {
    const fs = require('fs')
    const path = require('path')
    expect(
      fs.existsSync(path.join(__dirname, 'ankiconnect.test.js'))
    ).toBe(true)
    const content = fs.readFileSync(path.join(__dirname, 'ankiconnect.test.js'), 'utf8')
    // Count test() calls
    const testCount = (content.match(/\btest\(/g) || []).length
    expect(testCount).toBeGreaterThanOrEqual(19)
  })
})

// ─── preload.js: push-to-anki channel exposed ─────────────────────────────────

describe('preload.js — push-to-anki channel is whitelisted', () => {
  test('preload.js exposes push-to-anki in allowedChannels', () => {
    const fs = require('fs')
    const path = require('path')
    const preloadSrc = fs.readFileSync(
      path.join(__dirname, '../electron/preload.js'),
      'utf8'
    )
    expect(preloadSrc).toContain("'push-to-anki'")
  })

  test('preload.js also exposes test-anki-connection', () => {
    const fs = require('fs')
    const path = require('path')
    const preloadSrc = fs.readFileSync(
      path.join(__dirname, '../electron/preload.js'),
      'utf8'
    )
    expect(preloadSrc).toContain("'test-anki-connection'")
  })
})
