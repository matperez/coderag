/**
 * Persistent storage implementation using SQLite + Drizzle ORM
 */

import { eq, sql } from 'drizzle-orm';
import { createDb, type DbConfig, type DbInstance } from './db/client.js';
import { runMigrations } from './db/migrations.js';
import * as schema from './db/schema.js';
import type { CodebaseFile, Storage } from './storage.js';

export class PersistentStorage implements Storage {
  private dbInstance: DbInstance;

  constructor(config: DbConfig = {}) {
    this.dbInstance = createDb(config);
    runMigrations(this.dbInstance.sqlite);
  }

  /**
   * Store a file
   */
  async storeFile(file: CodebaseFile): Promise<void> {
    const { db } = this.dbInstance;
    const mtime = typeof file.mtime === 'number' ? file.mtime : file.mtime.getTime();

    const values = {
      path: file.path,
      content: file.content,
      hash: file.hash,
      size: file.size,
      mtime,
      ...(file.language ? { language: file.language } : {}),
      indexedAt: Date.now(),
    };

    await db
      .insert(schema.files)
      .values(values)
      .onConflictDoUpdate({
        target: schema.files.path,
        set: {
          content: values.content,
          hash: values.hash,
          size: values.size,
          mtime: values.mtime,
          ...(values.language ? { language: values.language } : {}),
          indexedAt: values.indexedAt,
        },
      });
  }

  /**
   * Get a file by path
   */
  async getFile(path: string): Promise<CodebaseFile | null> {
    const { db } = this.dbInstance;

    const result = await db.select().from(schema.files).where(eq(schema.files.path, path)).get();

    if (!result) {
      return null;
    }

    return {
      path: result.path,
      content: result.content,
      hash: result.hash,
      size: result.size,
      mtime: result.mtime,
      language: result.language || undefined,
    };
  }

  /**
   * Get all files
   */
  async getAllFiles(): Promise<CodebaseFile[]> {
    const { db } = this.dbInstance;

    const results = await db.select().from(schema.files).all();

    return results.map((file) => ({
      path: file.path,
      content: file.content,
      hash: file.hash,
      size: file.size,
      mtime: file.mtime,
      language: file.language || undefined,
    }));
  }

  /**
   * Delete a file
   */
  async deleteFile(path: string): Promise<void> {
    const { db } = this.dbInstance;

    await db.delete(schema.files).where(eq(schema.files.path, path));
  }

  /**
   * Clear all files
   */
  async clear(): Promise<void> {
    const { db } = this.dbInstance;

    await db.delete(schema.files);
    await db.delete(schema.documentVectors);
    await db.delete(schema.idfScores);
    await db.delete(schema.indexMetadata);
  }

  /**
   * Get file count
   */
  async count(): Promise<number> {
    const { db } = this.dbInstance;

    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(schema.files)
      .get();

    return result?.count || 0;
  }

  /**
   * Check if file exists
   */
  async exists(path: string): Promise<boolean> {
    const { db } = this.dbInstance;

    const result = await db.select().from(schema.files).where(eq(schema.files.path, path)).get();

    return result !== undefined;
  }

  /**
   * Store document vectors (TF-IDF)
   */
  async storeDocumentVectors(
    filePath: string,
    terms: Map<string, { tf: number; tfidf: number; rawFreq: number }>
  ): Promise<void> {
    const { db } = this.dbInstance;

    // Get file ID
    const file = await db.select().from(schema.files).where(eq(schema.files.path, filePath)).get();

    if (!file) {
      throw new Error(`File not found: ${filePath}`);
    }

    // Delete existing vectors for this file
    await db.delete(schema.documentVectors).where(eq(schema.documentVectors.fileId, file.id));

    // Insert new vectors
    const vectors = Array.from(terms.entries()).map(([term, scores]) => ({
      fileId: file.id,
      term,
      tf: scores.tf,
      tfidf: scores.tfidf,
      rawFreq: scores.rawFreq,
    }));

    if (vectors.length > 0) {
      await db.insert(schema.documentVectors).values(vectors);
    }
  }

  /**
   * Store IDF scores
   */
  async storeIdfScores(idf: Map<string, number>, docFreq: Map<string, number>): Promise<void> {
    const { db } = this.dbInstance;

    // Clear existing IDF scores
    await db.delete(schema.idfScores);

    // Insert new scores
    const scores = Array.from(idf.entries()).map(([term, idfScore]) => ({
      term,
      idf: idfScore,
      documentFrequency: docFreq.get(term) || 0,
    }));

    if (scores.length > 0) {
      await db.insert(schema.idfScores).values(scores);
    }
  }

  /**
   * Get IDF scores
   */
  async getIdfScores(): Promise<Map<string, number>> {
    const { db } = this.dbInstance;

    const scores = await db.select().from(schema.idfScores).all();

    const idf = new Map<string, number>();
    for (const score of scores) {
      idf.set(score.term, score.idf);
    }

    return idf;
  }

  /**
   * Get document vectors for a file
   */
  async getDocumentVectors(
    filePath: string
  ): Promise<Map<string, { tf: number; tfidf: number; rawFreq: number }> | null> {
    const { db } = this.dbInstance;

    // Get file ID
    const file = await db.select().from(schema.files).where(eq(schema.files.path, filePath)).get();

    if (!file) {
      return null;
    }

    const vectors = await db
      .select()
      .from(schema.documentVectors)
      .where(eq(schema.documentVectors.fileId, file.id))
      .all();

    const terms = new Map<string, { tf: number; tfidf: number; rawFreq: number }>();
    for (const vector of vectors) {
      terms.set(vector.term, {
        tf: vector.tf,
        tfidf: vector.tfidf,
        rawFreq: vector.rawFreq,
      });
    }

    return terms;
  }

  /**
   * Store metadata
   */
  async setMetadata(key: string, value: string): Promise<void> {
    const { db } = this.dbInstance;

    await db
      .insert(schema.indexMetadata)
      .values({
        key,
        value,
        updatedAt: Date.now(),
      })
      .onConflictDoUpdate({
        target: schema.indexMetadata.key,
        set: {
          value,
          updatedAt: Date.now(),
        },
      });
  }

  /**
   * Get metadata
   */
  async getMetadata(key: string): Promise<string | null> {
    const { db } = this.dbInstance;

    const result = await db
      .select()
      .from(schema.indexMetadata)
      .where(eq(schema.indexMetadata.key, key))
      .get();

    return result?.value || null;
  }

  /**
   * Close database connection
   */
  close(): void {
    this.dbInstance.sqlite.close();
  }
}
