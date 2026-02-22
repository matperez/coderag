/**
 * Code-Aware Tokenizer using StarCoder2
 *
 * StarCoder2 tokenizer is lightweight (only 4.7MB) and provides
 * world-class code tokenization quality without requiring the full model.
 */

import { AutoTokenizer } from '@huggingface/transformers'

/**
 * Simple word/identifier tokenizer fallback when StarCoder2 returns no tokens.
 * Splits on non-alphanumeric and underscore, lowercases, keeps tokens with length > 1.
 */
function simpleWordTokenize(text: string): string[] {
	return text
		.split(/[^a-zA-Z0-9_]+/)
		.filter((w) => w.length > 1)
		.map((w) => w.toLowerCase())
}

export interface CodeToken {
	readonly text: string
	readonly id: number
}

export interface TokenizerOptions {
	readonly modelPath?: string
	readonly cacheDir?: string
}

/**
 * StarCoder2 Code Tokenizer
 *
 * Uses StarCoder2's tokenizer (4.7MB) for accurate code tokenization.
 * Does NOT require downloading the full 15B parameter model.
 */
export class CodeTokenizer {
	private tokenizer: any
	private initialized = false
	private initPromise: Promise<void> | null = null
	private modelPath: string

	constructor(options: TokenizerOptions = {}) {
		// Default to StarCoder2 tokenizer (only downloads tokenizer files, not model)
		this.modelPath = options.modelPath || 'bigcode/starcoder2-15b'
	}

	/**
	 * Initialize tokenizer (downloads ~4.7MB on first use)
	 */
	async initialize(): Promise<void> {
		if (this.initialized) {
			return
		}

		// Prevent multiple concurrent initializations
		if (this.initPromise) {
			return this.initPromise
		}

		this.initPromise = this.doInitialize()
		return this.initPromise
	}

	private async doInitialize(): Promise<void> {
		try {
			console.error('[INFO] Loading StarCoder2 tokenizer (4.7MB, one-time download)...')
			const startTime = Date.now()

			this.tokenizer = await AutoTokenizer.from_pretrained(this.modelPath)

			const loadTime = Date.now() - startTime
			console.error(`[SUCCESS] Tokenizer loaded in ${loadTime}ms`)

			this.initialized = true
		} catch (error) {
			this.initPromise = null
			throw new Error(`Failed to load tokenizer: ${error.message}`)
		}
	}

	/**
	 * Tokenize code into terms for TF-IDF indexing.
	 * Uses StarCoder2 when available; falls back to simple word-split when it returns no tokens
	 * (e.g. for Go, proto, YAML) so search still works.
	 */
	async tokenize(code: string): Promise<string[]> {
		if (!code || code.trim().length === 0) {
			return []
		}

		let tokens: string[] = []
		try {
			if (!this.initialized) {
				await this.initialize()
			}
			// Encode with StarCoder2
			const encoded = await this.tokenizer(code)
			const inputIds = encoded.input_ids.tolist()[0]
			for (const id of inputIds) {
				const token = await this.tokenizer.decode([id], {
					skip_special_tokens: true,
				})
				const cleaned = token.trim().toLowerCase()
				if (cleaned.length > 1) {
					tokens.push(cleaned)
				}
			}
		} catch (e) {
			// StarCoder2 failed (e.g. OOM, unsupported input)
			console.error('[tokenize] StarCoder2 failed, using fallback:', (e as Error).message)
		}
		// Fallback: simple word/identifier split when StarCoder2 returns no tokens (e.g. large chunk, env issue)
		if (tokens.length === 0) {
			tokens = simpleWordTokenize(code)
		}
		return tokens
	}

	/**
	 * Extract unique terms with frequency counts
	 */
	async extractTerms(code: string): Promise<Map<string, number>> {
		const tokens = await this.tokenize(code)
		const termFreq = new Map<string, number>()

		for (const token of tokens) {
			termFreq.set(token, (termFreq.get(token) || 0) + 1)
		}

		return termFreq
	}

	/**
	 * Check if tokenizer is ready
	 */
	isReady(): boolean {
		return this.initialized
	}
}

// Singleton instance for global use
let globalTokenizer: CodeTokenizer | null = null

/**
 * Get or create the global tokenizer instance
 */
export function getTokenizer(): CodeTokenizer {
	if (!globalTokenizer) {
		globalTokenizer = new CodeTokenizer()
	}
	return globalTokenizer
}

/**
 * Tokenize code using StarCoder2 (async)
 * This is the main entry point for tokenization
 */
export async function tokenize(code: string): Promise<string[]> {
	const tokenizer = getTokenizer()
	return tokenizer.tokenize(code)
}

/**
 * Extract terms with frequency counts using StarCoder2 (async)
 */
export async function extractTerms(code: string): Promise<Map<string, number>> {
	const tokenizer = getTokenizer()
	return tokenizer.extractTerms(code)
}

/**
 * Initialize the global tokenizer (call early to avoid delay on first tokenize)
 */
export async function initializeTokenizer(): Promise<void> {
	const tokenizer = getTokenizer()
	await tokenizer.initialize()
}
