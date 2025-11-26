/**
 * AST-Based Code Chunking using Synth
 * Splits code at semantic boundaries (functions, classes, etc.)
 */

import { detectLanguage } from './utils.js';
import { chunkText } from './embeddings.js';

// Synth types (will be imported from @sylphx/synth packages)
interface Position {
  line: number;
  column: number;
  offset: number;
}

interface Span {
  start: Position;
  end: Position;
}

type NodeId = number;

interface BaseNode {
  id: NodeId;
  type: string;
  span?: Span;
  parent: NodeId | null;
  children: NodeId[];
  data?: Record<string, unknown>;
}

interface Tree {
  meta: {
    language: string;
    source: string;
    created: number;
    modified: number;
    data?: Record<string, unknown>;
  };
  root: NodeId;
  nodes: BaseNode[];
}

interface VisitorContext {
  tree: Tree;
  nodeId: NodeId;
  node: BaseNode;
  parentId: NodeId | null;
  depth: number;
  index: number;
  ancestors: NodeId[];
}

// Placeholder for Synth imports (will be dynamic)
type SynthParser = {
  parse: (source: string, options?: any) => Tree;
  traverse?: (
    tree: Tree,
    visitors: Record<string, (ctx: VisitorContext) => void | false>,
    options?: any
  ) => void;
  getNode?: (tree: Tree, nodeId: NodeId) => BaseNode | undefined;
};

/**
 * AST-based chunking options
 */
export interface ASTChunkOptions {
  readonly maxChunkSize?: number; // Max size per chunk (chars)
  readonly minChunkSize?: number; // Min size to avoid tiny chunks
  readonly chunkByNodeType?: boolean; // Split by semantic units
  readonly preserveContext?: boolean; // Include context (imports, types)
  readonly nodeTypes?: string[]; // Which node types to split on
}

/**
 * Chunk result with metadata
 */
export interface ChunkResult {
  readonly content: string;
  readonly type: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly metadata: Record<string, unknown>;
}

/**
 * Get source text from AST node
 */
function getSourceText(tree: Tree, node: BaseNode): string {
  if (!node.span) return '';
  return tree.meta.source.slice(node.span.start.offset, node.span.end.offset);
}

/**
 * Get node by ID
 */
function getNode(tree: Tree, nodeId: NodeId): BaseNode | undefined {
  return tree.nodes[nodeId];
}

/**
 * Check if node is a semantic boundary (function, class, etc.)
 */
function isSemanticBoundary(node: BaseNode, language: string): boolean {
  const boundaryTypes = new Map<string, Set<string>>([
    // JavaScript/TypeScript
    [
      'javascript',
      new Set([
        'FunctionDeclaration',
        'FunctionExpression',
        'ArrowFunctionExpression',
        'ClassDeclaration',
        'ClassExpression',
        'MethodDefinition',
        'ExportNamedDeclaration',
        'ExportDefaultDeclaration',
      ]),
    ],
    [
      'typescript',
      new Set([
        'FunctionDeclaration',
        'ClassDeclaration',
        'InterfaceDeclaration',
        'TypeAliasDeclaration',
        'EnumDeclaration',
        'MethodDefinition',
      ]),
    ],
    // Markdown
    [
      'markdown',
      new Set([
        'heading',
        'paragraph',
        'code', // Synth uses 'code' not 'codeBlock'
        'codeBlock', // Keep for compatibility
        'blockquote',
        'list',
        'listItem',
        'table',
        'thematicBreak',
      ]),
    ],
    // HTML/JSX
    [
      'html',
      new Set(['element', 'comment', 'doctype']),
    ],
    // JSON/YAML
    [
      'json',
      new Set(['Object', 'Array']),
    ],
    [
      'yaml',
      new Set(['Document', 'Mapping', 'Sequence']),
    ],
  ]);

  const lang = language.toLowerCase();
  const types = boundaryTypes.get(lang);
  return types ? types.has(node.type) : false;
}

/**
 * Extract context nodes (imports, type definitions, etc.)
 */
function extractContextNodes(tree: Tree, language: string): BaseNode[] {
  const contextTypes = new Map<string, Set<string>>([
    [
      'javascript',
      new Set([
        'ImportDeclaration',
        'ImportSpecifier',
        'RequireStatement',
        'TypeAlias',
        'InterfaceDeclaration',
      ]),
    ],
    [
      'typescript',
      new Set(['ImportDeclaration', 'TypeAliasDeclaration', 'InterfaceDeclaration']),
    ],
  ]);

  const lang = language.toLowerCase();
  const types = contextTypes.get(lang);
  if (!types) return [];

  return tree.nodes.filter((node) => types.has(node.type));
}

/**
 * Merge small chunks to avoid fragmentation
 * Only merges non-semantic chunks (split chunks, not original AST nodes)
 */
function mergeSmallChunks(chunks: ChunkResult[], minChunkSize: number): ChunkResult[] {
  if (chunks.length === 0) return [];

  // Semantic boundaries should NOT be merged (headings, functions, classes, etc.)
  const semanticTypes = new Set([
    'heading',
    'paragraph',
    'code', // Synth uses 'code' for code blocks
    'codeBlock', // Keep for compatibility
    'list',
    'listItem',
    'FunctionDeclaration',
    'ClassDeclaration',
    'MethodDefinition',
  ]);

  const merged: ChunkResult[] = [];
  let buffer: ChunkResult | null = null;

  for (const chunk of chunks) {
    // Don't merge semantic boundaries
    const isSemanticChunk = semanticTypes.has(chunk.type) || !chunk.metadata.split;

    if (!buffer) {
      if (isSemanticChunk || chunk.content.length >= minChunkSize) {
        // Semantic or large enough - don't buffer
        merged.push(chunk);
      } else {
        // Small non-semantic - buffer for potential merge
        buffer = chunk;
      }
      continue;
    }

    // If both are small non-semantic chunks, merge them
    const isBufferSemantic = semanticTypes.has(buffer.type) || !buffer.metadata.split;
    if (
      !isSemanticChunk &&
      !isBufferSemantic &&
      buffer.content.length < minChunkSize &&
      chunk.content.length < minChunkSize
    ) {
      buffer = {
        content: buffer.content + '\n\n' + chunk.content,
        type: `${buffer.type}+${chunk.type}`,
        startLine: buffer.startLine,
        endLine: chunk.endLine,
        metadata: {
          ...buffer.metadata,
          merged: true,
        },
      };
    } else {
      // Flush buffer and handle current chunk
      merged.push(buffer);
      if (isSemanticChunk || chunk.content.length >= minChunkSize) {
        merged.push(chunk);
        buffer = null;
      } else {
        buffer = chunk;
      }
    }
  }

  // Flush remaining buffer
  if (buffer) {
    merged.push(buffer);
  }

  return merged;
}

/**
 * Extract semantic chunks from AST
 */
function extractSemanticChunks(
  tree: Tree,
  options: {
    maxChunkSize: number;
    minChunkSize: number;
    preserveContext: boolean;
    nodeTypes?: string[];
  }
): ChunkResult[] {
  const chunks: ChunkResult[] = [];
  const language = tree.meta.language;

  // Extract context (imports, types) if needed
  let contextPrefix = '';
  if (options.preserveContext) {
    const contextNodes = extractContextNodes(tree, language);
    contextPrefix = contextNodes.map((node) => getSourceText(tree, node)).join('\n');
    if (contextPrefix) contextPrefix += '\n\n';
  }

  // Get root node (always at index 0)
  const root = tree.nodes[0];
  if (!root) return [];

  // For JS/TS, Program node is between root and actual code
  // root → Program → FunctionDeclaration/ClassDeclaration/etc.
  let topLevelNodes = root.children;
  const lang = language.toLowerCase();
  if (
    topLevelNodes.length === 1 &&
    (lang === 'javascript' || lang === 'typescript')
  ) {
    const firstChild = tree.nodes[topLevelNodes[0]];
    if (firstChild?.type === 'Program' && firstChild.children.length > 0) {
      // Use Program's children instead of root's children
      topLevelNodes = firstChild.children;
    }
  }

  // Process top-level children (filter by semantic boundaries)
  for (const childId of topLevelNodes) {
    const node = tree.nodes[childId]; // Direct array access since IDs seem to be indices
    if (!node || !node.span) continue;

    // Check if this is a semantic boundary
    const isBoundary = options.nodeTypes
      ? options.nodeTypes.includes(node.type)
      : isSemanticBoundary(node, language);

    if (isBoundary) {
      const content = getSourceText(tree, node);
      const finalContent = options.preserveContext ? contextPrefix + content : content;

      // Split large chunks
      if (finalContent.length > options.maxChunkSize) {
        // Recursively process children
        const subChunks = extractSubChunks(tree, node, options);
        chunks.push(...subChunks);
      } else {
        chunks.push({
          content: finalContent,
          type: node.type,
          startLine: node.span.start.line + 1, // Convert 0-based to 1-based
          endLine: node.span.end.line + 1,
          metadata: { ...node.data },
        });
      }
    }
  }

  return chunks;
}

/**
 * Extract sub-chunks from large nodes
 */
function extractSubChunks(
  tree: Tree,
  node: BaseNode,
  options: { maxChunkSize: number }
): ChunkResult[] {
  const chunks: ChunkResult[] = [];

  // If node has children, split by children
  if (node.children.length > 0) {
    for (const childId of node.children) {
      const child = getNode(tree, childId);
      if (!child || !child.span) continue;

      const content = getSourceText(tree, child);
      if (content.length > options.maxChunkSize) {
        // Recursively split
        chunks.push(...extractSubChunks(tree, child, options));
      } else {
        chunks.push({
          content,
          type: child.type,
          startLine: child.span.start.line + 1, // Convert 0-based to 1-based
          endLine: child.span.end.line + 1,
          metadata: { ...child.data },
        });
      }
    }
  } else {
    // No children, split by characters as fallback
    const content = getSourceText(tree, node);
    const charChunks = chunkText(content, { maxChunkSize: options.maxChunkSize });
    charChunks.forEach((chunk, i) => {
      chunks.push({
        content: chunk,
        type: `${node.type}[${i}]`,
        startLine: node.span!.start.line + 1, // Convert 0-based to 1-based
        endLine: node.span!.end.line + 1,
        metadata: { split: true, index: i },
      });
    });
  }

  return chunks;
}

/**
 * Dynamic import Synth parser based on language
 */
async function loadSynthParser(language: string): Promise<SynthParser | null> {
  try {
    let parserModule;
    switch (language.toLowerCase()) {
      case 'javascript':
      case 'typescript':
      case 'jsx':
      case 'tsx':
        parserModule = await import('@sylphx/synth-js');
        break;
      case 'markdown':
        parserModule = await import('@sylphx/synth-md');
        break;
      case 'html':
        parserModule = await import('@sylphx/synth-html');
        break;
      case 'json':
        parserModule = await import('@sylphx/synth-json');
        break;
      case 'yaml':
      case 'yml':
        parserModule = await import('@sylphx/synth-yaml');
        break;
      // TODO: Add more languages as Synth supports them
      default:
        return null;
    }

    // Return a wrapper with the parse function
    return {
      parse: parserModule.parse,
    };
  } catch (error) {
    console.error(`[WARN] Failed to load Synth parser for ${language}:`, error);
    return null;
  }
}

/**
 * Parse code with Synth
 */
async function parseWithSynth(
  code: string,
  language: string
): Promise<Tree | null> {
  const parser = await loadSynthParser(language);
  if (!parser) return null;

  try {
    // JS/TS requires sourceType option
    const lang = language.toLowerCase();
    const options =
      lang === 'javascript' || lang === 'typescript' || lang === 'jsx' || lang === 'tsx'
        ? { sourceType: 'module' as const }
        : undefined;

    const tree = parser.parse(code, options);
    return tree;
  } catch (error) {
    console.error(`[WARN] Synth parsing failed for ${language}:`, error);
    return null;
  }
}

/**
 * Chunk code using AST analysis (Synth-powered)
 *
 * @example
 * ```typescript
 * const chunks = await chunkCodeByAST(
 *   code,
 *   'example.ts',
 *   { maxChunkSize: 1000, preserveContext: true }
 * );
 * ```
 */
export const chunkCodeByAST = async (
  code: string,
  filePath: string,
  options: ASTChunkOptions = {}
): Promise<readonly ChunkResult[]> => {
  const {
    maxChunkSize = 1000,
    minChunkSize = 100,
    preserveContext = true,
    nodeTypes,
  } = options;

  // 1. Detect language
  const language = detectLanguage(filePath);
  if (!language) {
    console.error('[WARN] Unknown language, falling back to character chunking');
    const chunks = chunkText(code, { maxChunkSize });
    return chunks.map((content, i) => ({
      content,
      type: 'text',
      startLine: 0,
      endLine: 0,
      metadata: { fallback: true, index: i },
    }));
  }

  // 2. Parse AST using Synth
  const tree = await parseWithSynth(code, language);
  if (!tree) {
    console.error('[WARN] AST parsing failed, falling back to character chunking');
    const chunks = chunkText(code, { maxChunkSize });
    return chunks.map((content, i) => ({
      content,
      type: 'text',
      startLine: 0,
      endLine: 0,
      metadata: { fallback: true, index: i },
    }));
  }

  // 3. Extract semantic chunks
  const chunks = extractSemanticChunks(tree, {
    maxChunkSize,
    minChunkSize,
    preserveContext,
    nodeTypes,
  });

  // 4. Merge small chunks
  const merged = mergeSmallChunks(chunks, minChunkSize);

  // 5. If no chunks extracted, return entire code as fallback
  if (merged.length === 0 && code.trim().length > 0) {
    return [
      {
        content: code,
        type: 'unknown',
        startLine: 1,
        endLine: code.split('\n').length,
        metadata: { fallback: true, reason: 'no-semantic-boundaries' },
      },
    ];
  }

  return merged;
};

/**
 * Simple wrapper for backward compatibility
 * Returns just the content strings
 */
export const chunkCodeByASTSimple = async (
  code: string,
  filePath: string,
  options: ASTChunkOptions = {}
): Promise<readonly string[]> => {
  const chunks = await chunkCodeByAST(code, filePath, options);
  return chunks.map((chunk) => chunk.content);
};
