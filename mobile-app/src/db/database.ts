import * as SQLite from 'expo-sqlite'

export type CardifyDatabase = SQLite.SQLiteDatabase

let databasePromise: Promise<CardifyDatabase> | null = null

export function getDatabase (): Promise<CardifyDatabase> {
  if (!databasePromise) {
    databasePromise = SQLite.openDatabaseAsync('cardify-mobile.db').then(async db => {
      await db.execAsync('PRAGMA foreign_keys = ON;')
      await migrate(db)
      return db
    })
  }
  return databasePromise
}

async function migrate (db: CardifyDatabase) {
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS decks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description_json TEXT,
      package_id TEXT UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      deck_id TEXT NOT NULL,
      note_type TEXT NOT NULL,
      fields_json TEXT NOT NULL,
      tags_json TEXT NOT NULL,
      source_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(deck_id) REFERENCES decks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY,
      note_id TEXT NOT NULL,
      deck_id TEXT NOT NULL,
      front TEXT NOT NULL,
      back TEXT NOT NULL,
      state TEXT NOT NULL,
      due_at TEXT,
      interval_days REAL DEFAULT 0,
      stability REAL,
      difficulty REAL,
      reps INTEGER DEFAULT 0,
      lapses INTEGER DEFAULT 0,
      suspended INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(note_id) REFERENCES notes(id) ON DELETE CASCADE,
      FOREIGN KEY(deck_id) REFERENCES decks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS review_logs (
      id TEXT PRIMARY KEY,
      card_id TEXT NOT NULL,
      deck_id TEXT NOT NULL,
      reviewed_at TEXT NOT NULL,
      rating TEXT NOT NULL,
      previous_state TEXT NOT NULL,
      next_state TEXT NOT NULL,
      previous_due_at TEXT,
      next_due_at TEXT,
      previous_interval_days REAL,
      next_interval_days REAL,
      elapsed_ms INTEGER,
      scheduler_version TEXT NOT NULL,
      FOREIGN KEY(card_id) REFERENCES cards(id) ON DELETE CASCADE,
      FOREIGN KEY(deck_id) REFERENCES decks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS deck_options (
      deck_id TEXT PRIMARY KEY,
      daily_new_limit INTEGER DEFAULT 20,
      daily_review_limit INTEGER DEFAULT 200,
      scheduler_type TEXT DEFAULT 'simple',
      desired_retention REAL DEFAULT 0.9,
      learning_steps_json TEXT DEFAULT '["10m"]',
      relearning_steps_json TEXT DEFAULT '["10m"]',
      fsrs_params_json TEXT,
      FOREIGN KEY(deck_id) REFERENCES decks(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_cards_deck_state_due ON cards(deck_id, state, due_at);
    CREATE INDEX IF NOT EXISTS idx_review_logs_deck_reviewed ON review_logs(deck_id, reviewed_at);
  `)
}
