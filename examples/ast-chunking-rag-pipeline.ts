/**
 * Complete RAG Pipeline with AST-based Chunking
 *
 * This example shows how to use Synth AST chunking in a real RAG workflow:
 * 1. Chunk code using AST analysis
 * 2. Generate embeddings for each chunk
 * 3. Store in vector database
 * 4. Perform hybrid search (keyword + semantic)
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import {
	type ChunkResult,
	chunkCodeByAST,
	getDefaultEmbeddingProvider,
	VectorStorage,
} from '@sylphx/coderag'

// ============================================
// Step 1: Chunk Code with AST Analysis
// ============================================

async function chunkCodebase(files: string[]): Promise<Map<string, ChunkResult[]>> {
	const chunkedFiles = new Map<string, ChunkResult[]>()

	for (const filePath of files) {
		console.log(`📄 Processing: ${filePath}`)

		const code = await fs.readFile(filePath, 'utf-8')

		// Use AST-based chunking
		const chunks = await chunkCodeByAST(code, filePath, {
			maxChunkSize: 1000,
			minChunkSize: 100,
			preserveContext: true, // Include imports/types
		})

		chunkedFiles.set(filePath, chunks)

		console.log(`  ✅ Split into ${chunks.length} chunks (${chunks.map((c) => c.type).join(', ')})`)
	}

	return chunkedFiles
}

// ============================================
// Step 2: Generate Embeddings
// ============================================

async function generateEmbeddings(chunks: ChunkResult[]): Promise<number[][]> {
	const provider = await getDefaultEmbeddingProvider()

	console.log(`🔮 Generating embeddings for ${chunks.length} chunks...`)

	// Extract just the text content
	const texts = chunks.map((chunk) => chunk.content)

	// Generate embeddings in batch
	const embeddings = await provider.generateEmbeddings(texts)

	console.log(`  ✅ Generated ${embeddings.length} embeddings (${provider.dimensions}D)`)

	return embeddings
}

// ============================================
// Step 3: Store in Vector Database
// ============================================

async function storeInVectorDB(
	chunkedFiles: Map<string, ChunkResult[]>,
	dbPath: string
): Promise<VectorStorage> {
	console.log(`💾 Storing in vector database: ${dbPath}`)

	const provider = await getDefaultEmbeddingProvider()
	const vectorDB = new VectorStorage({
		dbPath,
		dimensions: provider.dimensions,
		maxElements: 10000,
	})

	let totalChunks = 0

	for (const [filePath, chunks] of chunkedFiles.entries()) {
		// Generate embeddings for this file's chunks
		const embeddings = await generateEmbeddings(chunks)

		// Store each chunk with metadata
		for (let i = 0; i < chunks.length; i++) {
			const chunk = chunks[i]
			const embedding = embeddings[i]

			await vectorDB.addDocument({
				id: `${filePath}:${chunk.startLine}-${chunk.endLine}`,
				content: chunk.content,
				embedding,
				metadata: {
					filePath,
					type: chunk.type,
					startLine: chunk.startLine,
					endLine: chunk.endLine,
					language: path.extname(filePath).slice(1),
					...chunk.metadata,
				},
			})

			totalChunks++
		}
	}

	console.log(`  ✅ Stored ${totalChunks} chunks`)

	return vectorDB
}

// ============================================
// Step 4: Perform Hybrid Search
// ============================================

async function searchCodebase(vectorDB: VectorStorage, query: string, topK = 5) {
	console.log(`\n🔍 Searching: "${query}"`)

	const provider = await getDefaultEmbeddingProvider()
	const queryEmbedding = await provider.generateEmbedding(query)

	const results = await vectorDB.search(queryEmbedding, topK)

	console.log(`\n📊 Top ${results.length} Results:\n`)

	results.forEach((result, i) => {
		console.log(`${i + 1}. [${result.metadata?.type}] ${result.metadata?.filePath}`)
		console.log(`   Lines ${result.metadata?.startLine}-${result.metadata?.endLine}`)
		console.log(`   Score: ${result.score.toFixed(4)}`)
		console.log(`   Preview: ${result.content.slice(0, 100)}...`)
		console.log()
	})

	return results
}

// ============================================
// Complete Pipeline Example
// ============================================

async function _main() {
	console.log('🚀 AST-based Code Chunking RAG Pipeline\n')

	// Example: Index some files
	const files = [
		'packages/core/src/embeddings.ts',
		'packages/core/src/ast-chunking.ts',
		'README.md',
	]

	try {
		// Step 1: Chunk codebase
		console.log('📦 Step 1: Chunking codebase with AST analysis\n')
		const chunkedFiles = await chunkCodebase(files)

		// Step 2 & 3: Generate embeddings and store
		console.log('\n📦 Step 2: Generating embeddings and storing\n')
		const vectorDB = await storeInVectorDB(chunkedFiles, ':memory:')

		// Step 4: Search
		console.log('\n📦 Step 3: Performing semantic search\n')
		await searchCodebase(vectorDB, 'How to chunk text into smaller pieces?')
		await searchCodebase(vectorDB, 'AST parsing and traversal')
		await searchCodebase(vectorDB, 'embeddings generation')

		// Get stats
		const stats = await vectorDB.getStats()
		console.log('\n📊 Final Statistics:')
		console.log(`  Documents: ${stats.documentCount}`)
		console.log(`  Dimensions: ${stats.dimensions}`)
		console.log(`  Max Elements: ${stats.maxElements}`)

		console.log('\n✅ Pipeline completed successfully!')
	} catch (error) {
		console.error('\n❌ Pipeline failed:', error)
		throw error
	}
}

// ============================================
// Comparison: AST vs Character Chunking
// ============================================

async function compareChunkingStrategies() {
	console.log('\n📊 Comparing AST vs Character Chunking\n')

	const code = `
import { foo } from 'bar';

function calculateTotal(items) {
  let sum = 0;
  for (const item of items) {
    sum += item.price;
  }
  return sum;
}

function processOrder(order) {
  const total = calculateTotal(order.items);
  return { ...order, total };
}
`

	// Character-based chunking
	console.log('📝 Character-based Chunking:')
	const { chunkText } = await import('@sylphx/coderag')
	const charChunks = chunkText(code, { maxChunkSize: 150, overlap: 20 })
	charChunks.forEach((chunk, i) => {
		console.log(`  Chunk ${i + 1}: ${chunk.split('\n')[0]}...`)
	})
	console.log(`  Total: ${charChunks.length} chunks\n`)

	// AST-based chunking
	console.log('🌳 AST-based Chunking:')
	const astChunks = await chunkCodeByAST(code, 'example.js', {
		preserveContext: true,
	})
	astChunks.forEach((chunk, i) => {
		console.log(`  Chunk ${i + 1} [${chunk.type}]: ${chunk.content.split('\n')[0]}...`)
	})
	console.log(`  Total: ${astChunks.length} chunks\n`)

	console.log('✅ AST chunking preserves semantic boundaries!')
}

// ============================================
// Run Examples
// ============================================

// Uncomment to run:
// main().catch(console.error);
// compareChunkingStrategies().catch(console.error);

export {
	chunkCodebase,
	generateEmbeddings,
	storeInVectorDB,
	searchCodebase,
	compareChunkingStrategies,
}
