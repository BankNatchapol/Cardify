import * as FileSystem from 'expo-file-system'
import { getDatabase } from './database'
import { buildReviewQueue, flattenReviewQueue, review, reviewWithFsrs } from '../../../packages/scheduler/src'
import type { CardState, ReviewRating } from '../../../packages/shared/src/types'

export type DeckDescription = {
  title?: string
  purpose?: string
  contents?: string[]
} | string | null

export type MobileDeck = {
  id: string
  name: string          // raw DB name (may be a hash)
  displayName: string   // description.title ?? name
  description?: DeckDescription
  packageId?: string
  newCount: number
  learningCount: number
  reviewCount: number
}

export type MobileCard = {
  id: string
  noteId: string
  deckId: string
  front: string
  back: string
  state: CardState
  dueAt?: string | null
  intervalDays: number
  stability?: number | null
  difficulty?: number | null
  reps: number
  lapses: number
  suspended: number
}

export async function listDecks (): Promise<MobileDeck[]> {
  const db = await getDatabase()
  const decks = await db.getAllAsync<any>('SELECT * FROM decks ORDER BY updated_at DESC')
  const now = new Date().toISOString()
  return Promise.all(decks.map(async deck => {
    const counts = await db.getFirstAsync<any>(`
      SELECT
        SUM(CASE WHEN state = 'new' AND suspended = 0 THEN 1 ELSE 0 END) AS newCount,
        SUM(CASE WHEN state IN ('learning', 'relearning') AND suspended = 0 AND (due_at IS NULL OR due_at <= ?) THEN 1 ELSE 0 END) AS learningCount,
        SUM(CASE WHEN state = 'review' AND suspended = 0 AND (due_at IS NULL OR due_at <= ?) THEN 1 ELSE 0 END) AS reviewCount
      FROM cards
      WHERE deck_id = ?
    `, [now, now, deck.id])
    const description = parseJson(deck.description_json) as DeckDescription
    const title = description && typeof description === 'object' && !Array.isArray(description) ? description.title : undefined
    return {
      id: deck.id,
      name: deck.name,
      displayName: title || deck.name,
      description,
      packageId: deck.package_id,
      newCount: Number(counts?.newCount || 0),
      learningCount: Number(counts?.learningCount || 0),
      reviewCount: Number(counts?.reviewCount || 0)
    }
  }))
}

export async function getDeck (deckId: string) {
  const db = await getDatabase()
  const deck = await db.getFirstAsync<any>('SELECT * FROM decks WHERE id = ?', [deckId])
  if (!deck) return null
  const description = parseJson(deck.description_json) as DeckDescription
  const title = description && typeof description === 'object' && !Array.isArray(description) ? description.title : undefined
  return {
    id: deck.id,
    name: deck.name,
    displayName: title || deck.name,
    description,
    packageId: deck.package_id,
  }
}

export async function updateDeck (deckId: string, name: string, description?: string) {
  const db = await getDatabase()
  const now = Date.now()
  await db.runAsync(
    'UPDATE decks SET name = ?, description_json = ?, updated_at = ? WHERE id = ?',
    [name.trim(), description ? JSON.stringify(description) : null, now, deckId]
  )
}

export async function deleteDeck (deckId: string) {
  const db = await getDatabase()
  await db.runAsync('DELETE FROM decks WHERE id = ?', [deckId])
  const audioDir = `${FileSystem.documentDirectory}audio/${deckId}/`
  await FileSystem.deleteAsync(audioDir, { idempotent: true })
}

export async function updateDeckOptions (deckId: string, options: { dailyNewLimit: number; dailyReviewLimit: number }) {
  const db = await getDatabase()
  await db.runAsync(
    `INSERT INTO deck_options (deck_id, daily_new_limit, daily_review_limit) VALUES (?, ?, ?)
     ON CONFLICT(deck_id) DO UPDATE SET daily_new_limit = excluded.daily_new_limit, daily_review_limit = excluded.daily_review_limit`,
    [deckId, options.dailyNewLimit, options.dailyReviewLimit]
  )
}

export async function resetDeckLearningProgress (deckId: string) {
  const db = await getDatabase()
  const now = new Date().toISOString()
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE cards SET state = 'new', due_at = NULL, interval_days = 0, stability = NULL, difficulty = NULL, reps = 0, lapses = 0, updated_at = ? WHERE deck_id = ?`,
      [now, deckId]
    )
    await db.runAsync('DELETE FROM review_logs WHERE deck_id = ?', [deckId])
  })
}

export async function shuffleDeck (deckId: string) {
  const db = await getDatabase()
  const rows = await db.getAllAsync<{ id: string }>("SELECT id FROM cards WHERE deck_id = ? AND state = 'new'", [deckId])
  const ids = rows.map(r => r.id)
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
  }
  await db.withTransactionAsync(async () => {
    for (let i = 0; i < ids.length; i++) {
      await db.runAsync('UPDATE cards SET study_order = ? WHERE id = ?', [i, ids[i]])
    }
  })
}

export async function listCards (deckId: string, query = ''): Promise<MobileCard[]> {
  const db = await getDatabase()
  const like = `%${query.trim()}%`
  const rows = query.trim()
    ? await db.getAllAsync<any>('SELECT * FROM cards WHERE deck_id = ? AND (front LIKE ? OR back LIKE ?) ORDER BY updated_at DESC', [deckId, like, like])
    : await db.getAllAsync<any>('SELECT * FROM cards WHERE deck_id = ? ORDER BY updated_at DESC', [deckId])
  return rows.map(rowToCard)
}

export async function getNextStudyCard (deckId: string): Promise<MobileCard | null> {
  const db = await getDatabase()
  const options = await getDeckOptions(deckId)
  const rows = await db.getAllAsync<any>('SELECT * FROM cards WHERE deck_id = ? ORDER BY study_order ASC, rowid ASC', [deckId])
  const queue = buildReviewQueue(rows.map(rowToSchedulerCard), new Date(), options)
  const [next] = flattenReviewQueue(queue)
  return next ? rowToCard(rows.find(row => row.id === next.id)) : null
}

// Used to open Study directly on a specific card (e.g. tapping the Lock
// Screen widget, which shows one particular card) instead of whatever the
// normal due-order queue would pick first. Rating it afterward goes through
// the same rateCard()/scheduler path as any other card — showing it first
// is purely a selection choice, it doesn't change how it's scheduled.
export async function getCardById (cardId: string): Promise<MobileCard | null> {
  const db = await getDatabase()
  const row = await db.getFirstAsync<any>('SELECT * FROM cards WHERE id = ?', [cardId])
  return row ? rowToCard(row) : null
}

// Cards for the Lock Screen widget: cards the user isn't good at yet
// (learning/relearning) take priority; if there are none, fall back to a
// genuinely random sample of the deck rather than a lapses-sorted list, so
// a mastered deck doesn't always surface the same "hardest" cards.
export async function getWidgetCandidateCards (deckId: string, limit = 20): Promise<MobileCard[]> {
  const db = await getDatabase()
  const priority = await db.getAllAsync<any>(
    `SELECT * FROM cards WHERE deck_id = ? AND suspended = 0 AND state IN ('learning', 'relearning')
     ORDER BY lapses DESC, due_at ASC LIMIT ?`,
    [deckId, limit]
  )
  if (priority.length > 0) return priority.map(rowToCard)
  const random = await db.getAllAsync<any>(
    'SELECT * FROM cards WHERE deck_id = ? AND suspended = 0 ORDER BY RANDOM() LIMIT ?',
    [deckId, limit]
  )
  return random.map(rowToCard)
}

export async function rateCard (card: MobileCard, rating: ReviewRating, elapsedMs?: number) {
  const db = await getDatabase()
  const options = await getDeckOptions(card.deckId)
  const scheduler = options.schedulerType === 'fsrs' ? reviewWithFsrs : review
  const output = scheduler({
    card: {
      id: card.id,
      deckId: card.deckId,
      state: card.state,
      dueAt: card.dueAt,
      intervalDays: card.intervalDays,
      stability: card.stability,
      difficulty: card.difficulty,
      reps: card.reps,
      lapses: card.lapses,
      suspended: card.suspended
    },
    rating,
    reviewedAt: new Date(),
    elapsedMs,
    deckOptions: options
  })

  const now = new Date().toISOString()
  await db.withTransactionAsync(async () => {
    await db.runAsync(`
      UPDATE cards
      SET state = ?, due_at = ?, interval_days = ?, stability = ?, difficulty = ?,
          reps = reps + 1,
          lapses = lapses + ?,
          updated_at = ?
      WHERE id = ?
    `, [
      output.nextState,
      output.dueAt.toISOString(),
      output.intervalDays,
      output.stability ?? null,
      output.difficulty ?? null,
      rating === 'again' ? 1 : 0,
      now,
      card.id
    ])

    await db.runAsync(`
      INSERT INTO review_logs (
        id, card_id, deck_id, reviewed_at, rating, previous_state, next_state,
        previous_due_at, next_due_at, previous_interval_days, next_interval_days,
        elapsed_ms, scheduler_version
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      `log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      card.id,
      card.deckId,
      now,
      rating,
      output.log.previousState,
      output.log.nextState,
      output.log.previousDueAt,
      output.log.nextDueAt,
      output.log.previousIntervalDays,
      output.log.nextIntervalDays,
      elapsedMs ?? null,
      output.log.schedulerVersion
    ])
  })
}

export async function updateCardText (cardId: string, front: string, back: string) {
  const db = await getDatabase()
  const now = new Date().toISOString()
  await db.runAsync('UPDATE cards SET front = ?, back = ?, updated_at = ? WHERE id = ?', [front, back, now, cardId])
}

export async function setCardSuspended (cardId: string, suspended: boolean) {
  const db = await getDatabase()
  const now = new Date().toISOString()
  await db.runAsync('UPDATE cards SET suspended = ?, state = CASE WHEN ? = 1 THEN state ELSE state END, updated_at = ? WHERE id = ?', [suspended ? 1 : 0, suspended ? 1 : 0, now, cardId])
}

export async function deleteCard (cardId: string) {
  const db = await getDatabase()
  await db.runAsync('DELETE FROM cards WHERE id = ?', [cardId])
}

export async function getCardAudio (noteId: string): Promise<Record<string, string>> {
  const db = await getDatabase()
  const rows = await db.getAllAsync<{ slot: string; file_uri: string }>(
    'SELECT slot, file_uri FROM audio_files WHERE note_id = ?',
    [noteId]
  )
  // file_uri is stored relative to documentDirectory (not an absolute
  // file:// URI) — iOS doesn't guarantee the app's sandbox container path
  // stays the same across relaunches/rebuilds, so we re-resolve against
  // the CURRENT documentDirectory here rather than trusting a stored one.
  return Object.fromEntries(rows.map(r => [r.slot, `${FileSystem.documentDirectory}${r.file_uri}`]))
}

export async function getStats (deckId: string) {
  const db = await getDatabase()
  const todayStart = startOfDay(new Date()).toISOString()
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const today = await db.getFirstAsync<any>('SELECT COUNT(*) AS count FROM review_logs WHERE deck_id = ? AND reviewed_at >= ?', [deckId, todayStart])
  const week = await db.getFirstAsync<any>('SELECT COUNT(*) AS count FROM review_logs WHERE deck_id = ? AND reviewed_at >= ?', [deckId, sevenDaysAgo])
  const stateCounts = await db.getAllAsync<any>('SELECT state, COUNT(*) AS count FROM cards WHERE deck_id = ? GROUP BY state', [deckId])
  return {
    reviewsToday: Number(today?.count || 0),
    reviewsLast7Days: Number(week?.count || 0),
    stateCounts
  }
}

export async function getDeckOptions (deckId: string) {
  const db = await getDatabase()
  let row = await db.getFirstAsync<any>('SELECT * FROM deck_options WHERE deck_id = ?', [deckId])
  if (!row) {
    await db.runAsync('INSERT INTO deck_options (deck_id) VALUES (?)', [deckId])
    row = await db.getFirstAsync<any>('SELECT * FROM deck_options WHERE deck_id = ?', [deckId])
  }
  return {
    dailyNewLimit: Number(row.daily_new_limit || 20),
    dailyReviewLimit: Number(row.daily_review_limit || 200),
    schedulerType: row.scheduler_type || 'simple',
    desiredRetention: Number(row.desired_retention || 0.9),
    learningSteps: parseJson(row.learning_steps_json) || ['10m'],
    relearningSteps: parseJson(row.relearning_steps_json) || ['10m']
  }
}

export async function seedSampleDeck () {
  const db = await getDatabase()
  const existing = await db.getFirstAsync<any>('SELECT id FROM decks WHERE id = ?', ['sample-deck'])
  if (existing) return
  const now = new Date().toISOString()
  await db.withTransactionAsync(async () => {
    await db.runAsync('INSERT INTO decks (id, name, description_json, package_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [
      'sample-deck',
      'Sample Mandarin Basics',
      JSON.stringify({ title: 'Sample Mandarin Basics', purpose: 'Practice the mobile review loop', contents: ['Greetings', 'Common verbs'] }),
      'sample-package',
      now,
      now
    ])
    await db.runAsync('INSERT INTO deck_options (deck_id) VALUES (?)', ['sample-deck'])
    for (let i = 1; i <= 20; i++) {
      const noteId = `sample-note-${i}`
      const cardId = `sample-card-${i}`
      await db.runAsync('INSERT INTO notes (id, deck_id, note_type, fields_json, tags_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
        noteId,
        'sample-deck',
        'basic',
        JSON.stringify({ Front: `Sample front ${i}`, Back: `Sample back ${i}` }),
        JSON.stringify(['sample']),
        now,
        now
      ])
      await db.runAsync('INSERT INTO cards (id, note_id, deck_id, front, back, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
        cardId,
        noteId,
        'sample-deck',
        `Sample front ${i}`,
        `Sample back ${i}`,
        'new',
        now,
        now
      ])
    }
  })
}

function rowToCard (row: any): MobileCard {
  return {
    id: row.id,
    noteId: row.note_id,
    deckId: row.deck_id,
    front: row.front,
    back: row.back,
    state: row.state,
    dueAt: row.due_at,
    intervalDays: Number(row.interval_days || 0),
    stability: row.stability,
    difficulty: row.difficulty,
    reps: Number(row.reps || 0),
    lapses: Number(row.lapses || 0),
    suspended: Number(row.suspended || 0)
  }
}

function rowToSchedulerCard (row: any) {
  return {
    id: row.id,
    deckId: row.deck_id,
    state: row.state,
    dueAt: row.due_at,
    intervalDays: Number(row.interval_days || 0),
    stability: row.stability,
    difficulty: row.difficulty,
    reps: Number(row.reps || 0),
    lapses: Number(row.lapses || 0),
    suspended: Number(row.suspended || 0)
  }
}

function parseJson (value: string | null | undefined) {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function startOfDay (date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}
