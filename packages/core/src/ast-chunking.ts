/**
 * AST-Based Code Chunking using code-chunk (tree-sitter)
 *
 * Splits code at semantic boundaries (functions, classes, etc.)
 * Supports TypeScript, JavaScript, Python, Rust, Go, Java.
 * Other file types use character-based fallback.
 *
 * When CODERAG_USE_CHUNK_WORKER=1, chunking runs in a separate worker that is
 * restarted every N files to avoid web-tree-sitter memory growth on large codebases.
 */

import { Worker } from 'worker_threads'
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

/** Restart chunk worker every N files to limit parser memory growth (web-tree-sitter leak) */
const AST_CHUNK_RESTART_INTERVAL = 4000

/** Use separate worker for chunking (restarted every N files) to avoid parser memory growth. Set CODERAG_USE_CHUNK_WORKER=0 to disable. */
let useChunkWorker = process.env.CODERAG_USE_CHUNK_WORKER === '1'

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

/** Map worker serialized chunk to ChunkResult */
function mapSerializedToResult(c: {
	text: string
	lineRange: { start: number; end: number }
	context: { scope: Array<{ name: string; type: string }>; entities: Array<{ name: string; type: string; signature?: string }> }
}): ChunkResult {
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

let workerInstance: Worker | null = null
let workerFileCount = 0
let workerNextId = 0
const workerPending = new Map<string, { resolve: (v: ChunkResult[]) => void; reject: (e: Error) => void }>()

function getWorkerUrl(): URL {
	return new URL('chunk-worker.js', import.meta.url)
}

function restartWorker(): void {
	if (workerInstance) {
		for (const [, { reject }] of workerPending) {
			reject(new Error('Chunk worker restarted'))
		}
		workerPending.clear()
		workerInstance.terminate().catch(() => {})
		workerInstance = null
	}
}

function ensureWorker(): Worker {
	if (workerInstance) return workerInstance
	const workerUrl = getWorkerUrl()
	workerInstance = new Worker(workerUrl, {
		execArgv: [],
		env: process.env,
		// @ts-expect-error type: 'module' supported in Node 18+
		type: 'module',
	})
	workerInstance.on('message', (msg: { type: string; id: string; chunks?: unknown[]; message?: string; cause?: string; stack?: string }) => {
		const entry = msg.id ? workerPending.get(msg.id) : undefined
		if (!entry) return
		workerPending.delete(msg.id)
		if (msg.type === 'done' && Array.isArray(msg.chunks)) {
			entry.resolve(msg.chunks.map(mapSerializedToResult))
		} else {
			const e = new Error(msg.message ?? 'Chunk worker error')
			if (msg.cause) (e as Error & { cause?: Error }).cause = new Error(msg.cause)
			if (msg.stack) e.stack = msg.stack
			entry.reject(e)
		}
	})
	workerInstance.on('error', (err) => {
		for (const [, { reject }] of workerPending) {
			reject(err)
		}
		workerPending.clear()
		workerInstance = null
	})
	return workerInstance
}

function chunkViaWorker(filePath: string, code: string, maxChunkSize: number): Promise<ChunkResult[]> {
	workerFileCount++
	if (workerFileCount > 0 && workerFileCount % AST_CHUNK_RESTART_INTERVAL === 0) {
		restartWorker()
	}
	const worker = ensureWorker()
	const id = `c${++workerNextId}`
	return new Promise((resolve, reject) => {
		workerPending.set(id, { resolve, reject })
		worker.postMessage({ type: 'chunk', id, filePath, code, maxChunkSize })
	})
}

/** Whether this is an "unsupported file type" (expected fallback); log short line only. */
function isUnsupportedFileTypeError(error: unknown): boolean {
	const err = error instanceof Error ? error : null
	if (!err) return false
	const msg = (err.message ?? '').toLowerCase()
	const causeMsg =
		err.cause instanceof Error ? (err.cause.message ?? '').toLowerCase() : ''
	return (
		err.name === 'UnsupportedLanguageError' ||
		msg.includes('unsupported file type') ||
		msg.includes('unsupported language') ||
		causeMsg.includes('unsupported file type') ||
		causeMsg.includes('unsupported language')
	)
}

/** Format full error details for debugging parser degradation (same file parses after restart). */
function formatChunkErrorDetails(filePath: string, error: unknown): void {
	const err = error instanceof Error ? error : new Error(String(error))
	const short = `[WARN] AST chunking failed, falling back to character chunking: ${filePath}`
	if (isUnsupportedFileTypeError(error)) {
		console.error(short)
		return
	}
	const lines: string[] = [short, `  message: ${err.name}: ${err.message}`]
	if (err.cause !== undefined && err.cause !== null) {
		const c = err.cause instanceof Error ? err.cause : new Error(String(err.cause))
		lines.push(`  cause: ${c.name}: ${c.message}`)
		if (c.stack) lines.push(`  cause stack: ${c.stack.split('\n').slice(0, 5).join('\n            ')}`)
	}
	if (err.stack) {
		lines.push(`  stack: ${err.stack.split('\n').slice(0, 6).join('\n         ')}`)
	}
	console.error(lines.join('\n'))
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

	if (useChunkWorker) {
		try {
			const chunks = await chunkViaWorker(filePath, code, maxChunkSize)
			if (chunks.length === 0 && code.trim().length > 0) {
				return createFallbackChunks(code, maxChunkSize)
			}
			return chunks
		} catch (error) {
			formatChunkErrorDetails(filePath, error)
			return createFallbackChunks(code, maxChunkSize)
		}
	}

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
		formatChunkErrorDetails(filePath, error)
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
 * Enable or disable chunk worker mode (restart worker every N files to limit memory).
 * Call from the indexer at start of index() so long-running indexing does not OOM.
 */
export function setChunkWorkerEnabled(enabled: boolean): void {
	useChunkWorker = enabled
}

/**
 * Get list of languages supported for AST chunking (code-chunk)
 */
export function getSupportedLanguages(): string[] {
	return [...CODE_CHUNK_SUPPORTED_LANGUAGES]
}
