import * as DocumentPicker from 'expo-document-picker'
import * as FileSystem from 'expo-file-system'
import { getDatabase } from '../db/database'
import { validateDeckPackage } from '../../../packages/shared/src'

export async function pickAndImportDeckPackage () {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/json', 'public.json'],
    copyToCacheDirectory: true
  })
  if (result.canceled) return { canceled: true as const }
  const file = result.assets[0]
  const raw = await FileSystem.readAsStringAsync(file.uri)
  const parsed = JSON.parse(raw)
  const deckPackage = validateDeckPackage(parsed)
  await importDeckPackage(deckPackage)
  return {
    ok: true as const,
    deckId: deckPackage.deck.id,
    deckName: deckPackage.deck.name,
    noteCount: deckPackage.notes.length
  }
}

export async function importDeckPackage (deckPackage: ReturnType<typeof validateDeckPackage>) {
  const db = await getDatabase()
  const existing = await db.getFirstAsync('SELECT id FROM decks WHERE package_id = ?', [deckPackage.packageId])
  if (existing) {
    throw new Error('This deck package has already been imported.')
  }

  const now = new Date().toISOString()
  await db.withTransactionAsync(async () => {
    await db.runAsync(`
      INSERT INTO decks (id, name, description_json, package_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [
      deckPackage.deck.id,
      deckPackage.deck.name,
      JSON.stringify(deckPackage.deck.description || {}),
      deckPackage.packageId,
      now,
      now
    ])
    await db.runAsync('INSERT INTO deck_options (deck_id) VALUES (?)', [deckPackage.deck.id])

    for (const note of deckPackage.notes) {
      await db.runAsync(`
        INSERT INTO notes (id, deck_id, note_type, fields_json, tags_json, source_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        note.id,
        deckPackage.deck.id,
        note.noteType,
        JSON.stringify(note.fields),
        JSON.stringify(note.tags || []),
        JSON.stringify(note.source || {}),
        now,
        now
      ])
      await db.runAsync(`
        INSERT INTO cards (id, note_id, deck_id, front, back, state, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        `${note.id}-card-basic`,
        note.id,
        deckPackage.deck.id,
        note.fields.Front,
        note.fields.Back,
        'new',
        now,
        now
      ])
    }
  })
}
