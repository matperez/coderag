/**
 * Database migrations
 */

import type Database from 'better-sqlite3';

/**
 * Run all migrations
 */
export function runMigrations(sqlite: Database.Database): void {
  // Create migrations table if it doesn't exist
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS __drizzle_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hash TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL
    );
  `);

  // Migration 1: Initial schema
  const migration1Hash = 'initial_schema_v1';
  const existingMigration = sqlite
    .prepare('SELECT id FROM __drizzle_migrations WHERE hash = ?')
    .get(migration1Hash);

  if (!existingMigration) {
    console.error('[DB] Running migration: initial_schema_v1');

    sqlite.exec(`
      -- Files table
      CREATE TABLE IF NOT EXISTS files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL UNIQUE,
        content TEXT NOT NULL,
        hash TEXT NOT NULL,
        size INTEGER NOT NULL,
        mtime INTEGER NOT NULL,
        language TEXT,
        indexed_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS files_path_idx ON files(path);
      CREATE INDEX IF NOT EXISTS files_hash_idx ON files(hash);

      -- Document vectors table
      CREATE TABLE IF NOT EXISTS document_vectors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_id INTEGER NOT NULL,
        term TEXT NOT NULL,
        tf REAL NOT NULL,
        tfidf REAL NOT NULL,
        raw_freq INTEGER NOT NULL,
        FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS vectors_file_id_idx ON document_vectors(file_id);
      CREATE INDEX IF NOT EXISTS vectors_term_idx ON document_vectors(term);
      CREATE INDEX IF NOT EXISTS vectors_tfidf_idx ON document_vectors(tfidf);

      -- IDF scores table
      CREATE TABLE IF NOT EXISTS idf_scores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        term TEXT NOT NULL UNIQUE,
        idf REAL NOT NULL,
        document_frequency INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idf_term_idx ON idf_scores(term);

      -- Index metadata table
      CREATE TABLE IF NOT EXISTS index_metadata (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT NOT NULL UNIQUE,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);

    sqlite
      .prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)')
      .run(migration1Hash, Date.now());

    console.error('[DB] Migration complete: initial_schema_v1');
  }
}
