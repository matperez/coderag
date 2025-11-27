/**
 * Tests for in-memory storage
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { type CodebaseFile, MemoryStorage } from './storage.js'

describe('MemoryStorage', () => {
	let storage: MemoryStorage

	beforeEach(() => {
		storage = new MemoryStorage()
	})

	describe('storeFile', () => {
		it('should store a file', async () => {
			const file: CodebaseFile = {
				path: 'test.ts',
				content: 'console.log("test");',
				size: 100,
				mtime: Date.now(),
				language: 'TypeScript',
				hash: 'abc123',
			}

			await storage.storeFile(file)
			const retrieved = await storage.getFile('test.ts')

			expect(retrieved).toEqual(file)
		})

		it('should overwrite existing file', async () => {
			const file1: CodebaseFile = {
				path: 'test.ts',
				content: 'old content',
				size: 100,
				mtime: Date.now(),
				hash: 'hash1',
			}

			const file2: CodebaseFile = {
				path: 'test.ts',
				content: 'new content',
				size: 150,
				mtime: Date.now(),
				hash: 'hash2',
			}

			await storage.storeFile(file1)
			await storage.storeFile(file2)

			const retrieved = await storage.getFile('test.ts')
			expect(retrieved?.content).toBe('new content')
			expect(retrieved?.hash).toBe('hash2')
		})
	})

	describe('getFile', () => {
		it('should retrieve stored file', async () => {
			const file: CodebaseFile = {
				path: 'test.ts',
				content: 'test',
				size: 100,
				mtime: Date.now(),
				hash: 'abc',
			}

			await storage.storeFile(file)
			const retrieved = await storage.getFile('test.ts')

			expect(retrieved).toEqual(file)
		})

		it('should return null for non-existent file', async () => {
			const retrieved = await storage.getFile('nonexistent.ts')
			expect(retrieved).toBeNull()
		})
	})

	describe('getAllFiles', () => {
		it('should return all stored files', async () => {
			const files: CodebaseFile[] = [
				{ path: 'file1.ts', content: 'a', size: 1, mtime: Date.now(), hash: 'h1' },
				{ path: 'file2.ts', content: 'b', size: 2, mtime: Date.now(), hash: 'h2' },
				{ path: 'file3.ts', content: 'c', size: 3, mtime: Date.now(), hash: 'h3' },
			]

			for (const file of files) {
				await storage.storeFile(file)
			}

			const allFiles = await storage.getAllFiles()
			expect(allFiles).toHaveLength(3)
			expect(allFiles).toEqual(expect.arrayContaining(files))
		})

		it('should return empty array when no files stored', async () => {
			const allFiles = await storage.getAllFiles()
			expect(allFiles).toEqual([])
		})
	})

	describe('deleteFile', () => {
		it('should delete existing file', async () => {
			const file: CodebaseFile = {
				path: 'test.ts',
				content: 'test',
				size: 100,
				mtime: Date.now(),
				hash: 'abc',
			}

			await storage.storeFile(file)
			await storage.deleteFile('test.ts')

			const retrieved = await storage.getFile('test.ts')
			expect(retrieved).toBeNull()
		})

		it('should not throw when deleting non-existent file', async () => {
			await expect(async () => {
				await storage.deleteFile('nonexistent.ts')
			}).not.toThrow()
		})
	})

	describe('clear', () => {
		it('should remove all files', async () => {
			const files: CodebaseFile[] = [
				{ path: 'file1.ts', content: 'a', size: 1, mtime: Date.now(), hash: 'h1' },
				{ path: 'file2.ts', content: 'b', size: 2, mtime: Date.now(), hash: 'h2' },
			]

			for (const file of files) {
				await storage.storeFile(file)
			}

			await storage.clear()

			const allFiles = await storage.getAllFiles()
			expect(allFiles).toHaveLength(0)
		})
	})

	describe('count', () => {
		it('should return correct file count', async () => {
			expect(await storage.count()).toBe(0)

			await storage.storeFile({
				path: 'file1.ts',
				content: 'a',
				size: 1,
				mtime: Date.now(),
				hash: 'h1',
			})
			expect(await storage.count()).toBe(1)

			await storage.storeFile({
				path: 'file2.ts',
				content: 'b',
				size: 2,
				mtime: Date.now(),
				hash: 'h2',
			})
			expect(await storage.count()).toBe(2)

			await storage.deleteFile('file1.ts')
			expect(await storage.count()).toBe(1)
		})
	})

	describe('exists', () => {
		it('should return true for existing file', async () => {
			await storage.storeFile({
				path: 'test.ts',
				content: 'test',
				size: 100,
				mtime: Date.now(),
				hash: 'abc',
			})

			expect(await storage.exists('test.ts')).toBe(true)
		})

		it('should return false for non-existent file', async () => {
			expect(await storage.exists('nonexistent.ts')).toBe(false)
		})
	})
})
