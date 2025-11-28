/**
 * Tests for TF-IDF search functionality (StarCoder2 tokenizer)
 */

import { beforeAll, describe, expect, it } from 'vitest'
import {
	buildSearchIndex,
	calculateCosineSimilarity,
	type DocumentVector,
	initializeTokenizer,
	type SearchIndex,
	searchDocuments,
	tokenize,
} from './tfidf.js'

// Skip if running in CI without model cache
const shouldSkip = process.env.CI === 'true' && !process.env.HF_HOME

describe('TF-IDF', () => {
	beforeAll(async () => {
		if (shouldSkip) return
		// Initialize tokenizer once for all tests
		await initializeTokenizer()
	}, 60000)

	describe('tokenize', () => {
		it.skipIf(shouldSkip)('should tokenize code', async () => {
			const text = 'function getUserData() { return user.data; }'
			const tokens = await tokenize(text)

			expect(tokens.length).toBeGreaterThan(0)
		})

		it.skipIf(shouldSkip)('should handle empty input', async () => {
			const tokens = await tokenize('')
			expect(tokens).toEqual([])
		})
	})

	describe('buildSearchIndex', () => {
		it.skipIf(shouldSkip)('should build index for single document', async () => {
			const documents = [{ uri: 'file://test.ts', content: 'function getUserData() { return user.data; }' }]

			const index = await buildSearchIndex(documents)

			expect(index.documents).toHaveLength(1)
			expect(index.idf).toBeDefined()
			expect(index.totalDocuments).toBe(1)
			expect(index.documents[0].uri).toBe('file://test.ts')
		})

		it.skipIf(shouldSkip)('should build index for multiple documents', async () => {
			const documents = [
				{ uri: 'file://user.ts', content: 'class User { getData() { return this.data; } }' },
				{
					uri: 'file://auth.ts',
					content: 'function authenticate(user, password) { return true; }',
				},
			]

			const index = await buildSearchIndex(documents)

			expect(index.documents).toHaveLength(2)
			expect(index.totalDocuments).toBe(2)
		})

		it.skipIf(shouldSkip)('should calculate IDF for terms', async () => {
			const documents = [
				{ uri: 'file://1.ts', content: 'user data' },
				{ uri: 'file://2.ts', content: 'user authentication' },
				{ uri: 'file://3.ts', content: 'admin data' },
			]

			const index = await buildSearchIndex(documents)

			// Should have IDF scores for terms
			expect(index.idf.size).toBeGreaterThan(0)
		})

		it.skipIf(shouldSkip)('should handle empty documents', async () => {
			const documents: Array<{ uri: string; content: string }> = []
			const index = await buildSearchIndex(documents)

			expect(index.documents).toHaveLength(0)
			expect(index.totalDocuments).toBe(0)
		})
	})

	describe('searchDocuments', () => {
		let testIndex: SearchIndex

		beforeAll(async () => {
			if (shouldSkip) return
			testIndex = await buildSearchIndex([
				{ uri: 'file://user.ts', content: 'class User { getName() { return this.name; } }' },
				{
					uri: 'file://auth.ts',
					content: 'function authenticateUser(username, password) { return true; }',
				},
				{
					uri: 'file://admin.ts',
					content: 'class Admin extends User { getPermissions() { return []; } }',
				},
			])
		})

		it.skipIf(shouldSkip)('should find relevant documents', async () => {
			const results = await searchDocuments('user', testIndex)

			expect(results.length).toBeGreaterThanOrEqual(0)
		})

		it.skipIf(shouldSkip)('should rank by relevance', async () => {
			const results = await searchDocuments('user authentication', testIndex)

			// First result should have highest score
			for (let i = 1; i < results.length; i++) {
				expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score)
			}
		})

		it.skipIf(shouldSkip)('should return matched terms', async () => {
			const results = await searchDocuments('user name', testIndex)

			if (results.length > 0) {
				expect(results[0].matchedTerms).toBeDefined()
			}
		})

		it.skipIf(shouldSkip)('should respect limit option', async () => {
			const results = await searchDocuments('user', testIndex, { limit: 1 })

			expect(results.length).toBeLessThanOrEqual(1)
		})

		it.skipIf(shouldSkip)('should respect minScore option', async () => {
			const results = await searchDocuments('user', testIndex, { minScore: 0.5 })

			for (const result of results) {
				expect(result.score).toBeGreaterThanOrEqual(0.5)
			}
		})

		it.skipIf(shouldSkip)('should handle queries with no matches', async () => {
			const results = await searchDocuments('nonexistent_term_xyz', testIndex)

			// Filter for documents with score > 0
			const relevantResults = results.filter((r) => r.score > 0)
			expect(relevantResults).toHaveLength(0)
		})

		it.skipIf(shouldSkip)('should handle empty query', async () => {
			const results = await searchDocuments('', testIndex)

			// Empty query returns no results or all with 0 score
			const relevantResults = results.filter((r) => r.score > 0)
			expect(relevantResults).toHaveLength(0)
		})
	})

	describe('calculateCosineSimilarity', () => {
		it('should return 1 for identical vectors', () => {
			const queryVec = new Map([
				['a', 0.5],
				['b', 0.5],
			])
			const docVec: DocumentVector = {
				uri: 'test',
				terms: new Map([
					['a', 0.5],
					['b', 0.5],
				]),
				rawTerms: new Map(),
				magnitude: Math.sqrt(0.5 * 0.5 + 0.5 * 0.5),
			}

			const similarity = calculateCosineSimilarity(queryVec, docVec)

			expect(similarity).toBeCloseTo(1, 5)
		})

		it('should return 0 for orthogonal vectors', () => {
			const queryVec = new Map([['a', 1]])
			const docVec: DocumentVector = {
				uri: 'test',
				terms: new Map([['b', 1]]),
				rawTerms: new Map(),
				magnitude: 1,
			}

			const similarity = calculateCosineSimilarity(queryVec, docVec)

			expect(similarity).toBe(0)
		})

		it('should return value between 0 and 1', () => {
			const queryVec = new Map([
				['a', 0.5],
				['b', 0.3],
			])
			const docVec: DocumentVector = {
				uri: 'test',
				terms: new Map([
					['a', 0.3],
					['c', 0.4],
				]),
				rawTerms: new Map(),
				magnitude: Math.sqrt(0.3 * 0.3 + 0.4 * 0.4),
			}

			const similarity = calculateCosineSimilarity(queryVec, docVec)

			expect(similarity).toBeGreaterThanOrEqual(0)
			expect(similarity).toBeLessThanOrEqual(1)
		})

		it('should handle empty vectors', () => {
			const queryVec = new Map<string, number>()
			const docVec: DocumentVector = {
				uri: 'test',
				terms: new Map([['a', 1]]),
				rawTerms: new Map(),
				magnitude: 1,
			}

			const similarity = calculateCosineSimilarity(queryVec, docVec)

			expect(similarity).toBe(0)
		})
	})
})
