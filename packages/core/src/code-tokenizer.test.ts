/**
 * Code Tokenizer Tests (StarCoder2)
 */

import { beforeAll, describe, expect, it } from 'vitest'
import { CodeTokenizer, extractTerms, initializeTokenizer, tokenize } from './code-tokenizer.js'

// Skip if running in CI without model cache
const shouldSkip = process.env.CI === 'true' && !process.env.HF_HOME

describe('StarCoder2 Tokenizer', () => {
	beforeAll(async () => {
		if (shouldSkip) return
		// Initialize tokenizer once for all tests
		await initializeTokenizer()
	}, 60000) // 60s timeout for download

	describe('tokenize function', () => {
		it.skipIf(shouldSkip)('should tokenize simple code', async () => {
			const tokens = await tokenize('getUserData(userId)')

			expect(tokens.length).toBeGreaterThan(0)
			// StarCoder2 should understand code structure
			expect(tokens.some((t) => t.includes('get') || t.includes('user'))).toBe(true)
		})

		it.skipIf(shouldSkip)('should tokenize complex code', async () => {
			const code = `
				async function authenticateUser(username: string, password: string) {
					const user = await findUserByUsername(username);
					if (!user) throw new Error('User not found');
					return await verifyPassword(user, password);
				}
			`

			const tokens = await tokenize(code)

			expect(tokens.length).toBeGreaterThan(10)
			// Should extract meaningful tokens
			expect(tokens.some((t) => t.includes('authenticate'))).toBe(true)
			expect(tokens.some((t) => t.includes('user'))).toBe(true)
			expect(tokens.some((t) => t.includes('password'))).toBe(true)
		})

		it.skipIf(shouldSkip)('should handle empty input', async () => {
			const tokens = await tokenize('')
			expect(tokens).toHaveLength(0)
		})

		it.skipIf(shouldSkip)('should handle whitespace', async () => {
			const tokens = await tokenize('   \n\t  ')
			expect(tokens).toHaveLength(0)
		})

		it.skipIf(shouldSkip)('should handle camelCase', async () => {
			const tokens = await tokenize('getUserData')

			expect(tokens.length).toBeGreaterThan(0)
		})

		it.skipIf(shouldSkip)('should handle snake_case', async () => {
			const tokens = await tokenize('is_authenticated')

			expect(tokens.length).toBeGreaterThan(0)
		})
	})

	describe('extractTerms function', () => {
		it.skipIf(shouldSkip)('should extract terms with frequencies', async () => {
			const code = 'user user authenticate user'
			const terms = await extractTerms(code)

			expect(terms.size).toBeGreaterThan(0)
			// Should count frequencies
			const userFreq = terms.get('user')
			expect(userFreq).toBeGreaterThanOrEqual(1)
		})

		it.skipIf(shouldSkip)('should handle code with duplicates', async () => {
			const code = `
				function getUserData(userId) {
					const user = findUser(userId);
					return user;
				}
			`

			const terms = await extractTerms(code)

			expect(terms.size).toBeGreaterThan(0)
		})
	})

	describe('CodeTokenizer class', () => {
		let tokenizer: CodeTokenizer

		beforeAll(async () => {
			if (shouldSkip) return
			tokenizer = new CodeTokenizer()
			await tokenizer.initialize()
		}, 30000)

		it.skipIf(shouldSkip)('should initialize successfully', () => {
			expect(tokenizer.isReady()).toBe(true)
		})

		it.skipIf(shouldSkip)('should tokenize code', async () => {
			const tokens = await tokenizer.tokenize('function test() {}')

			expect(tokens.length).toBeGreaterThan(0)
			expect(tokens.some((t) => t.includes('function') || t.includes('test'))).toBe(true)
		})

		it.skipIf(shouldSkip)('should extract terms', async () => {
			const terms = await tokenizer.extractTerms('const x = 1; const y = 2;')

			expect(terms.size).toBeGreaterThan(0)
		})
	})
})
