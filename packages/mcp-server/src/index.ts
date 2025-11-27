#!/usr/bin/env node

/**
 * MCP Codebase Search Server
 * MCP server providing intelligent codebase search
 */

import {
	CodebaseIndexer,
	createEmbeddingProvider,
	type EmbeddingProvider,
	PersistentStorage,
	semanticSearch,
} from '@sylphx/coderag'
import { createServer, stdio, text, tool } from '@sylphx/mcp-server-sdk'
import { z } from 'zod'

// Logger utility (stderr for MCP)
const Logger = {
	info: (message: string) => console.error(`[INFO] ${message}`),
	success: (message: string) => console.error(`[SUCCESS] ${message}`),
	error: (message: string, error?: unknown) => {
		console.error(`[ERROR] ${message}`)
		if (error) {
			console.error(error)
		}
	},
}

const SERVER_CONFIG = {
	name: '@sylphx/coderag-mcp',
	version: '1.0.0',
}

/**
 * Start the MCP Codebase Search Server
 */
async function main() {
	Logger.info('🚀 Starting MCP Codebase Search Server...')

	// Parse command line arguments
	const args = process.argv.slice(2)
	const codebaseRoot = args.find((arg) => arg.startsWith('--root='))?.split('=')[1] || process.cwd()
	const maxFileSize = parseInt(
		args.find((arg) => arg.startsWith('--max-size='))?.split('=')[1] || '1048576',
		10
	) // 1MB default
	const autoIndex = !args.includes('--no-auto-index')

	Logger.info(`📂 Codebase root: ${codebaseRoot}`)
	Logger.info(`📏 Max file size: ${(maxFileSize / 1024 / 1024).toFixed(2)} MB`)
	Logger.info(`🔄 Auto-index: ${autoIndex ? 'enabled' : 'disabled'}`)

	// Check for embedding provider (OpenAI API key)
	let embeddingProvider: EmbeddingProvider | undefined
	const openaiApiKey = process.env.OPENAI_API_KEY

	if (openaiApiKey) {
		try {
			embeddingProvider = await createEmbeddingProvider({
				provider: 'openai',
				model: 'text-embedding-3-small',
				dimensions: 1536,
			})
			Logger.info('🧠 Semantic search enabled (OpenAI embeddings)')
		} catch (error) {
			Logger.error('Failed to initialize embedding provider', error)
			Logger.info('⚠️ Falling back to keyword search')
		}
	} else {
		Logger.info('🔤 Keyword search mode (no OPENAI_API_KEY)')
	}

	const isSemanticSearch = !!embeddingProvider

	// Create persistent storage
	const storage = new PersistentStorage({ codebaseRoot })
	Logger.info('💾 Using persistent storage (SQLite)')

	// Create indexer
	const indexer = new CodebaseIndexer({
		codebaseRoot,
		maxFileSize,
		storage,
		embeddingProvider,
	})

	// Tool descriptions based on search mode
	const toolDescription = isSemanticSearch
		? `Semantic search across the codebase using AI embeddings. Use natural language to describe what you're looking for.

**IMPORTANT: Use this tool PROACTIVELY before starting work, not reactively when stuck.**

This tool understands the meaning of your query and finds semantically related code, even if the exact words don't match.

When to use:
- **Before implementation**: "authentication flow with JWT tokens"
- **Before refactoring**: "error handling patterns"
- **Before debugging**: "database connection retry logic"

**Best Practice**: Describe what you're looking for in plain English.`
		: `Keyword search across the codebase using TF-IDF ranking. Use specific terms, function names, or technical keywords.

**IMPORTANT: Use this tool PROACTIVELY before starting work, not reactively when stuck.**

This tool finds files containing your exact search terms, ranked by relevance.

When to use:
- **Find specific functions**: "getUserById", "handleAuth"
- **Find error messages**: "ECONNREFUSED", "TypeError"
- **Find imports/exports**: "export const", "import { Router }"

**Best Practice**: Use specific keywords, function names, or exact terms.`

	const queryDescription = isSemanticSearch
		? 'Semantic search query - describe what you are looking for in natural language'
		: 'Keyword search query - use specific terms, function names, or technical keywords'

	// Define codebase search tool using builder pattern
	const codebaseSearch = tool()
		.description(toolDescription)
		.input(
			z.object({
				query: z.string().describe(queryDescription),
				limit: z
					.number()
					.default(10)
					.optional()
					.describe('Maximum number of results to return (default: 10)'),
				include_content: z
					.boolean()
					.default(true)
					.optional()
					.describe('Include file content snippets in results (default: true)'),
				file_extensions: z
					.array(z.string())
					.optional()
					.describe('Filter by file extensions (e.g., [".ts", ".tsx", ".js"])'),
				path_filter: z
					.string()
					.optional()
					.describe('Filter by path pattern (e.g., "src/components", "tests", "docs")'),
				exclude_paths: z
					.array(z.string())
					.optional()
					.describe(
						'Exclude paths containing these patterns (e.g., ["node_modules", ".git", "dist"])'
					),
			})
		)
		.handler(async ({ input }) => {
			try {
				const {
					query,
					limit = 10,
					include_content = true,
					file_extensions,
					path_filter,
					exclude_paths,
				} = input

				// Check indexing status
				const status = indexer.getStatus()

				if (status.isIndexing) {
					const progressBar =
						'█'.repeat(Math.floor(status.progress / 5)) +
						'░'.repeat(20 - Math.floor(status.progress / 5))

					return text(
						`⏳ **Codebase Indexing In Progress**\n\nThe codebase is currently being indexed. Please wait...\n\n**Progress:** ${status.progress}%\n\`${progressBar}\`\n\n**Status:**\n- Files indexed: ${status.indexedFiles}/${status.totalFiles}\n${status.currentFile ? `- Current file: \`${status.currentFile}\`` : ''}\n\n💡 **Tip:** Try your search again in a few seconds.`
					)
				}

				const indexedCount = await indexer.getIndexedCount()
				if (indexedCount === 0) {
					return text(
						`📭 **Codebase Not Indexed**\n\nThe codebase has not been indexed yet. The MCP server should automatically index on startup.\n\n**If this persists:**\n- Restart the MCP server\n- Check the server logs for errors`
					)
				}

				// Perform search (semantic if available, otherwise keyword)
				const results = isSemanticSearch
					? await semanticSearch(query, indexer, {
							limit,
							fileExtensions: file_extensions,
							pathFilter: path_filter,
							excludePaths: exclude_paths,
						})
					: await indexer.search(query, {
							limit,
							includeContent: include_content,
							fileExtensions: file_extensions,
							pathFilter: path_filter,
							excludePaths: exclude_paths,
						})

				if (results.length === 0) {
					return text(
						`🔍 **No Results Found**\n\nNo files matched your search query: "${query}"\n\n**Suggestions:**\n- Try different search terms\n- ${isSemanticSearch ? 'Describe what you are looking for differently' : 'Use more specific keywords'}\n- Check if file filters are too restrictive\n\n**Total files indexed:** ${indexedCount}`
					)
				}

				// Format results
				const searchMode = isSemanticSearch ? 'Semantic' : 'Keyword'
				let formattedResults = `# 🔍 ${searchMode} Search Results\n\n**Query:** "${query}"\n**Results:** ${results.length} / ${indexedCount} files\n\n`

				for (let i = 0; i < results.length; i++) {
					const result = results[i]
					formattedResults += `## ${i + 1}. \`${result.path}\`\n\n`
					formattedResults += `- **Score:** ${result.score.toFixed(4)}\n`
					if (result.language) {
						formattedResults += `- **Language:** ${result.language}\n`
					}
					if ('size' in result && result.size) {
						formattedResults += `- **Size:** ${(result.size / 1024).toFixed(2)} KB\n`
					}
					if (result.matchedTerms && result.matchedTerms.length > 0) {
						formattedResults += `- **Matched Terms:** ${result.matchedTerms.join(', ')}\n`
					}

					// Show content snippet
					if ('snippet' in result && result.snippet) {
						formattedResults += `\n**Snippet:**\n\`\`\`\n${result.snippet}\n\`\`\`\n`
					} else if ('content' in result && result.content) {
						formattedResults += `\n**Preview:**\n\`\`\`\n${result.content.substring(0, 500)}${result.content.length > 500 ? '...' : ''}\n\`\`\`\n`
					}

					formattedResults += '\n---\n\n'
				}

				return text(formattedResults)
			} catch (error) {
				return text(`✗ Codebase search error: ${(error as Error).message}`)
			}
		})

	// Create MCP server with the new SDK
	const serverDescription = isSemanticSearch
		? 'MCP server providing semantic code search using AI embeddings'
		: 'MCP server providing keyword-based code search using TF-IDF'

	const server = createServer({
		name: SERVER_CONFIG.name,
		version: SERVER_CONFIG.version,
		instructions: serverDescription,
		tools: {
			codebase_search: codebaseSearch,
		},
		transport: stdio(),
	})

	Logger.info(
		`✓ Registered codebase_search tool (${isSemanticSearch ? 'semantic' : 'keyword'} mode)`
	)

	// Auto-index on startup if enabled
	if (autoIndex) {
		Logger.info('📚 Starting automatic indexing...')
		try {
			await indexer.index({
				watch: true, // Enable file watching
				onProgress: (current, total, file) => {
					if (current % 100 === 0 || current === total) {
						Logger.info(`Indexing: ${current}/${total} files (${file})`)
					}
				},
				onFileChange: (event) => {
					Logger.info(`File ${event.type}: ${event.path}`)
				},
			})
			Logger.success(`✓ Indexed ${await indexer.getIndexedCount()} files`)
			Logger.info('👁️  Watching for file changes...')
		} catch (error) {
			Logger.error('Failed to index codebase', error)
			Logger.info('⚠️  Continuing without index (search will fail until indexed)')
		}
	}

	// Start server
	try {
		await server.start()
		Logger.success('✓ MCP Server connected and ready')
		Logger.info('💡 Press Ctrl+C to stop the server')
	} catch (error: unknown) {
		Logger.error('Failed to start MCP server', error)
		process.exit(1)
	}
}

// Handle process signals
process.on('SIGINT', () => {
	Logger.info('\n🛑 Shutting down MCP server...')
	process.exit(0)
})

process.on('SIGTERM', () => {
	Logger.info('\n🛑 Shutting down MCP server...')
	process.exit(0)
})

// Start the server
if (import.meta.main) {
	main().catch((error) => {
		Logger.error('Fatal error', error)
		process.exit(1)
	})
}
