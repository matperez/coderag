/**
 * Tests for utility functions
 */

import { describe, expect, it } from 'vitest'
import { detectLanguage, isTextFile, simpleHash } from './utils.js'

describe('utils', () => {
	describe('simpleHash', () => {
		it('should generate consistent hash for same input', () => {
			const content = 'test content'
			const hash1 = simpleHash(content)
			const hash2 = simpleHash(content)

			expect(hash1).toBe(hash2)
		})

		it('should generate different hashes for different inputs', () => {
			const hash1 = simpleHash('content1')
			const hash2 = simpleHash('content2')

			expect(hash1).not.toBe(hash2)
		})

		it('should handle empty string', () => {
			const hash = simpleHash('')
			expect(hash).toBeDefined()
			expect(typeof hash).toBe('string')
		})

		it('should handle unicode characters', () => {
			const hash1 = simpleHash('hello 世界')
			const hash2 = simpleHash('hello 世界')

			expect(hash1).toBe(hash2)
		})
	})

	describe('detectLanguage', () => {
		it('should detect TypeScript', () => {
			expect(detectLanguage('test.ts')).toBe('TypeScript')
			expect(detectLanguage('test.tsx')).toBe('TSX')
		})

		it('should detect JavaScript', () => {
			expect(detectLanguage('test.js')).toBe('JavaScript')
			expect(detectLanguage('test.jsx')).toBe('JSX')
		})

		it('should detect Python', () => {
			expect(detectLanguage('test.py')).toBe('Python')
		})

		it('should detect Go', () => {
			expect(detectLanguage('test.go')).toBe('Go')
		})

		it('should detect Rust', () => {
			expect(detectLanguage('test.rs')).toBe('Rust')
		})

		it('should detect JSON', () => {
			expect(detectLanguage('test.json')).toBe('JSON')
			expect(detectLanguage('package.json')).toBe('JSON')
		})

		it('should detect YAML', () => {
			expect(detectLanguage('test.yaml')).toBe('YAML')
			expect(detectLanguage('test.yml')).toBe('YAML')
		})

		it('should detect Markdown', () => {
			expect(detectLanguage('README.md')).toBe('Markdown')
		})

		it('should return undefined for unknown extensions', () => {
			expect(detectLanguage('test.xyz')).toBeUndefined()
			expect(detectLanguage('no-extension')).toBeUndefined()
		})

		it('should be case-insensitive', () => {
			expect(detectLanguage('TEST.TS')).toBe('TypeScript')
			expect(detectLanguage('Test.Js')).toBe('JavaScript')
		})
	})

	describe('isTextFile', () => {
		it('should return true for text files', () => {
			expect(isTextFile('test.ts')).toBe(true)
			expect(isTextFile('test.js')).toBe(true)
			expect(isTextFile('test.py')).toBe(true)
			expect(isTextFile('test.md')).toBe(true)
			expect(isTextFile('test.json')).toBe(true)
			expect(isTextFile('test.txt')).toBe(true)
		})

		it('should return false for binary files', () => {
			expect(isTextFile('image.png')).toBe(false)
			expect(isTextFile('image.jpg')).toBe(false)
			expect(isTextFile('image.gif')).toBe(false)
			expect(isTextFile('file.pdf')).toBe(false)
			expect(isTextFile('archive.zip')).toBe(false)
			expect(isTextFile('binary.exe')).toBe(false)
		})

		it('should return false for files without extension', () => {
			expect(isTextFile('no-extension')).toBe(false)
		})

		it('should be case-insensitive', () => {
			expect(isTextFile('TEST.TS')).toBe(true)
			expect(isTextFile('IMAGE.PNG')).toBe(false)
		})
	})
})
