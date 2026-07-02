import * as DocumentPicker from 'expo-document-picker'
import * as FileSystem from 'expo-file-system'
import { unzipSync, strFromU8 } from 'fflate'
import { getDatabase } from '../db/database'
import { validateDeckPackage } from '../../../packages/shared/src'
import { base64ToUint8Array, uint8ArrayToBase64 } from '../lib/base64'

export async function pickAndImportDeckPackage () {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/json', 'public.json', 'application/zip', 'public.zip-archive'],
    copyToCacheDirectory: true
  })
  if (result.canceled) return { canceled: true as const }
  const file = result.assets[0]
  const isZip = /\.zip$/i.test(file.name || file.uri) || file.mimeType === 'application/zip'

  let deckPackage: ReturnType<typeof validateDeckPackage>
  let audioEntries: Record<string, Uint8Array> = {}

  if (isZip) {
    const base64 = await FileSystem.readAsStringAsync(file.uri, { encoding: FileSystem.EncodingType.Base64 })
    const zipBytes = base64ToUint8Array(base64)
    const unzipped = unzipSync(zipBytes)
    const deckJsonBytes = unzipped['deck.json']
    if (!deckJsonBytes) throw new Error('Invalid Cardify package: missing deck.json')
    const parsed = JSON.parse(strFromU8(deckJsonBytes))
    deckPackage = validateDeckPackage(parsed)
    for (const [name, bytes] of Object.entries(unzipped)) {
      if (name.startsWith('audio/')) audioEntries[name] = bytes
    }
  } else {
    const raw = await FileSystem.readAsStringAsync(file.uri)
    deckPackage = validateDeckPackage(JSON.parse(raw))
  }

  await importDeckPackage(deckPackage, audioEntries)
  return {
    ok: true as const,
    deckId: deckPackage.deck.id,
    deckName: deckPackage.deck.name,
    noteCount: deckPackage.notes.length
  }
}

export async function importDeckPackage (
  deckPackage: ReturnType<typeof validateDeckPackage>,
  audioEntries: Record<string, Uint8Array> = {}
) {
  const db = await getDatabase()
  const existing = await db.getFirstAsync('SELECT id FROM decks WHERE package_id = ?', [deckPackage.packageId])
  if (existing) {
    throw new Error('This deck package has already been imported.')
  }

  const now = new Date().toISOString()

  // Audio files are written to disk before the SQLite transaction — filesystem
  // writes aren't part of the transaction and shouldn't extend/block it.
  // We store a RELATIVE path in the DB (not the resolved absolute file://
  // URI) — iOS does not guarantee an app's sandbox container path stays the
  // same across relaunches/rebuilds, so persisting an absolute path can go
  // stale even though the file itself is still there. The relative path is
  // re-resolved against the current documentDirectory at read time instead.
  const audioFileUris: { noteId: string; slot: string; relativePath: string }[] = []
  if (deckPackage.audio && deckPackage.audio.length > 0) {
    const relativeAudioDir = `audio/${deckPackage.deck.id}/`
    const audioDir = `${FileSystem.documentDirectory}${relativeAudioDir}`
    await FileSystem.makeDirectoryAsync(audioDir, { intermediates: true })
    for (const mapping of deckPackage.audio) {
      const bytes = audioEntries[mapping.file]
      if (!bytes) continue
      const relativePath = `${relativeAudioDir}${mapping.noteId}_${mapping.slot}.mp3`
      await FileSystem.writeAsStringAsync(`${FileSystem.documentDirectory}${relativePath}`, uint8ArrayToBase64(bytes), { encoding: FileSystem.EncodingType.Base64 })
      audioFileUris.push({ noteId: mapping.noteId, slot: mapping.slot, relativePath })
    }
  }

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

    for (const audio of audioFileUris) {
      // file_uri stores a path RELATIVE to documentDirectory, not an
      // absolute file:// URI — see the comment above where it's written.
      await db.runAsync(`
        INSERT INTO audio_files (deck_id, note_id, slot, file_uri, created_at)
        VALUES (?, ?, ?, ?, ?)
      `, [deckPackage.deck.id, audio.noteId, audio.slot, audio.relativePath, now])
    }

    // Restore FSRS state if this was exported from mobile
    const cardsState = (deckPackage as any).cardsState as any[] | undefined
    if (Array.isArray(cardsState)) {
      for (const cs of cardsState) {
        await db.runAsync(
          'UPDATE cards SET state=?, due_at=?, interval_days=?, stability=?, difficulty=?, reps=?, lapses=?, suspended=? WHERE id=?',
          [cs.state, cs.dueAt ?? null, cs.intervalDays ?? 0, cs.stability ?? null, cs.difficulty ?? null, cs.reps ?? 0, cs.lapses ?? 0, cs.suspended ?? 0, cs.id]
        )
      }
    }
  })
}
