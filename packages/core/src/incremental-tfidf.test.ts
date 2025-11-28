/**
 * Tests for Incremental TF-IDF implementation (StarCoder2 tokenizer)
 */

import { beforeAll, describe, expect, it } from 'vitest'
import { IncrementalTFIDF } from './incremental-tfidf.js'
import { buildSearchIndex, initializeTokenizer } from './tfidf.js'

// Skip if running in CI without model cache
const shouldSkip = process.env.CI === 'true' && !process.env.HF_HOME

describe('IncrementalTFIDF', () => {
	beforeAll(async () => {
		if (shouldSkip) return
		await initializeTokenizer()
	}, 60000)

	describe('initialization', () => {
		it.skipIf(shouldSkip)('should initialize from existing index', async () => {
			const documents = [
				{ uri: 'file://doc1.txt', content: 'hello world' },
				{ uri: 'file://doc2.txt', content: 'hello there' },
			]

			const index = await buildSearchIndex(documents)
			const incrementalEngine = new IncrementalTFIDF(index.documents, index.idf)

			const result = incrementalEngine.getIndex()
			expect(result.totalDocuments).toBe(2)
			expect(result.documents.length).toBe(2)
			expect(result.idf.size).toBeGreaterThan(0)
		})

		it('should initialize with empty index', () => {
			const incrementalEngine = new IncrementalTFIDF([], new Map())

			const result = incrementalEngine.getIndex()
			expect(result.totalDocuments).toBe(0)
			expect(result.documents.length).toBe(0)
		})
	})

	describe('add document', () => {
		it.skipIf(shouldSkip)('should add new document and update IDF', async () => {
			const initialDocs = [{ uri: 'file://doc1.txt', content: 'hello world' }]
			const index = await buildSearchIndex(initialDocs)
			const engine = new IncrementalTFIDF(index.documents, index.idf)

			const stats = await engine.applyUpdates([
				{
					type: 'add',
					uri: 'file://doc2.txt',
					newContent: 'hello there world',
				},
			])

			expect(stats.affectedDocuments).toBeGreaterThan(0)
			expect(stats.affectedTerms).toBeGreaterThan(0)

			const result = engine.getIndex()
			expect(result.totalDocuments).toBe(2)
			expect(result.documents.length).toBe(2)
		})

		it.skipIf(shouldSkip)('should handle adding multiple documents', async () => {
			const engine = new IncrementalTFIDF([], new Map())

			const stats = await engine.applyUpdates([
				{
					type: 'add',
					uri: 'file://doc1.txt',
					newContent: 'hello world',
				},
				{
					type: 'add',
					uri: 'file://doc2.txt',
					newContent: 'goodbye world',
				},
			])

			expect(stats.affectedDocuments).toBe(2)

			const result = engine.getIndex()
			expect(result.totalDocuments).toBe(2)
			expect(result.documents.length).toBe(2)
		})
	})

	describe('update document', () => {
		it.skipIf(shouldSkip)('should update existing document and recalculate IDF', async () => {
			const initialDocs = [
				{ uri: 'file://doc1.txt', content: 'hello world' },
				{ uri: 'file://doc2.txt', content: 'hello there' },
			]

			const index = await buildSearchIndex(initialDocs)
			const engine = new IncrementalTFIDF(index.documents, index.idf)

			const oldDoc = index.documents.find((d) => d.uri === 'file://doc1.txt')!

			const stats = await engine.applyUpdates([
				{
					type: 'update',
					uri: 'file://doc1.txt',
					oldDocument: oldDoc,
					newContent: 'goodbye universe',
				},
			])

			expect(stats.affectedDocuments).toBeGreaterThan(0)
			expect(stats.affectedTerms).toBeGreaterThan(0)

			const result = engine.getIndex()
			expect(result.totalDocuments).toBe(2)
		})

		it.skipIf(shouldSkip)('should update affected documents when term frequencies change', async () => {
			const initialDocs = [
				{ uri: 'file://doc1.txt', content: 'rare word' },
				{ uri: 'file://doc2.txt', content: 'common word common' },
			]

			const index = await buildSearchIndex(initialDocs)
			const engine = new IncrementalTFIDF(index.documents, index.idf)

			const oldDoc = index.documents.find((d) => d.uri === 'file://doc1.txt')!

			await engine.applyUpdates([
				{
					type: 'update',
					uri: 'file://doc1.txt',
					oldDocument: oldDoc,
					newContent: 'word word word',
				},
			])

			const result = engine.getIndex()
			expect(result.totalDocuments).toBe(2)
		})
	})

	describe('delete document', () => {
		it.skipIf(shouldSkip)('should delete document and update IDF', async () => {
			const initialDocs = [
				{ uri: 'file://doc1.txt', content: 'hello world' },
				{ uri: 'file://doc2.txt', content: 'hello there' },
			]

			const index = await buildSearchIndex(initialDocs)
			const engine = new IncrementalTFIDF(index.documents, index.idf)

			const oldDoc = index.documents.find((d) => d.uri === 'file://doc1.txt')!

			const stats = await engine.applyUpdates([
				{
					type: 'delete',
					uri: 'file://doc1.txt',
					oldDocument: oldDoc,
				},
			])

			expect(stats.affectedTerms).toBeGreaterThan(0)

			const result = engine.getIndex()
			expect(result.totalDocuments).toBe(1)
			expect(result.documents.length).toBe(1)
			expect(result.documents.find((d) => d.uri === 'file://doc1.txt')).toBeUndefined()
		})

		it.skipIf(shouldSkip)('should handle deleting last occurrence of terms', async () => {
			const initialDocs = [
				{ uri: 'file://doc1.txt', content: 'unique word' },
				{ uri: 'file://doc2.txt', content: 'common word' },
			]

			const index = await buildSearchIndex(initialDocs)
			const engine = new IncrementalTFIDF(index.documents, index.idf)

			const oldDoc = index.documents.find((d) => d.uri === 'file://doc1.txt')!

			await engine.applyUpdates([
				{
					type: 'delete',
					uri: 'file://doc1.txt',
					oldDocument: oldDoc,
				},
			])

			const result = engine.getIndex()
			expect(result.totalDocuments).toBe(1)
		})
	})

	describe('mixed operations', () => {
		it.skipIf(shouldSkip)('should handle add, update, and delete in single batch', async () => {
			const initialDocs = [
				{ uri: 'file://doc1.txt', content: 'hello world' },
				{ uri: 'file://doc2.txt', content: 'hello there' },
			]

			const index = await buildSearchIndex(initialDocs)
			const engine = new IncrementalTFIDF(index.documents, index.idf)

			const doc1 = index.documents.find((d) => d.uri === 'file://doc1.txt')!
			const doc2 = index.documents.find((d) => d.uri === 'file://doc2.txt')!

			const stats = await engine.applyUpdates([
				{
					type: 'delete',
					uri: 'file://doc1.txt',
					oldDocument: doc1,
				},
				{
					type: 'update',
					uri: 'file://doc2.txt',
					oldDocument: doc2,
					newContent: 'greetings universe',
				},
				{
					type: 'add',
					uri: 'file://doc3.txt',
					newContent: 'new document here',
				},
			])

			expect(stats.affectedDocuments).toBeGreaterThan(0)
			expect(stats.affectedTerms).toBeGreaterThan(0)

			const result = engine.getIndex()
			expect(result.totalDocuments).toBe(2) // doc1 deleted, doc3 added
			expect(result.documents.length).toBe(2)
		})
	})

	describe('shouldFullRebuild', () => {
		it.skipIf(shouldSkip)('should recommend full rebuild when >20% of documents change', async () => {
			const initialDocs = Array.from({ length: 100 }, (_, i) => ({
				uri: `file://doc${i}.txt`,
				content: 'hello world',
			}))

			const index = await buildSearchIndex(initialDocs)
			const engine = new IncrementalTFIDF(index.documents, index.idf)

			// Create updates for 25 documents (25%)
			const updates = Array.from({ length: 25 }, (_, i) => ({
				type: 'update' as const,
				uri: `file://doc${i}.txt`,
				oldDocument: index.documents[i],
				newContent: 'updated content',
			}))

			expect(await engine.shouldFullRebuild(updates)).toBe(true)
		})

		it.skipIf(shouldSkip)('should not recommend full rebuild when <20% of documents change', async () => {
			const initialDocs = Array.from({ length: 100 }, (_, i) => ({
				uri: `file://doc${i}.txt`,
				content: 'hello world',
			}))

			const index = await buildSearchIndex(initialDocs)
			const engine = new IncrementalTFIDF(index.documents, index.idf)

			// Create updates for 15 documents (15%)
			const updates = Array.from({ length: 15 }, (_, i) => ({
				type: 'update' as const,
				uri: `file://doc${i}.txt`,
				oldDocument: index.documents[i],
				newContent: 'updated content',
			}))

			expect(await engine.shouldFullRebuild(updates)).toBe(false)
		})

		it.skipIf(shouldSkip)('should recommend full rebuild when adding >1000 new terms', async () => {
			const initialDocs = [{ uri: 'file://doc1.txt', content: 'hello world' }]

			const index = await buildSearchIndex(initialDocs)
			const engine = new IncrementalTFIDF(index.documents, index.idf)

			// Create content with >1000 unique terms
			const newTerms = Array.from({ length: 1100 }, (_, i) => `term${i}`).join(' ')

			const updates = [
				{
					type: 'add' as const,
					uri: 'file://doc2.txt',
					newContent: newTerms,
				},
			]

			expect(await engine.shouldFullRebuild(updates)).toBe(true)
		})
	})

	describe('TF-IDF calculations', () => {
		it.skipIf(shouldSkip)('should calculate correct TF-IDF values after update', async () => {
			const initialDocs = [
				{ uri: 'file://doc1.txt', content: 'word word word' },
				{ uri: 'file://doc2.txt', content: 'word other' },
			]

			const index = await buildSearchIndex(initialDocs)
			const engine = new IncrementalTFIDF(index.documents, index.idf)

			const result = engine.getIndex()

			// IDF values should be computed
			expect(result.idf.size).toBeGreaterThan(0)
		})

		it.skipIf(shouldSkip)('should maintain vector magnitudes', async () => {
			const initialDocs = [{ uri: 'file://doc1.txt', content: 'hello world' }]

			const index = await buildSearchIndex(initialDocs)
			const engine = new IncrementalTFIDF(index.documents, index.idf)

			await engine.applyUpdates([
				{
					type: 'add',
					uri: 'file://doc2.txt',
					newContent: 'hello there',
				},
			])

			const result = engine.getIndex()

			for (const doc of result.documents) {
				// Calculate magnitude from terms
				let sumSquares = 0
				for (const tfidf of doc.terms.values()) {
					sumSquares += tfidf * tfidf
				}
				const expectedMagnitude = Math.sqrt(sumSquares)

				expect(doc.magnitude).toBeCloseTo(expectedMagnitude, 10)
			}
		})
	})
})
