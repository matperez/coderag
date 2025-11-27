#!/usr/bin/env node

/**
 * MCP Codebase Search Server
 * MCP server providing intelligent codebase search
 */

import { CodebaseIndexer, PersistentStorage } from '@sylphx/coderag'
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
	description: 'MCP server providing intelligent codebase search using TF-IDF',
}

/**
 * Start the MCP Codebase Search Server
 */
async function main() {
	Logger.info('🚀 Starting MCP Codebase Search Server...')
	Logger.info(`📋 ${SERVER_CONFIG.description}`)

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

	// Create persistent storage
	const storage = new PersistentStorage({ codebaseRoot })
	Logger.info('💾 Using persistent storage (SQLite)')

	// Create indexer
	const indexer = new CodebaseIndexer({
		codebaseRoot,
		maxFileSize,
		storage,
	})

	// Define codebase search tool using builder pattern
	const codebaseSearch = tool()
		.description(`Search project source files, documentation, and code. Use this to find implementations, functions, classes, or any code-related content.

**IMPORTANT: Use this tool PROACTIVELY before starting work, not reactively when stuck.**

This tool searches across all codebase files and returns the most relevant matches with content snippets.

When to use this tool (BEFORE starting work):
- **Before implementation**: Find existing patterns, similar functions, or reusable components
- **Before refactoring**: Understand current implementation and dependencies
- **Before adding features**: Check for existing similar functionality or conflicting code
- **Before debugging**: Search for error messages, function names, or related code
- **Before writing tests**: Find existing test patterns and test utilities

The search includes:
- Source code files (.ts, .js, .tsx, .jsx, etc.)
- Configuration files (.json, .yaml, .toml, etc.)
- Documentation files (.md, .txt, etc.)
- Build and deployment files

**Best Practice**: Search the codebase BEFORE writing new code to avoid duplication and follow existing patterns.`)
		.input(
			z.object({
				query: z
					.string()
					.describe('Search query - use natural language, function names, or technical terms'),
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

				// Perform search
				const results = await indexer.search(query, {
					limit,
					includeContent: include_content,
					fileExtensions: file_extensions,
					pathFilter: path_filter,
					excludePaths: exclude_paths,
				})

				if (results.length === 0) {
					return text(
						`🔍 **No Results Found**\n\nNo files matched your search query: "${query}"\n\n**Suggestions:**\n- Try different search terms\n- Use more general keywords\n- Check if file filters are too restrictive\n\n**Total files indexed:** ${indexedCount}`
					)
				}

				// Format results
				let formattedResults = `# 🔍 Codebase Search Results\n\n**Query:** "${query}"\n**Results:** ${results.length} / ${indexedCount} files\n\n`

				for (let i = 0; i < results.length; i++) {
					const result = results[i]
					formattedResults += `## ${i + 1}. \`${result.path}\`\n\n`
					formattedResults += `- **Score:** ${result.score.toFixed(4)}\n`
					if (result.language) {
						formattedResults += `- **Language:** ${result.language}\n`
					}
					formattedResults += `- **Size:** ${(result.size / 1024).toFixed(2)} KB\n`
					formattedResults += `- **Matched Terms:** ${result.matchedTerms.join(', ')}\n`

					if (result.snippet) {
						formattedResults += `\n**Snippet:**\n\`\`\`\n${result.snippet}\n\`\`\`\n`
					}

					formattedResults += '\n---\n\n'
				}

				return text(formattedResults)
			} catch (error) {
				return text(`✗ Codebase search error: ${(error as Error).message}`)
			}
		})

	// Create MCP server with the new SDK
	const server = createServer({
		name: SERVER_CONFIG.name,
		version: SERVER_CONFIG.version,
		instructions: SERVER_CONFIG.description,
		tools: {
			codebase_search: codebaseSearch,
		},
		transport: stdio(),
	})

	Logger.info('✓ Registered codebase_search tool')

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
