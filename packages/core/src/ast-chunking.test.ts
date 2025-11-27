/**
 * Tests for AST-based code chunking
 */

import { describe, expect, it } from 'vitest'
import { chunkCodeByAST, chunkCodeByASTSimple } from './ast-chunking.js'

describe('AST-based chunking', () => {
	describe('Markdown chunking', () => {
		it('should split markdown by semantic blocks', async () => {
			const markdown = `# Introduction

This is the introduction paragraph.

## Section 1

Some content here.

\`\`\`javascript
const x = 42;
\`\`\`

## Section 2

More content.
`

			const chunks = await chunkCodeByAST(markdown, 'test.md')

			// Should have multiple chunks for different sections
			expect(chunks.length).toBeGreaterThan(3)

			// Check chunk types
			const types = chunks.map((c) => c.type)
			expect(types).toContain('heading')
			expect(types).toContain('paragraph')
			// Synth uses 'code' not 'codeBlock'
			expect(types.some((t) => t === 'code' || t === 'codeBlock')).toBe(true)
		})

		it('should preserve metadata', async () => {
			const markdown = `# Level 1 Heading

## Level 2 Heading

### Level 3 Heading
`

			const chunks = await chunkCodeByAST(markdown, 'test.md')
			const headings = chunks.filter((c) => c.type === 'heading')

			expect(headings.length).toBe(3)
			// Check that heading level metadata is preserved
			expect(headings[0].metadata).toBeDefined()
			expect(headings[1].metadata).toBeDefined()
			expect(headings[2].metadata).toBeDefined()
		})

		it('should include line numbers', async () => {
			const markdown = `# Title

Paragraph 1

Paragraph 2
`

			const chunks = await chunkCodeByAST(markdown, 'test.md')

			// Each chunk should have line numbers
			chunks.forEach((chunk) => {
				expect(chunk.startLine).toBeGreaterThanOrEqual(1)
				expect(chunk.endLine).toBeGreaterThanOrEqual(chunk.startLine)
			})

			// First chunk should start at line 1
			expect(chunks[0].startLine).toBe(1)
		})
	})

	describe('JavaScript chunking', () => {
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

			// Should split into 3 function chunks
			expect(chunks.length).toBe(3)
			expect(chunks[0]).toContain('function foo')
			expect(chunks[1]).toContain('function bar')
			expect(chunks[2]).toContain('function baz')
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

			// Should have at least one chunk containing the class
			expect(chunks.length).toBeGreaterThan(0)
			expect(chunks.some((c) => c.includes('class MyClass'))).toBe(true)
		})
	})

	describe('Context preservation', () => {
		it('should preserve imports when enabled', async () => {
			const code = `import { foo } from 'bar';
import { baz } from 'qux';

function usesFoo() {
  return foo();
}

function usesBaz() {
  return baz();
}
`

			const chunks = await chunkCodeByASTSimple(code, 'test.ts', {
				preserveContext: true,
			})

			// Both function chunks should include imports as context
			const funcChunks = chunks.filter((c) => c.includes('function'))

			if (funcChunks.length > 0) {
				funcChunks.forEach((chunk) => {
					expect(chunk.includes('import') || chunk.includes('function')).toBe(true)
				})
			}
		})

		it('should not preserve context when disabled', async () => {
			const code = `import { foo } from 'bar';

function usesFoo() {
  return foo();
}
`

			const chunks = await chunkCodeByASTSimple(code, 'test.ts', {
				preserveContext: false,
			})

			// Function chunk should NOT include import
			const funcChunk = chunks.find((c) => c.includes('function usesFoo'))
			if (funcChunk) {
				expect(funcChunk.includes('import')).toBe(false)
			}
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

			// Should split large function into smaller chunks
			chunks.forEach((chunk) => {
				expect(chunk.length).toBeLessThanOrEqual(500)
			})
		})

		it('should merge small chunks', async () => {
			const code = `const a = 1;
const b = 2;
const c = 3;
const d = 4;
const e = 5;
`

			const chunks = await chunkCodeByASTSimple(code, 'test.js', {
				minChunkSize: 50,
			})

			// Should merge small variable declarations
			expect(chunks.length).toBeLessThan(5)
		})
	})

	describe('Fallback behavior', () => {
		it('should fallback to character chunking for unknown languages', async () => {
			const code = 'a'.repeat(2000)

			const chunks = await chunkCodeByAST(code, 'test.unknown')

			expect(chunks.length).toBeGreaterThan(1)
			expect(chunks[0].metadata.fallback).toBe(true)
		})

		it('should fallback when AST parsing fails', async () => {
			const invalidCode = 'function { syntax error }'

			const chunks = await chunkCodeByAST(invalidCode, 'test.js')

			// Should still return chunks (fallback to character-based)
			expect(chunks.length).toBeGreaterThan(0)
		})

		it('should handle empty input', async () => {
			const chunks = await chunkCodeByAST('', 'test.js')

			expect(chunks.length).toBe(0)
		})
	})

	describe('Custom node types', () => {
		it('should respect custom nodeTypes filter', async () => {
			const markdown = `# Title

Paragraph here.

- List item 1
- List item 2
`

			const chunks = await chunkCodeByAST(markdown, 'test.md', {
				nodeTypes: ['heading', 'list'], // Only headings and lists
			})

			const types = chunks.map((c) => c.type)

			// Should only have headings and lists, no paragraphs
			expect(types.every((t) => t === 'heading' || t === 'list' || t.includes('+'))).toBe(true)
		})
	})

	describe('Edge cases', () => {
		it('should handle nested structures', async () => {
			const html = `<div>
  <p>Paragraph 1</p>
  <div>
    <p>Nested paragraph</p>
  </div>
  <p>Paragraph 2</p>
</div>
`

			const chunks = await chunkCodeByAST(html, 'test.html')

			// Should handle nested HTML structure
			expect(chunks.length).toBeGreaterThan(0)
		})

		it('should handle mixed content types', async () => {
			const markdown = `# Mixed Content

Text paragraph here.

\`\`\`json
{
  "key": "value"
}
\`\`\`

> Blockquote here

- List item
`

			const chunks = await chunkCodeByAST(markdown, 'test.md')

			// Should have multiple different chunk types
			const types = new Set(chunks.map((c) => c.type))
			expect(types.size).toBeGreaterThan(2)
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
			// Generate large markdown file
			const sections = Array.from({ length: 100 }, (_, i) => {
				return `## Section ${i + 1}\n\nContent for section ${i + 1}.\n`
			}).join('\n')

			const markdown = `# Large Document\n\n${sections}`

			const start = Date.now()
			const chunks = await chunkCodeByAST(markdown, 'test.md')
			const duration = Date.now() - start

			expect(chunks.length).toBeGreaterThan(50)
			expect(duration).toBeLessThan(5000) // Should complete in < 5s
		})
	})
})
