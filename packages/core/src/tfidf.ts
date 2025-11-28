/**
 * BM25 (Best Matching 25) implementation
 * Using StarCoder2 tokenizer for code-aware tokenization
 *
 * BM25 improves on TF-IDF with:
 * 1. Term frequency saturation (k1 parameter) - diminishing returns for repeated terms
 * 2. Document length normalization (b parameter) - adjusts for document length
 */

import { initializeTokenizer, tokenize as starcoderTokenize } from './code-tokenizer.js'

// Re-export tokenize for external use
export { initializeTokenizer }

// BM25 parameters (Elasticsearch/Lucene defaults)
const BM25_K1 = 1.2 // Term frequency saturation (1.2-2.0 typical)
const BM25_B = 0.75 // Length normalization (0.75 typical, 0 = no normalization, 1 = full normalization)

// Query token cache - avoids re-tokenizing the same query (CPU optimization)
const queryTokenCache = new Map<string, string[]>()
const QUERY_CACHE_MAX_SIZE = 100

async function getCachedQueryTokens(query: string): Promise<string[]> {
	const cached = queryTokenCache.get(query)
	if (cached) return cached

	// Tokenize and dedupe
	const tokens = [...new Set(await tokenize(query))]

	// LRU-style eviction: remove oldest if full
	if (queryTokenCache.size >= QUERY_CACHE_MAX_SIZE) {
		const firstKey = queryTokenCache.keys().next().value
		if (firstKey) queryTokenCache.delete(firstKey)
	}

	queryTokenCache.set(query, tokens)
	return tokens
}

export interface DocumentVector {
	uri: string
	terms: Map<string, number> // term → TF-IDF score
	rawTerms: Map<string, number> // term → raw frequency
	magnitude: number // Vector magnitude for cosine similarity
}

export interface SearchIndex {
	documents: DocumentVector[]
	idf: Map<string, number> // term → IDF score
	totalDocuments: number
	metadata: {
		generatedAt: string
		version: string
	}
}

/**
 * Tokenize code using StarCoder2 (async)
 */
export async function tokenize(text: string): Promise<string[]> {
	return starcoderTokenize(text)
}

/**
 * Calculate Term Frequency (TF)
 */
function calculateTF(termFrequency: Map<string, number>): Map<string, number> {
	const totalTerms = Array.from(termFrequency.values()).reduce((sum, freq) => sum + freq, 0)
	const tf = new Map<string, number>()

	for (const [term, freq] of termFrequency.entries()) {
		tf.set(term, freq / totalTerms)
	}

	return tf
}

/**
 * Calculate Inverse Document Frequency (IDF)
 */
function calculateIDF(
	documents: Map<string, number>[],
	totalDocuments: number
): Map<string, number> {
	const documentFrequency = new Map<string, number>()

	// Count how many documents contain each term
	for (const doc of documents) {
		const uniqueTerms = new Set(doc.keys())
		for (const term of uniqueTerms) {
			documentFrequency.set(term, (documentFrequency.get(term) || 0) + 1)
		}
	}

	// Calculate IDF for each term using smoothed formula
	// Standard formula: log(N/df) = 0 when term appears in ALL documents
	// Smoothed formula: log((N+1)/(df+1)) + 1 ensures no term gets IDF=0
	const idf = new Map<string, number>()
	for (const [term, docFreq] of documentFrequency.entries()) {
		idf.set(term, Math.log((totalDocuments + 1) / (docFreq + 1)) + 1)
	}

	return idf
}

/**
 * Calculate TF-IDF scores for a document
 */
function calculateTFIDF(tf: Map<string, number>, idf: Map<string, number>): Map<string, number> {
	const tfidf = new Map<string, number>()

	for (const [term, tfScore] of tf.entries()) {
		const idfScore = idf.get(term) || 0
		tfidf.set(term, tfScore * idfScore)
	}

	return tfidf
}

/**
 * Calculate vector magnitude for cosine similarity
 */
function calculateMagnitude(vector: Map<string, number>): number {
	let sum = 0
	for (const value of vector.values()) {
		sum += value * value
	}
	return Math.sqrt(sum)
}

/**
 * Extract term frequencies from content (async - uses StarCoder2)
 */
async function extractTermFrequencies(content: string): Promise<Map<string, number>> {
	const tokens = await tokenize(content)
	const frequencies = new Map<string, number>()

	for (const token of tokens) {
		frequencies.set(token, (frequencies.get(token) || 0) + 1)
	}

	return frequencies
}

/**
 * Build TF-IDF search index from documents (async - uses StarCoder2)
 */
export async function buildSearchIndex(
	documents: Array<{ uri: string; content: string }>
): Promise<SearchIndex> {
	// Extract term frequencies for all documents
	const documentTerms = await Promise.all(
		documents.map(async (doc) => ({
			uri: doc.uri,
			terms: await extractTermFrequencies(doc.content),
		}))
	)

	// Calculate IDF scores
	const idf = calculateIDF(
		documentTerms.map((d) => d.terms),
		documents.length
	)

	// Calculate TF-IDF for each document
	const documentVectors: DocumentVector[] = documentTerms.map((doc) => {
		const tf = calculateTF(doc.terms)
		const tfidf = calculateTFIDF(tf, idf)
		const magnitude = calculateMagnitude(tfidf)

		return {
			uri: doc.uri,
			terms: tfidf,
			rawTerms: doc.terms,
			magnitude,
		}
	})

	return {
		documents: documentVectors,
		idf,
		totalDocuments: documents.length,
		metadata: {
			generatedAt: new Date().toISOString(),
			version: '1.0.0',
		},
	}
}

/**
 * Calculate cosine similarity between query and document
 */
export function calculateCosineSimilarity(
	queryVector: Map<string, number>,
	docVector: DocumentVector
): number {
	let dotProduct = 0

	// Calculate dot product
	for (const [term, queryScore] of queryVector.entries()) {
		const docScore = docVector.terms.get(term) || 0
		dotProduct += queryScore * docScore
	}

	// Calculate query magnitude
	const queryMagnitude = calculateMagnitude(queryVector)

	if (queryMagnitude === 0 || docVector.magnitude === 0) {
		return 0
	}

	return dotProduct / (queryMagnitude * docVector.magnitude)
}

/**
 * Process query into TF-IDF vector (async - uses StarCoder2)
 */
export async function processQuery(
	query: string,
	idf: Map<string, number>
): Promise<Map<string, number>> {
	const terms = await tokenize(query)
	return processQueryWithTokens(terms, idf)
}

/**
 * Process query from pre-tokenized terms (CPU optimization - avoids re-tokenizing)
 */
function processQueryWithTokens(tokens: string[], idf: Map<string, number>): Map<string, number> {
	const queryVector = new Map<string, number>()

	for (const term of tokens) {
		const idfValue = idf.get(term) || 0
		if (idfValue > 0) {
			queryVector.set(term, idfValue)
		}
	}

	return queryVector
}

/**
 * SQL-based search result from storage
 * Uses pre-computed magnitude and token count for BM25 scoring
 */
export interface StorageSearchResult {
	path: string
	matchedTerms: Map<string, { tfidf: number; rawFreq: number }>
	magnitude: number // Pre-computed from files table (for TF-IDF fallback)
	tokenCount: number // Document length for BM25 scoring
}

/**
 * Search documents using BM25 scoring (SQL-based storage)
 *
 * BM25 formula: score(D,Q) = Σ IDF(qi) * (f(qi,D) * (k1+1)) / (f(qi,D) + k1 * (1 - b + b * |D|/avgdl))
 *
 * Where:
 * - f(qi,D) = raw frequency of term qi in document D
 * - |D| = document length (token count)
 * - avgdl = average document length
 * - k1 = term frequency saturation (default: 1.2)
 * - b = length normalization (default: 0.75)
 */
export async function searchDocumentsFromStorage(
	query: string,
	candidates: StorageSearchResult[],
	idf: Map<string, number>,
	options: {
		limit?: number
		minScore?: number
		avgDocLength?: number // Average document length for BM25
	} = {}
): Promise<Array<{ uri: string; score: number; matchedTerms: string[] }>> {
	const { limit = 10, minScore = 0 } = options

	// Get query tokens (cached)
	const queryTokens = await getCachedQueryTokens(query)

	if (queryTokens.length === 0) {
		return []
	}

	// Calculate average document length if not provided
	// Fallback to average of candidates (less accurate but works without global stats)
	let avgDocLength = options.avgDocLength
	if (!avgDocLength || avgDocLength === 0) {
		const totalTokens = candidates.reduce((sum, c) => sum + (c.tokenCount || 0), 0)
		avgDocLength = candidates.length > 0 ? totalTokens / candidates.length : 1
	}
	// Ensure avgDocLength is at least 1 to avoid division by zero
	avgDocLength = Math.max(avgDocLength, 1)

	// Score each candidate using BM25
	const results: Array<{ uri: string; score: number; matchedTerms: string[] }> = []
	let minThreshold = minScore

	for (const candidate of candidates) {
		// Get matched terms
		const matchedTerms: string[] = []
		for (const term of queryTokens) {
			if (candidate.matchedTerms.has(term)) {
				matchedTerms.push(term)
			}
		}

		if (matchedTerms.length === 0) continue

		// BM25 scoring
		const docLen = candidate.tokenCount || 1
		let score = 0

		for (const term of matchedTerms) {
			const docData = candidate.matchedTerms.get(term)
			if (!docData) continue

			const termFreq = docData.rawFreq
			const termIdf = idf.get(term) || 0

			// BM25 term score: IDF * (tf * (k1+1)) / (tf + k1 * (1 - b + b * docLen/avgdl))
			const numerator = termFreq * (BM25_K1 + 1)
			const denominator = termFreq + BM25_K1 * (1 - BM25_B + (BM25_B * docLen) / avgDocLength)
			score += termIdf * (numerator / denominator)
		}

		if (score < minThreshold) continue

		results.push({ uri: `file://${candidate.path}`, score, matchedTerms })

		// Bounded results (optimization for large candidate sets)
		if (results.length >= limit * 2) {
			results.sort((a, b) => b.score - a.score)
			results.length = limit
			minThreshold = results[results.length - 1].score
		}
	}

	return results.sort((a, b) => b.score - a.score).slice(0, limit)
}

/**
 * Get query tokens (exported for SQL-based search) - async
 */
export async function getQueryTokens(query: string): Promise<string[]> {
	return getCachedQueryTokens(query)
}

/**
 * Search documents using BM25 scoring (in-memory index)
 *
 * For in-memory search, document length is calculated from rawTerms.
 * Average document length is calculated from all documents in the index.
 */
export async function searchDocuments(
	query: string,
	index: SearchIndex,
	options: {
		limit?: number
		minScore?: number
	} = {}
): Promise<Array<{ uri: string; score: number; matchedTerms: string[] }>> {
	const { limit = 10, minScore = 0 } = options

	// Process query with cached tokens (CPU optimization)
	const queryTokens = await getCachedQueryTokens(query)

	if (queryTokens.length === 0) {
		return []
	}

	// Calculate average document length from index
	let totalTokens = 0
	for (const doc of index.documents) {
		for (const freq of doc.rawTerms.values()) {
			totalTokens += freq
		}
	}
	const avgDocLength = index.documents.length > 0 ? totalTokens / index.documents.length : 1

	// Score documents using BM25
	const results: Array<{ uri: string; score: number; matchedTerms: string[] }> = []
	let minThreshold = minScore

	for (const doc of index.documents) {
		// Get matched terms
		const matchedTerms: string[] = []
		for (const token of queryTokens) {
			if (doc.rawTerms.has(token)) {
				matchedTerms.push(token)
			}
		}

		if (matchedTerms.length === 0) continue

		// Calculate document length (sum of all term frequencies)
		let docLen = 0
		for (const freq of doc.rawTerms.values()) {
			docLen += freq
		}
		docLen = Math.max(docLen, 1) // Avoid division by zero

		// BM25 scoring
		let score = 0
		for (const term of matchedTerms) {
			const termFreq = doc.rawTerms.get(term) || 0
			const termIdf = index.idf.get(term) || 0

			// BM25 term score
			const numerator = termFreq * (BM25_K1 + 1)
			const denominator = termFreq + BM25_K1 * (1 - BM25_B + (BM25_B * docLen) / avgDocLength)
			score += termIdf * (numerator / denominator)
		}

		if (score < minThreshold) continue

		results.push({ uri: doc.uri, score, matchedTerms })

		// Bounded results (optimization)
		if (results.length >= limit * 2) {
			results.sort((a, b) => b.score - a.score)
			results.length = limit
			minThreshold = results[results.length - 1].score
		}
	}

	return results.sort((a, b) => b.score - a.score).slice(0, limit)
}
