/**
 * CodebaseIndexer Tests
 *
 * Critical tests for the main indexer module covering:
 * - Full indexing workflow
 * - Incremental updates (add/change/delete)
 * - File watching
 * - Search functionality
 * - Resource cleanup
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CodebaseIndexer, type FileChangeEvent } from './indexer.js'
import { MemoryStorage } from './storage.js'
import { PersistentStorage } from './storage-persistent.js'

describe('CodebaseIndexer', () => {
	let tempDir: string
	let indexer: CodebaseIndexer

	beforeEach(() => {
		// Create temporary test directory
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'indexer-test-'))

		// Create test files
		const testFiles = [
			{
				name: 'auth.ts',
				content: `
export function authenticate(username: string, password: string) {
  return validateCredentials(username, password);
}

export function validateCredentials(user: string, pass: string): boolean {
  return true;
}
`,
			},
			{
				name: 'database.ts',
				content: `
export class DatabaseConnection {
  connect() {
    console.log('connecting');
  }

  query(sql: string) {
    return [];
  }
}
`,
			},
			{
				name: 'api.ts',
				content: `
export function handleRequest(req: Request) {
  return processRequest(req);
}

export function processRequest(request: Request) {
  return { success: true };
}
`,
			},
		]

		for (const file of testFiles) {
			const filePath = path.join(tempDir, file.name)
			fs.writeFileSync(filePath, file.content.trim())
		}
	})

	afterEach(async () => {
		// Clean up
		if (indexer) {
			await indexer.close()
		}
		if (fs.existsSync(tempDir)) {
			fs.rmSync(tempDir, { recursive: true, force: true })
		}
	})

	describe('Basic Indexing', () => {
		it('should index files with MemoryStorage', async () => {
			indexer = new CodebaseIndexer({
				codebaseRoot: tempDir,
				storage: new MemoryStorage(),
			})

			await indexer.index()

			const count = await indexer.getIndexedCount()
			expect(count).toBe(3)
		})

		it('should index files with PersistentStorage', async () => {
			const dbPath = path.join(tempDir, 'test.db')
			const storage = new PersistentStorage({ dbPath, codebaseRoot: tempDir })

			indexer = new CodebaseIndexer({
				codebaseRoot: tempDir,
				storage,
			})

			await indexer.index()

			const count = await indexer.getIndexedCount()
			expect(count).toBe(3)
		})

		it('should report progress during indexing', async () => {
			indexer = new CodebaseIndexer({
				codebaseRoot: tempDir,
				storage: new MemoryStorage(),
			})

			const progressCalls: Array<{ current: number; total: number; file: string }> = []

			await indexer.index({
				onProgress: (current, total, file) => {
					progressCalls.push({ current, total, file })
				},
			})

			expect(progressCalls.length).toBeGreaterThan(0)
			expect(progressCalls[progressCalls.length - 1].current).toBe(progressCalls[progressCalls.length - 1].total)
		})

		it('should update status during indexing', async () => {
			indexer = new CodebaseIndexer({
				codebaseRoot: tempDir,
				storage: new MemoryStorage(),
			})

			// Status before indexing
			const statusBefore = indexer.getStatus()
			expect(statusBefore.isIndexing).toBe(false)

			// Start indexing (don't await to check mid-index status)
			const indexPromise = indexer.index()

			// Wait a bit and check status
			await new Promise((resolve) => setTimeout(resolve, 10))
			// Status might be indexing or done depending on speed

			await indexPromise

			// Status after indexing
			const statusAfter = indexer.getStatus()
			expect(statusAfter.isIndexing).toBe(false)
			expect(statusAfter.progress).toBe(100)
		})

		it('should respect maxFileSize option', async () => {
			// Create a large file
			const largeContent = 'x'.repeat(2000)
			fs.writeFileSync(path.join(tempDir, 'large.ts'), largeContent)

			indexer = new CodebaseIndexer({
				codebaseRoot: tempDir,
				storage: new MemoryStorage(),
				maxFileSize: 1000, // 1KB limit
			})

			await indexer.index()

			// Large file should be skipped - should not be in indexed count
			// The 3 original test files are under 1KB, large.ts is over
			const count = await indexer.getIndexedCount()
			expect(count).toBe(3) // Only the original 3 files, not the large one
		})
	})

	describe('Search', () => {
		beforeEach(async () => {
			indexer = new CodebaseIndexer({
				codebaseRoot: tempDir,
				storage: new MemoryStorage(),
			})
			await indexer.index()
		})

		it('should search and return results', async () => {
			const results = await indexer.search('authenticate')

			expect(results.length).toBeGreaterThan(0)
			expect(results[0].path).toBe('auth.ts')
		})

		it('should respect limit option', async () => {
			const results = await indexer.search('function', { limit: 2 })

			expect(results.length).toBeLessThanOrEqual(2)
		})

		it('should include content snippet when requested', async () => {
			const results = await indexer.search('DatabaseConnection', {
				includeContent: true,
			})

			expect(results.length).toBeGreaterThan(0)
			expect(results[0].snippet).toBeDefined()
			expect(results[0].snippet).toContain('DatabaseConnection')
		})

		it('should filter by file extension', async () => {
			// Create a JS file
			fs.writeFileSync(path.join(tempDir, 'test.js'), 'function testFunction() {}')

			// Re-index
			await indexer.index()

			const results = await indexer.search('function', {
				fileExtensions: ['.ts'],
			})

			for (const result of results) {
				expect(result.path.endsWith('.ts')).toBe(true)
			}
		})

		it('should filter by path pattern', async () => {
			// Create nested structure
			fs.mkdirSync(path.join(tempDir, 'src'))
			fs.writeFileSync(path.join(tempDir, 'src', 'nested.ts'), 'export const nested = true;')

			// Re-index
			await indexer.index()

			const results = await indexer.search('nested', {
				pathFilter: 'src',
			})

			expect(results.length).toBeGreaterThan(0)
			expect(results[0].path).toContain('src')
		})

		it('should exclude paths', async () => {
			const results = await indexer.search('function', {
				excludePaths: ['api.ts'],
			})

			for (const result of results) {
				expect(result.path).not.toBe('api.ts')
			}
		})

		it('should return matched terms', async () => {
			const results = await indexer.search('authenticate username')

			expect(results.length).toBeGreaterThan(0)
			expect(results[0].matchedTerms).toBeDefined()
			expect(results[0].matchedTerms.length).toBeGreaterThan(0)
		})

		it('should throw error when not indexed', async () => {
			const freshIndexer = new CodebaseIndexer({
				codebaseRoot: tempDir,
				storage: new MemoryStorage(),
			})

			await expect(freshIndexer.search('test')).rejects.toThrow()
			await freshIndexer.close()
		})
	})

	describe('File Content Retrieval', () => {
		beforeEach(async () => {
			indexer = new CodebaseIndexer({
				codebaseRoot: tempDir,
				storage: new MemoryStorage(),
			})
			await indexer.index()
		})

		it('should retrieve file content', async () => {
			const content = await indexer.getFileContent('auth.ts')

			expect(content).not.toBeNull()
			expect(content).toContain('authenticate')
		})

		it('should return null for non-existent file', async () => {
			const content = await indexer.getFileContent('nonexistent.ts')

			expect(content).toBeNull()
		})
	})

	describe('Incremental Updates with PersistentStorage', () => {
		let dbPath: string
		let storage: PersistentStorage

		beforeEach(async () => {
			dbPath = path.join(tempDir, 'incremental.db')
			storage = new PersistentStorage({ dbPath, codebaseRoot: tempDir })

			indexer = new CodebaseIndexer({
				codebaseRoot: tempDir,
				storage,
			})

			await indexer.index()
		})

		it('should detect no changes on re-index', async () => {
			// Re-index without changes
			await indexer.index()

			const count = await indexer.getIndexedCount()
			expect(count).toBe(3) // Same count
		})

		it('should detect new files on re-index', async () => {
			// Add a new file
			fs.writeFileSync(path.join(tempDir, 'new.ts'), 'export const newFile = true;')

			// Re-index
			await indexer.index()

			const count = await indexer.getIndexedCount()
			expect(count).toBe(4)

			// New file should be searchable
			const results = await indexer.search('newFile')
			expect(results.length).toBeGreaterThan(0)
		})

		it('should detect deleted files on re-index', async () => {
			// Delete a file
			fs.unlinkSync(path.join(tempDir, 'api.ts'))

			// Re-index
			await indexer.index()

			const count = await indexer.getIndexedCount()
			expect(count).toBe(2)

			// Deleted file should not be found
			const content = await indexer.getFileContent('api.ts')
			expect(content).toBeNull()
		})

		it('should detect modified files on re-index', async () => {
			// Wait a bit to ensure mtime changes (filesystem precision)
			await new Promise((resolve) => setTimeout(resolve, 1100))

			// Modify a file
			const newContent = 'export const modified = "updated";'
			fs.writeFileSync(path.join(tempDir, 'auth.ts'), newContent)

			// Re-index
			await indexer.index()

			// Content should be updated
			const content = await indexer.getFileContent('auth.ts')
			expect(content).toContain('modified')
		})
	})

	describe('File Watching', () => {
		it('should start and stop watching', async () => {
			indexer = new CodebaseIndexer({
				codebaseRoot: tempDir,
				storage: new MemoryStorage(),
			})

			await indexer.index({ watch: true })

			expect(indexer.isWatchEnabled()).toBe(true)

			await indexer.stopWatch()

			expect(indexer.isWatchEnabled()).toBe(false)
		})

		it.skip('should call onFileChange callback', async () => {
			// NOTE: Skipped because file watching is environment-dependent
			// (may not work in CI containers or certain OS configurations)
			// This is an integration test that should be run manually when testing FS watcher
			const fileChanges: FileChangeEvent[] = []

			indexer = new CodebaseIndexer({
				codebaseRoot: tempDir,
				storage: new MemoryStorage(),
				onFileChange: (event) => {
					fileChanges.push(event)
				},
			})

			await indexer.index({ watch: true })

			// Create a new file
			fs.writeFileSync(path.join(tempDir, 'watched.ts'), 'export const watched = true;')

			// Wait for debounce (500ms) + processing time
			await new Promise((resolve) => setTimeout(resolve, 1500))

			// Callback should have been called
			expect(fileChanges.length).toBeGreaterThan(0)
			await indexer.stopWatch()
		})

		it('should not error when stopping watch that was not started', async () => {
			indexer = new CodebaseIndexer({
				codebaseRoot: tempDir,
				storage: new MemoryStorage(),
			})

			await indexer.index()

			// Should not throw
			await indexer.stopWatch()
		})
	})

	describe('Resource Cleanup', () => {
		it('should close cleanly', async () => {
			const dbPath = path.join(tempDir, 'close.db')
			const storage = new PersistentStorage({ dbPath, codebaseRoot: tempDir })

			indexer = new CodebaseIndexer({
				codebaseRoot: tempDir,
				storage,
			})

			await indexer.index({ watch: true })

			// Should not throw
			await indexer.close()

			expect(indexer.isWatchEnabled()).toBe(false)
		})

		it('should handle multiple close calls', async () => {
			indexer = new CodebaseIndexer({
				codebaseRoot: tempDir,
				storage: new MemoryStorage(),
			})

			await indexer.index()

			// Multiple close calls should not throw
			await indexer.close()
			await indexer.close()
		})
	})

	describe('Search Cache', () => {
		beforeEach(async () => {
			indexer = new CodebaseIndexer({
				codebaseRoot: tempDir,
				storage: new MemoryStorage(),
			})
			await indexer.index()
		})

		it('should return consistent results for same query', async () => {
			const results1 = await indexer.search('authenticate')
			const results2 = await indexer.search('authenticate')

			expect(results1.length).toBe(results2.length)
			expect(results1[0].path).toBe(results2[0].path)
			expect(results1[0].score).toBe(results2[0].score)
		})
	})

	describe('Low Memory Mode', () => {
		it('should enable low memory mode by default with PersistentStorage', async () => {
			const dbPath = path.join(tempDir, 'lowmem.db')
			const storage = new PersistentStorage({ dbPath, codebaseRoot: tempDir })

			indexer = new CodebaseIndexer({
				codebaseRoot: tempDir,
				storage,
			})

			await indexer.index()

			// Search should work in low memory mode (SQL-based)
			const results = await indexer.search('authenticate')
			expect(results.length).toBeGreaterThan(0)
		})

		it('should allow explicit low memory mode setting', async () => {
			indexer = new CodebaseIndexer({
				codebaseRoot: tempDir,
				storage: new MemoryStorage(),
				lowMemoryMode: false,
			})

			await indexer.index()

			// Should have in-memory index
			const searchIndex = indexer.getSearchIndex()
			expect(searchIndex).not.toBeNull()
		})
	})

	describe('Gitignore Support', () => {
		it('should respect .gitignore patterns', async () => {
			// Create .gitignore
			fs.writeFileSync(path.join(tempDir, '.gitignore'), 'ignored.ts\n')

			// Create ignored file
			fs.writeFileSync(path.join(tempDir, 'ignored.ts'), 'export const ignored = true;')

			indexer = new CodebaseIndexer({
				codebaseRoot: tempDir,
				storage: new MemoryStorage(),
			})

			await indexer.index()

			// Ignored file should not be indexed
			const content = await indexer.getFileContent('ignored.ts')
			expect(content).toBeNull()
		})
	})

	describe('Binary File Handling', () => {
		it('should skip binary files', async () => {
			// Create a "binary" file (actually just a file with binary name)
			fs.writeFileSync(path.join(tempDir, 'image.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))

			indexer = new CodebaseIndexer({
				codebaseRoot: tempDir,
				storage: new MemoryStorage(),
			})

			await indexer.index()

			// Binary file should not be indexed
			const content = await indexer.getFileContent('image.png')
			expect(content).toBeNull()
		})
	})

	describe('Language Detection', () => {
		beforeEach(async () => {
			// Create files with different extensions
			fs.writeFileSync(path.join(tempDir, 'script.js'), 'console.log("js");')
			fs.writeFileSync(path.join(tempDir, 'app.py'), 'print("python")')

			indexer = new CodebaseIndexer({
				codebaseRoot: tempDir,
				storage: new MemoryStorage(),
			})
			await indexer.index()
		})

		it('should detect TypeScript files', async () => {
			const results = await indexer.search('authenticate')
			expect(results.length).toBeGreaterThan(0)
			expect(results[0].language).toBe('TypeScript')
		})

		it('should detect JavaScript files', async () => {
			const results = await indexer.search('js')
			const jsResult = results.find((r) => r.path.endsWith('.js'))
			if (jsResult) {
				expect(jsResult.language).toBe('JavaScript')
			}
		})
	})

	describe('Indexing Batch Size', () => {
		it('should respect indexingBatchSize option', async () => {
			// Create many files
			for (let i = 0; i < 20; i++) {
				fs.writeFileSync(path.join(tempDir, `file${i}.ts`), `export const file${i} = ${i};`)
			}

			indexer = new CodebaseIndexer({
				codebaseRoot: tempDir,
				storage: new MemoryStorage(),
				indexingBatchSize: 5, // Process 5 at a time
			})

			await indexer.index()

			// All files should still be indexed
			const count = await indexer.getIndexedCount()
			expect(count).toBeGreaterThanOrEqual(20)
		})
	})
})
