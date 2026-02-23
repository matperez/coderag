/**
 * Worker for AST chunking. Runs code-chunk in a separate thread so we can
 * terminate and respawn it periodically to avoid web-tree-sitter memory growth.
 *
 * Message in:  { type: 'chunk', id: string, filePath: string, code: string, maxChunkSize?: number }
 * Message out: { type: 'done', id: string, chunks: SerializedChunk[] } | { type: 'error', id: string, message: string, cause?: string, stack?: string }
 */

import { parentPort } from 'worker_threads'
import { chunk } from 'code-chunk'

export interface SerializedChunk {
	text: string
	lineRange: { start: number; end: number }
	context: {
		scope: Array<{ name: string; type: string }>
		entities: Array<{ name: string; type: string; signature?: string }>
	}
}

parentPort?.on('message', async (msg: { type: string; id: string; filePath: string; code: string; maxChunkSize?: number }) => {
	if (msg.type !== 'chunk' || !msg.id) return
	try {
		const chunks = await chunk(msg.filePath, msg.code, {
			maxChunkSize: msg.maxChunkSize ?? 1000,
			contextMode: 'full',
		})
		const serialized: SerializedChunk[] = chunks.map((c) => ({
			text: c.text,
			lineRange: c.lineRange,
			context: {
				scope: c.context.scope.map((s) => ({ name: s.name, type: s.type })),
				entities: c.context.entities.map((e) => ({
					name: e.name,
					type: e.type,
					signature: e.signature,
				})),
			},
		}))
		parentPort?.postMessage({ type: 'done', id: msg.id, chunks: serialized })
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err)
		const cause = err instanceof Error && err.cause instanceof Error ? err.cause.message : undefined
		const stack = err instanceof Error ? err.stack : undefined
		parentPort?.postMessage({ type: 'error', id: msg.id, message, cause, stack })
	}
})
