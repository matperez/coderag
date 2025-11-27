/**
 * Database client setup
 */

import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema.js'

export interface DbConfig {
	dbPath?: string
	codebaseRoot?: string
}

export interface DbInstance {
	db: ReturnType<typeof drizzle<typeof schema>>
	sqlite: Database.Database
	dbPath: string
}

/**
 * Create database client
 */
export function createDb(config: DbConfig = {}): DbInstance {
	const codebaseRoot = config.codebaseRoot || process.cwd()
	const dbDir = path.join(codebaseRoot, '.codebase-search')
	const dbPath = config.dbPath || path.join(dbDir, 'index.db')

	// Ensure database directory exists
	if (!fs.existsSync(dbDir)) {
		fs.mkdirSync(dbDir, { recursive: true })
	}

	// Create SQLite connection
	const sqlite = new Database(dbPath)

	// Enable WAL mode for better concurrency
	sqlite.pragma('journal_mode = WAL')

	// Create Drizzle instance
	const db = drizzle(sqlite, { schema })

	return { db, sqlite, dbPath }
}
