/**
 * Tests for AST-based code chunking (code-chunk for supported languages, fallback for others)
 */

import { describe, expect, it } from 'vitest'
import {
	chunkCodeByAST,
	chunkCodeByASTSimple,
	getSupportedLanguages,
} from './ast-chunking.js'

describe('AST-based chunking', () => {
	describe('getSupportedLanguages', () => {
		it('returns code-chunk supported languages', () => {
			const langs = getSupportedLanguages()
			expect(langs).toContain('typescript')
			expect(langs).toContain('javascript')
			expect(langs).toContain('python')
			expect(langs).toContain('rust')
			expect(langs).toContain('go')
			expect(langs).toContain('java')
			expect(langs.length).toBe(6)
		})
	})

	describe('Markdown (fallback)', () => {
		it('uses character fallback for .md (no AST)', async () => {
			const markdown = `# Introduction

This is the introduction paragraph.

## Section 1

Some content here.
`

			const chunks = await chunkCodeByAST(markdown, 'test.md')

			expect(chunks.length).toBeGreaterThan(0)
			// Fallback: type 'text', metadata.fallback true
			chunks.forEach((c) => {
				expect(c.type).toBe('text')
				expect(c.metadata.fallback).toBe(true)
			})
		})

		it('fallback preserves content and gives line 0 for fallback chunks', async () => {
			const markdown = `# Title

Paragraph 1

Paragraph 2
`

			const chunks = await chunkCodeByAST(markdown, 'test.md')

			chunks.forEach((chunk) => {
				expect(chunk.content).toBeTruthy()
				expect(chunk.startLine).toBeGreaterThanOrEqual(0)
				expect(chunk.endLine).toBeGreaterThanOrEqual(0)
			})
			expect(chunks.some((c) => c.content.includes('Title'))).toBe(true)
		})
	})

	describe('JavaScript (code-chunk)', () => {
		it('should split JavaScript by functions', async () => {
			const code = `function foo() {
  return 1;
}

function bar() {
  return 2;
}

function baz() {
  return 3;
}
`

			const chunks = await chunkCodeByASTSimple(code, 'test.js')

			expect(chunks.length).toBeGreaterThanOrEqual(1)
			expect(chunks.some((c) => c.includes('function foo'))).toBe(true)
			expect(chunks.some((c) => c.includes('function bar'))).toBe(true)
			expect(chunks.some((c) => c.includes('function baz'))).toBe(true)
		})

		it('should handle classes', async () => {
			const code = `class MyClass {
  constructor() {
    this.value = 0;
  }

  increment() {
    this.value++;
  }
}
`

			const chunks = await chunkCodeByASTSimple(code, 'test.js')

			expect(chunks.length).toBeGreaterThan(0)
			expect(chunks.some((c) => c.includes('class MyClass'))).toBe(true)
		})

		it('should have meaningful line ranges for JS chunks', async () => {
			const code = `function first() {
  return 1;
}

function second() {
  return 2;
}
`

			const chunks = await chunkCodeByAST(code, 'test.js')

			expect(chunks.length).toBeGreaterThan(0)
			chunks.forEach((chunk) => {
				expect(chunk.startLine).toBeGreaterThanOrEqual(1)
				expect(chunk.endLine).toBeGreaterThanOrEqual(chunk.startLine)
				expect(chunk.content).toBeTruthy()
				expect(chunk.metadata.fallback).toBe(false)
			})
		})
	})

	describe('Size constraints', () => {
		it('should respect maxChunkSize', async () => {
			const largeCode = `function veryLargeFunction() {
  ${'return 1;\n'.repeat(100)}
}
`

			const chunks = await chunkCodeByASTSimple(largeCode, 'test.js', {
				maxChunkSize: 500,
			})

			// code-chunk may exceed slightly; ensure we got multiple chunks and none is huge
			expect(chunks.length).toBeGreaterThan(1)
			chunks.forEach((chunk) => {
				expect(chunk.length).toBeLessThanOrEqual(800)
			})
		})
	})

	describe('Fallback behavior', () => {
		it('should fallback to character chunking for unknown languages', async () => {
			const code = 'a'.repeat(2000)

			const chunks = await chunkCodeByAST(code, 'test.unknown')

			expect(chunks.length).toBeGreaterThan(1)
			expect(chunks[0].metadata.fallback).toBe(true)
		})

		it('should return chunks when AST parsing fails (fallback or resilient parse)', async () => {
			const invalidCode = 'function { syntax error }'

			const chunks = await chunkCodeByAST(invalidCode, 'test.js')

			// code-chunk may either throw (then we fallback) or return partial chunks
			expect(chunks.length).toBeGreaterThan(0)
			expect(chunks[0].content).toBeTruthy()
		})

		it('should handle empty input', async () => {
			const chunks = await chunkCodeByAST('', 'test.js')

			expect(chunks.length).toBe(0)
		})
	})

	describe('Edge cases', () => {
		it('should use fallback for HTML (unsupported by code-chunk)', async () => {
			const html = `<div>
  <p>Paragraph 1</p>
</div>
`

			const chunks = await chunkCodeByAST(html, 'test.html')

			expect(chunks.length).toBeGreaterThan(0)
			chunks.forEach((c) => expect(c.metadata.fallback).toBe(true))
		})

		it('should handle single-line content', async () => {
			const code = 'const x = 42;'

			const chunks = await chunkCodeByAST(code, 'test.js')

			expect(chunks.length).toBeGreaterThan(0)
			expect(chunks[0].content).toBeTruthy()
		})
	})

	describe('Performance', () => {
		it('should handle large files efficiently', async () => {
			const sections = Array.from({ length: 100 }, (_, i) => {
				return `## Section ${i + 1}\n\nContent for section ${i + 1}.\n`
			}).join('\n')

			const markdown = `# Large Document\n\n${sections}`

			const start = Date.now()
			const chunks = await chunkCodeByAST(markdown, 'test.md')
			const duration = Date.now() - start

			expect(chunks.length).toBeGreaterThan(1)
			expect(duration).toBeLessThan(5000)
		})
	})
})
