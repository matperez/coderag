/**
 * AST-Based Code Chunking using code-chunk (tree-sitter)
 *
 * Splits code at semantic boundaries (functions, classes, etc.)
 * Supports TypeScript, JavaScript, Python, Rust, Go, Java.
 * Other file types use character-based fallback.
 */

import { chunk as codeChunk } from 'code-chunk'
import type { Chunk as CodeChunkChunk } from 'code-chunk'
import { chunkText } from './embeddings.js'

// ============================================
// Chunking Types
// ============================================

/**
 * AST-based chunking options
 */
export interface ASTChunkOptions {
	readonly maxChunkSize?: number
	readonly minChunkSize?: number
}

/**
 * Chunk result with metadata
 */
export interface ChunkResult {
	readonly content: string
	readonly type: string
	readonly startLine: number
	readonly endLine: number
	readonly metadata: Record<string, unknown>
}

/** Languages supported by code-chunk for AST chunking */
const CODE_CHUNK_SUPPORTED_LANGUAGES = [
	'typescript',
	'javascript',
	'python',
	'rust',
	'go',
	'java',
] as const

/**
 * Create fallback chunks using character-based splitting
 */
function createFallbackChunks(code: string, maxChunkSize: number): ChunkResult[] {
	const chunks = chunkText(code, { maxChunkSize })
	return chunks.map((content, i) => ({
		content,
		type: 'text',
		startLine: 0,
		endLine: 0,
		metadata: { fallback: true, index: i },
	}))
}

function mapCodeChunkToResult(c: CodeChunkChunk): ChunkResult {
	const firstEntity = c.context.entities[0]
	const type = firstEntity?.type ?? 'chunk'
	return {
		content: c.text,
		type,
		startLine: c.lineRange.start + 1,
		endLine: c.lineRange.end + 1,
		metadata: {
			fallback: false,
			scope: c.context.scope.map((s) => ({ name: s.name, type: s.type })),
			entities: c.context.entities.map((e) => ({
				name: e.name,
				type: e.type,
				signature: e.signature,
			})),
		},
	}
}

/**
 * Chunk code using AST analysis (via code-chunk / tree-sitter)
 *
 * Supported extensions: .ts, .tsx, .js, .jsx, .mjs, .cjs, .py, .pyi, .rs, .go, .java.
 * Other files are chunked with character-based fallback.
 */
export async function chunkCodeByAST(
	code: string,
	filePath: string,
	options: ASTChunkOptions = {}
): Promise<readonly ChunkResult[]> {
	const maxChunkSize = options.maxChunkSize ?? 1000

	try {
		const chunks = await codeChunk(filePath, code, {
			maxChunkSize,
			contextMode: 'full',
		})
		if (chunks.length === 0 && code.trim().length > 0) {
			return createFallbackChunks(code, maxChunkSize)
		}
		return chunks.map(mapCodeChunkToResult)
	} catch (error) {
		// UnsupportedLanguageError, ChunkingError, or any other: fall back to character chunking
		const err = error instanceof Error ? error : new Error(String(error))
		const causeMsg = err.cause instanceof Error ? ` (cause: ${err.cause.message})` : ''
		console.error(
			'[WARN] AST chunking failed, falling back to character chunking:',
			filePath,
			'-',
			err.message + causeMsg
		)
		return createFallbackChunks(code, maxChunkSize)
	}
}

/**
 * Simple wrapper for backward compatibility
 */
export async function chunkCodeByASTSimple(
	code: string,
	filePath: string,
	options: ASTChunkOptions = {}
): Promise<readonly string[]> {
	const chunks = await chunkCodeByAST(code, filePath, options)
	return chunks.map((chunk) => chunk.content)
}

/**
 * Get list of languages supported for AST chunking (code-chunk)
 */
export function getSupportedLanguages(): string[] {
	return [...CODE_CHUNK_SUPPORTED_LANGUAGES]
}
