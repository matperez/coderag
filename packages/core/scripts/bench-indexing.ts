/**
 * Benchmark indexing with different optimization combinations.
 * Usage: bun run scripts/bench-indexing.ts [codebase_root]
 * Or:    CODEBASE_ROOT=/path bun run scripts/bench-indexing.ts
 * Default codebase: ~/go/src/gitlab.ozon.ru/platform
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CodebaseIndexer } from '../src/indexer.js'
import { PersistentStorage } from '../src/storage-persistent.js'

const codebaseRoot =
	process.env.CODEBASE_ROOT ??
	process.argv[2] ??
	path.join(os.homedir(), 'go', 'src', 'gitlab.ozon.ru', 'platform')

function formatSec(ms: number): string {
	return (ms / 1000).toFixed(2) + 's'
}

async function runScenario(
	name: string,
	config: {
		useBulkInsertChunks: boolean
		useParallelTokenize: boolean
		skipUnchanged: boolean
		runs?: number
	}
): Promise<void> {
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coderag-bench-'))
	const dbPath = path.join(tmpDir, 'coderag.db')
	try {
		const storage = new PersistentStorage({
			dbPath,
			codebaseRoot,
			useBulkInsertChunks: config.useBulkInsertChunks,
		})
		const indexer = new CodebaseIndexer({
			codebaseRoot,
			storage,
		})

		const runs = config.runs ?? 1
		for (let r = 0; r < runs; r++) {
			const runLabel = runs > 1 ? ` ${r + 1}/${runs}` : ''
			const start = performance.now()
			await indexer.index({
				useParallelTokenize: config.useParallelTokenize,
				skipUnchanged: config.skipUnchanged,
			})
			const elapsed = performance.now() - start
			console.log(`${name}${runLabel}: ${formatSec(elapsed)}`)
		}
	} finally {
		try {
			fs.rmSync(tmpDir, { recursive: true, force: true })
		} catch {
			// ignore
		}
	}
}

async function main(): Promise<void> {
	console.log('Codebase:', codebaseRoot)
	if (!fs.existsSync(codebaseRoot)) {
		console.error('Codebase path does not exist:', codebaseRoot)
		process.exit(1)
	}
	console.log('')

	// 1. baseline: all off
	await runScenario('baseline', {
		useBulkInsertChunks: false,
		useParallelTokenize: false,
		skipUnchanged: false,
	})

	// 2. bulk only
	await runScenario('bulk_only', {
		useBulkInsertChunks: true,
		useParallelTokenize: false,
		skipUnchanged: false,
	})

	// 3. parallel only
	await runScenario('parallel_only', {
		useBulkInsertChunks: false,
		useParallelTokenize: true,
		skipUnchanged: false,
	})

	// 4. skip_only: two runs (same DB)
	const skipTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coderag-bench-'))
	const skipDbPath = path.join(skipTmpDir, 'coderag.db')
	try {
		const storage = new PersistentStorage({
			dbPath: skipDbPath,
			codebaseRoot,
			useBulkInsertChunks: false,
		})
		const indexer = new CodebaseIndexer({ codebaseRoot, storage })
		const start1 = performance.now()
		await indexer.index({ useParallelTokenize: false, skipUnchanged: true })
		console.log(`skip_only 1/2: ${formatSec(performance.now() - start1)}`)
		const start2 = performance.now()
		await indexer.index({ useParallelTokenize: false, skipUnchanged: true })
		console.log(`skip_only 2/2: ${formatSec(performance.now() - start2)}`)
	} finally {
		try {
			fs.rmSync(skipTmpDir, { recursive: true, force: true })
		} catch {
			// ignore
		}
	}

	// 5. all_on
	await runScenario('all_on', {
		useBulkInsertChunks: true,
		useParallelTokenize: true,
		skipUnchanged: true,
	})

	// 6. all_on_second_run: same config, second run
	const allTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coderag-bench-'))
	const allDbPath = path.join(allTmpDir, 'coderag.db')
	try {
		const storage = new PersistentStorage({
			dbPath: allDbPath,
			codebaseRoot,
			useBulkInsertChunks: true,
		})
		const indexer = new CodebaseIndexer({ codebaseRoot, storage })
		await indexer.index({ useParallelTokenize: true, skipUnchanged: true })
		const start = performance.now()
		await indexer.index({ useParallelTokenize: true, skipUnchanged: true })
		console.log(`all_on_second_run: ${formatSec(performance.now() - start)}`)
	} finally {
		try {
			fs.rmSync(allTmpDir, { recursive: true, force: true })
		} catch {
			// ignore
		}
	}

	console.log('')
	console.log('Done.')
}

main().catch((err) => {
	console.error(err)
	process.exit(1)
})
