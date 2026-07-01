import * as FileSystem from 'expo-file-system'
import * as Sharing from 'expo-sharing'
import * as DocumentPicker from 'expo-document-picker'
import { getDatabase } from '../db/database'
import { getDeck } from '../db/repositories'

const BACKUP_VERSION = 1

export async function exportDeckPackage (deckId: string) {
  const db = await getDatabase()
  const deck = await getDeck(deckId)
  if (!deck) throw new Error('Deck not found')

  const notes = await db.getAllAsync<any>('SELECT * FROM notes WHERE deck_id = ?', [deckId])
  const cards = await db.getAllAsync<any>('SELECT * FROM cards WHERE deck_id = ?', [deckId])

  const pkg = {
    packageId: deck.packageId || `pkg-export-${Date.now()}`,
    deck: {
      id: deck.id,
      name: deck.displayName,
      description: deck.description,
    },
    notes: notes.map((n: any) => ({
      id: n.id,
      noteType: n.note_type,
      fields: JSON.parse(n.fields_json || '{}'),
      tags: JSON.parse(n.tags_json || '[]'),
      source: JSON.parse(n.source_json || '{}'),
    })),
    // cardsState lets a re-import restore FSRS progress
    cardsState: cards.map((c: any) => ({
      id: c.id,
      state: c.state,
      dueAt: c.due_at,
      intervalDays: c.interval_days,
      stability: c.stability,
      difficulty: c.difficulty,
      reps: c.reps,
      lapses: c.lapses,
      suspended: c.suspended,
    })),
  }

  const safeName = deck.displayName.replace(/[^a-z0-9]/gi, '-').toLowerCase()
  const uri = `${FileSystem.documentDirectory}${safeName}.cardify.json`
  await FileSystem.writeAsStringAsync(uri, JSON.stringify(pkg, null, 2))
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: 'application/json', UTI: 'public.json' })
  }
  return uri
}

export async function exportBackup () {
  const db = await getDatabase()
  const backup = {
    formatVersion: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    decks: await db.getAllAsync('SELECT * FROM decks'),
    notes: await db.getAllAsync('SELECT * FROM notes'),
    cards: await db.getAllAsync('SELECT * FROM cards'),
    reviewLogs: await db.getAllAsync('SELECT * FROM review_logs'),
    deckOptions: await db.getAllAsync('SELECT * FROM deck_options')
  }
  const uri = `${FileSystem.documentDirectory}cardify-mobile-backup-${Date.now()}.json`
  await FileSystem.writeAsStringAsync(uri, JSON.stringify(backup, null, 2))
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri)
  }
  return uri
}

export async function importBackup () {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/json', 'public.json'],
    copyToCacheDirectory: true
  })
  if (result.canceled) return { canceled: true as const }

  const raw = await FileSystem.readAsStringAsync(result.assets[0].uri)
  const backup = JSON.parse(raw)
  if (backup.formatVersion !== BACKUP_VERSION) {
    throw new Error('Unsupported backup version.')
  }

  const db = await getDatabase()
  await db.withTransactionAsync(async () => {
    await db.execAsync('DELETE FROM review_logs; DELETE FROM cards; DELETE FROM notes; DELETE FROM deck_options; DELETE FROM decks;')
    for (const deck of backup.decks || []) {
      await db.runAsync('INSERT INTO decks (id, name, description_json, package_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [
        deck.id, deck.name, deck.description_json, deck.package_id, deck.created_at, deck.updated_at
      ])
    }
    for (const options of backup.deckOptions || []) {
      await db.runAsync('INSERT INTO deck_options (deck_id, daily_new_limit, daily_review_limit, scheduler_type, desired_retention, learning_steps_json, relearning_steps_json, fsrs_params_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
        options.deck_id, options.daily_new_limit, options.daily_review_limit, options.scheduler_type, options.desired_retention, options.learning_steps_json, options.relearning_steps_json, options.fsrs_params_json
      ])
    }
    for (const note of backup.notes || []) {
      await db.runAsync('INSERT INTO notes (id, deck_id, note_type, fields_json, tags_json, source_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
        note.id, note.deck_id, note.note_type, note.fields_json, note.tags_json, note.source_json, note.created_at, note.updated_at
      ])
    }
    for (const card of backup.cards || []) {
      await db.runAsync('INSERT INTO cards (id, note_id, deck_id, front, back, state, due_at, interval_days, stability, difficulty, reps, lapses, suspended, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
        card.id, card.note_id, card.deck_id, card.front, card.back, card.state, card.due_at, card.interval_days, card.stability, card.difficulty, card.reps, card.lapses, card.suspended, card.created_at, card.updated_at
      ])
    }
    for (const log of backup.reviewLogs || []) {
      await db.runAsync('INSERT INTO review_logs (id, card_id, deck_id, reviewed_at, rating, previous_state, next_state, previous_due_at, next_due_at, previous_interval_days, next_interval_days, elapsed_ms, scheduler_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
        log.id, log.card_id, log.deck_id, log.reviewed_at, log.rating, log.previous_state, log.next_state, log.previous_due_at, log.next_due_at, log.previous_interval_days, log.next_interval_days, log.elapsed_ms, log.scheduler_version
      ])
    }
  })

  return { ok: true as const }
}
